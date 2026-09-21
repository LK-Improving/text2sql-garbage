// lib/rate-limit.ts
//
// 生产环境「每日大模型调用上限」限流。
//
// 设计要点（对应需求 & 简历场景）：
//  - 只统计真正调用大模型的请求：/api/chat 走大模型；/api/execute 重跑 SQL 不走模型，不计。
//  - 命中 SQL 生成缓存的请求会跳过 LLM，因此不计入配额（见 app/api/chat/route.ts 调用点）。
//  - Serverless（Netlify）下进程内存不跨调用共享，计数必须落库（t_rate_limit），
//    否则每次冷启动都从 0 开始，限流形同虚设。
//  - 仅生产环境默认启用；本地开发不受限（可用 RATE_LIMIT_ENABLED=true 强制开启以便自测）。
//  - 配额可配：LLM_DAILY_LIMIT（默认 5）。
//  - 按「北京时间自然日」计日，贴合中文用户直觉；用原子「条件自增」避免并发超发。

import { query } from '@/lib/db';

const TABLE = 't_rate_limit';
const DEFAULT_DAILY_LIMIT = Number(process.env.LLM_DAILY_LIMIT ?? '5');

/** 进程内只建一次表；失败则下次重试（保证冷启动自愈） */
let tableReady: Promise<void> | null = null;

/**
 * 冷启动自动建表。
 *
 * ⚠️ 下方内联 DDL 的列集合与 `test-data/schema.sql`、`scripts/check-schema.mjs` 的
 *    `INTERNAL_TABLES.t_rate_limit` 期望值是同一张表的三处描述，加/删列必须三处同步，
 *    否则 G6 会以「列集合漂移」直接判红（本表是基础设施表，故意不进 lib/schema.ts 白名单）。
 */
function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (
        quota_date  DATE        PRIMARY KEY,
        used_count  INTEGER     NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    )
      .then(() => undefined)
      .catch((e) => {
        tableReady = null; // 失败则下次调用重试
        throw e;
      });
  }
  return tableReady;
}

/** 限流是否启用：默认仅生产环境；RATE_LIMIT_ENABLED 可强制开/关 */
export function isRateLimitEnabled(): boolean {
  const explicit = process.env.RATE_LIMIT_ENABLED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

/** 北京时间（UTC+8）自然日 YYYY-MM-DD，作为每日计数的主键 */
export function beijingDateStr(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** 下一个北京时间 00:00 的 UTC 时刻（ms） */
function nextBeijingMidnightMs(now = new Date()): number {
  const day = beijingDateStr(now); // YYYY-MM-DD
  const [y, m, d] = day.split('-').map(Number);
  // 该北京日 00:00 对应的 UTC = UTC(y, m-1, d) 减去 8 小时
  const beijingMidnightUtc = Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
  let next = beijingMidnightUtc + 24 * 3600 * 1000;
  if (next <= now.getTime()) next += 24 * 3600 * 1000;
  return next;
}

export type RateLimitStatus = {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** 北京时间次日 00:00 的 ISO（用于前端展示 / Retry-After 来源） */
  resetAt: string;
  retryAfterSec: number;
};

function buildStatus(used: number, limit: number, allowed: boolean): RateLimitStatus {
  const resetMs = nextBeijingMidnightMs();
  return {
    allowed,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt: new Date(resetMs).toISOString(),
    retryAfterSec: Math.max(0, Math.ceil((resetMs - Date.now()) / 1000)),
  };
}

/**
 * 尝试消耗一次当日配额。
 * 返回 allowed=false 表示已达上限（不会自增超发）。
 * DB 异常时抛出，由调用方决定降级（本项目选择放行并告警，避免误伤用户）。
 */
export async function consumeDailyQuota(
  dateStr = beijingDateStr(),
  limit = DEFAULT_DAILY_LIMIT,
): Promise<RateLimitStatus> {
  await ensureTable();

  // 原子条件自增：仅当当前用量 < limit 时才 +1；
  // 已达上限时 ON CONFLICT 的 UPDATE 被 WHERE 过滤，0 行受影响 → 拒绝（且不超发）。
  const res = await query(
    `INSERT INTO ${TABLE} (quota_date, used_count, updated_at)
     VALUES ($1, 1, now())
     ON CONFLICT (quota_date) DO
       UPDATE SET used_count = ${TABLE}.used_count + 1,
                  updated_at = now()
       WHERE ${TABLE}.used_count < $2
     RETURNING used_count`,
    [dateStr, limit],
  );

  if (res.rowCount === 0 || res.rows.length === 0) {
    const cur = await query(`SELECT used_count FROM ${TABLE} WHERE quota_date = $1`, [dateStr]);
    const used = cur.rows[0]?.used_count ?? limit;
    return buildStatus(used, limit, false);
  }

  const used = Number(res.rows[0].used_count);
  return buildStatus(used, limit, true);
}

/** 查询当前用量（供状态展示 / 测试），不消耗配额 */
export async function getDailyUsage(
  dateStr = beijingDateStr(),
  limit = DEFAULT_DAILY_LIMIT,
): Promise<RateLimitStatus> {
  await ensureTable();
  const cur = await query(`SELECT used_count FROM ${TABLE} WHERE quota_date = $1`, [dateStr]);
  const used = cur.rows[0]?.used_count ?? 0;
  return buildStatus(used, limit, used < limit);
}
