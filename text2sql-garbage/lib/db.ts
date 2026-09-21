import { Pool, types as pgTypes, type PoolConfig } from 'pg';

// 让 date / timestamp 以**字符串**返回（YYYY-MM-DD / YYYY-MM-DD HH:mm:ss），
// 而不是默认的 JS Date 对象。原因：pg 默认把 date 解析成 Date，经 JSON 序列化后变成
// UTC 的 ISO 字符串（如 2026-09-12 +08:00 → "2026-09-11T16:00:00.000Z"），导致前端
// 表格/导出里的日期**整体偏移一天**，且图表 X 轴显示成英文长日期。统一返回字符串后：
//   - 表格/导出日期正确、无时区偏移；
//   - 图表维度列（date）不会被 isNumericColumn 误判成数值列（CR 修复项）。
pgTypes.setTypeParser(1082, (v: string) => v); // date
pgTypes.setTypeParser(1114, (v: string) => v); // timestamp（无时区）
pgTypes.setTypeParser(1184, (v: string) => v); // timestamptz（保留原始文本，如 2026-03-10 08:12:00+08）

/**
 * 构造连接池配置。
 * Supabase Pooler 使用自签名证书链；新版 pg 将 sslmode=require 视为 verify-full 做链校验，
 * 且在合并配置时会用 URL 解析出的 ssl 覆盖显式传入的 ssl，导致 Netlify / CI 等环境报
 * SELF_SIGNED_CERT_IN_CHAIN。因此对 supabase 域名从 URL 剥掉 sslmode/ssl，再显式仅加密、
 * 不校验证书（等价 sslmode=no-verify）；连接仍是 TLS 加密的。
 */
function buildPoolConfig(): PoolConfig {
  const cfg: PoolConfig = {
    connectionString: process.env.DATABASE_URL,
    // 只读场景，避免慢查询长时间占用连接
    max: 10,
    connectionTimeoutMillis: 5000,
  };
  if (process.env.DATABASE_URL) {
    try {
      const url = new URL(process.env.DATABASE_URL);
      if (/(^|\.)supabase\.(co|com)$/.test(url.hostname)) {
        url.searchParams.delete('sslmode');
        url.searchParams.delete('ssl');
        cfg.connectionString = url.toString();
        cfg.ssl = { rejectUnauthorized: false };
      }
    } catch {
      /* 非法 URL 忽略，交给 pg 报错 */
    }
  }
  return cfg;
}

const pool = new Pool(buildPoolConfig());

// statement_timeout 是连接级参数，需要在每条新连接上设置一次
pool.on('connect', (client) => {
  client.query("SET statement_timeout = '10s'").catch(() => {
    /* 设置失败不阻断查询 */
  });
});

export const query = (text: string, params?: unknown[]) => {
  return pool.query(text, params);
};
