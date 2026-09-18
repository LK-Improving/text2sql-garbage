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

/**
 * 种子 SQL 目录解析（支持三处回退）：
 *   1. 显式 SEED_SQL_DIR 环境变量（绝对 / 相对路径皆可）
 *   2. 仓库根 test-data/（本地仓库 / GitHub Actions 全量 checkout 场景可用）
 *   3. text2sql-garbage/test-data/（部署兜底）
 * 目的：无论本机、CI 评测容器、还是 GitHub Actions 手动灌云库（db-setup.yml）都能定位
 *       schema.sql / seed.sql；即便 Netlify 构建上下文只含子目录也不影响——灌库走
 *       GitHub Actions 而非 Netlify 构建（见 CI-CD-PLAN.md M3 路径坑说明）。
 */
function resolveSeedDir() {
  if (process.env.SEED_SQL_DIR) return path.resolve(process.env.SEED_SQL_DIR);
  const candidates = [
    path.join(ROOT, 'test-data'),
    path.join(APP, 'test-data'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'schema.sql'))) return dir;
  }
  return candidates[0]; // 默认回退，缺失时下方会抛清晰错误
}
const SEED_DIR = resolveSeedDir();
const SCHEMA = path.join(SEED_DIR, 'schema.sql');
const SEED = path.join(SEED_DIR, 'seed.sql');

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
  console.log(`▶ 种子目录：${SEED_DIR}`);
  if (!fs.existsSync(SCHEMA)) throw new Error(`找不到 schema.sql: ${SCHEMA}（可用 SEED_SQL_DIR 指定）`);
  if (!fs.existsSync(SEED)) throw new Error(`找不到 seed.sql: ${SEED}（可用 SEED_SQL_DIR 指定）`);

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
