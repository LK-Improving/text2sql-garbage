// lib/sql-cache.ts
//
// P2-1：SQL 生成结果缓存。
//
// 思路：Text-to-SQL 链路里**最慢的一步是等大模型吐完 JSON**（秒级）。
// 但同一句问题在短时间内重复问（用户点重试、多人问同一条高频问题）时，
// 生成结果完全一样 —— 这时直接复用上次的计划、跳过 LLM，只重新查库即可：
// 既省掉最大耗时项，又保证数据仍然是实时的（缓存的是 SQL，不是查询结果）。
//
// 设计取舍：
//   - key = 归一化问题 + 历史签名。带历史签名是因为多轮对话里
//     「那上个月呢」这类追问语义依赖上文，同一句话在不同上下文里对应的 SQL 不同。
//   - 进程内内存缓存（Map），不引外部依赖；实例重启即失效，无持久化副作用。
//   - 命中后仍然走 validateSQL 与数据库查询，安全边界不因缓存被绕过。

export type CachedPlan = {
  sql: string;
  title: string;
  summary: string;
  components: { type: string; data: any }[];
};

type CacheEntry = { plan: CachedPlan; at: number };

/** 最多缓存条数，超限按插入顺序淘汰最旧的（Map 迭代顺序即插入顺序） */
const MAX_ENTRIES = 200;

const store = new Map<string, CacheEntry>();

/** 默认 10 分钟。可通过 SQL_CACHE_TTL_MS 覆盖 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function isSqlCacheEnabled(): boolean {
  const v = process.env.SQL_CACHE_ENABLED;
  if (v === undefined) return true; // 默认开启
  return !/^(0|false|off|no)$/i.test(v.trim());
}

export function sqlCacheTtlMs(): number {
  const n = Number(process.env.SQL_CACHE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

/**
 * 归一化问题文本，让「查各区域本月清运量排行」与「查各区域本月清运量排行？」
 * 或带多余空格/大小写差异的同一句问题落到同一个 key。
 */
export function normalizeQuestion(question: string): string {
  return (question || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[？?。.！!，,、；;：:]+$/g, '')
    .trim();
}

/** 轻量 djb2 哈希，仅用于把较长的历史签名压短，避免 key 过长 */
function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 组装缓存 key：问题归一化文本 + 历史签名（无历史时用 `-`） */
export function makeCacheKey(question: string, historySignature = ''): string {
  const q = normalizeQuestion(question);
  if (!q) return '';
  const h = historySignature.trim() ? hash(historySignature) : '-';
  return `${q}|${h}`;
}

export type CacheHit = { plan: CachedPlan; ageMs: number; key: string };

/** 读取缓存；未启用 / 未命中 / 已过期均返回 null（过期条目顺手清理） */
export function getCachedPlan(key: string): CacheHit | null {
  if (!key || !isSqlCacheEnabled()) return null;
  const entry = store.get(key);
  if (!entry) return null;

  const ageMs = Date.now() - entry.at;
  if (ageMs > sqlCacheTtlMs()) {
    store.delete(key);
    return null;
  }

  // LRU 触达：重新插入以刷新迭代顺序
  store.delete(key);
  store.set(key, entry);

  return { plan: entry.plan, ageMs, key };
}

/** 写入缓存（只在拿到「安全校验通过」的最终 SQL 后调用） */
export function setCachedPlan(key: string, plan: CachedPlan): void {
  if (!key || !isSqlCacheEnabled()) return;
  if (!plan?.sql) return;

  store.delete(key); // 重新插入到队尾
  store.set(key, { plan, at: Date.now() });

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** 清空缓存（测试 / 调试用） */
export function clearSqlCache(): void {
  store.clear();
}

/** 缓存状态（调试 / 遥测） */
export function sqlCacheStats(): { size: number; enabled: boolean; ttlMs: number } {
  return { size: store.size, enabled: isSqlCacheEnabled(), ttlMs: sqlCacheTtlMs() };
}
