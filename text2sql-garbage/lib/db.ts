import { Pool, type PoolConfig } from 'pg';

/**
 * 构造连接池配置。
 * Supabase Pooler 使用自签名证书链；新版 pg 将 sslmode=require 视为 verify-full 做链校验，
 * 在 Netlify / CI 等环境会报 SELF_SIGNED_CERT_IN_CHAIN。对 supabase 域名仅加密、不校验证书，
 * 连接仍是 TLS 加密的（等价 sslmode=no-verify）。
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
      const host = new URL(process.env.DATABASE_URL).hostname;
      if (/(^|\.)supabase\.(co|com)$/.test(host)) {
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

export const query = (text: string, params?: []) => {
  return pool.query(text, params);
};
