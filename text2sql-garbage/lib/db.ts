import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 只读场景，避免慢查询长时间占用连接
  max: 10,
  connectionTimeoutMillis: 5000,
});

// statement_timeout 是连接级参数，需要在每条新连接上设置一次
pool.on('connect', (client) => {
  client.query("SET statement_timeout = '10s'").catch(() => {
    /* 设置失败不阻断查询 */
  });
});

export const query = (text: string, params?: []) => {
  return pool.query(text, params);
};
