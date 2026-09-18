#!/usr/bin/env node
/**
 * 评测库灌装脚本（M2 · G7 评测门禁前置）
 *
 * 零依赖（仅 pg，与 run-eval.mjs 同栈）：直连 PG，顺序执行
 *   test-data/schema.sql  （DROP + CREATE 5 张表 + 索引）
 *   test-data/seed.sql    （确定性种子数据）
 *
 * 设计要点：
 *  - 带连接重试，兼容 GitHub Actions 的 Postgres service container 启动慢的场景。
 *  - 按 `;` 拆成单条语句执行（本仓库 SQL 字符串内不含分号，安全），
 *    逐条执行便于看到具体哪句失败；schema.sql 顶部 DROP 保证干净重建。
 *
 * 环境变量：
 *   DATABASE_URL  缺省读 text2sql-garbage/.env，再缺省本机默认。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, '..'); // text2sql-garbage
const ROOT = path.resolve(__dirname, '../..'); // 仓库根
const SCHEMA = path.resolve(ROOT, 'test-data/schema.sql');
const SEED = path.resolve(ROOT, 'test-data/seed.sql');

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(APP, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === 'DATABASE_URL') return m[2].trim();
    }
  }
  return 'postgresql://postgres:root@localhost:5432/garbage_db';
}

const DATABASE_URL = resolveDatabaseUrl();

async function withRetry(fn, label, max = 30, waitMs = 2000) {
  let lastErr;
  for (let i = 1; i <= max; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      process.stdout.write(`  [${label}] 连接重试 ${i}/${max}: ${String(e.message).split('\n')[0]}\n`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/** 按顶层 `;` 拆成单条语句并执行（忽略空语句） */
async function runScript(client, file, label) {
  const sql = fs.readFileSync(file, 'utf8');
  const stmts = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`▶ ${label}：共 ${stmts.length} 条语句`);
  for (let i = 0; i < stmts.length; i++) {
    await client.query(stmts[i]);
  }
  console.log(`✅ ${label} 完成`);
}

async function main() {
  if (!fs.existsSync(SCHEMA)) throw new Error(`找不到 schema.sql: ${SCHEMA}`);
  if (!fs.existsSync(SEED)) throw new Error(`找不到 seed.sql: ${SEED}`);

  const client = await withRetry(async () => {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    return c;
  }, 'connect');

  try {
    await runScript(client, SCHEMA, '灌装 schema（DROP + CREATE）');
    await runScript(client, SEED, '灌装 seed 数据');
    console.log('✅ 评测库灌装完成');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('评测库灌装失败：', e);
  process.exit(1);
});
