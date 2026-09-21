#!/usr/bin/env node
/**
 * 每日随机数据生成 CLI（M · 数据自增）
 *
 * 用法：
 *   node scripts/gen-daily.mjs                       # 默认：今天
 *   node scripts/gen-daily.mjs --date 2026-09-21     # 指定单天
 *   node scripts/gen-daily.mjs --from 2026-09-12 --to 2026-09-21   # 区间（补历史）
 *   node scripts/gen-daily.mjs --vehicles 1,2,3      # 只给部分车辆
 *   node scripts/gen-daily.mjs --no-bills --no-alerts
 *   node scripts/gen-daily.mjs --dry-run             # 只打印计划，不落库
 *   node scripts/gen-daily.mjs --help
 *
 * 连接：与 seed-db.mjs 一致 —— 优先 DATABASE_URL 环境变量，其次 .env，再缺省本机。
 *       Supabase Pooler 自签名证书：从连接串剥离 sslmode/ssl 后仅加密不校验。
 *
 * 退出码：0 成功 / 1 失败 / 2 参数错误。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fillDateRange, enumerateDates } from './daily-gen-core.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, '..'); // text2sql-garbage

function todayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

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

function buildClientConfig() {
  const url = resolveDatabaseUrl();
  try {
    const u = new URL(url);
    if (/(^|\.)supabase\.(co|com)$/.test(u.hostname)) {
      u.searchParams.delete('sslmode');
      u.searchParams.delete('ssl');
      return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
    }
  } catch {
    /* 非法 URL 交给下方连接逻辑报错 */
  }
  return { connectionString: url };
}

function parseArgs(argv) {
  const out = { vehicles: [1, 2, 3, 4, 5, 6, 7, 8, 9], withBills: true, withAlerts: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; return out; }
    if (a === '--date') { out.from = out.to = argv[++i]; }
    else if (a === '--from') { out.from = argv[++i]; }
    else if (a === '--to') { out.to = argv[++i]; }
    else if (a === '--vehicles') { out.vehicles = argv[++i].split(',').map((s) => Number(s.trim())).filter(Boolean); }
    else if (a === '--no-bills') { out.withBills = false; }
    else if (a === '--no-alerts') { out.withAlerts = false; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else { throw new Error(`未知参数：${a}`); }
  }
  if (!out.from) out.from = todayYmd();
  if (!out.to) out.to = out.from;
  return out;
}

const HELP = `
每日随机清运数据生成器
  --date YYYY-MM-DD            指定单天（默认今天）
  --from / --to YYYY-MM-DD     日期区间（闭区间，用于补历史）
  --vehicles 1,2,3             只生成指定车辆（默认 1..9）
  --no-bills                   不生成磅单
  --no-alerts                  不生成预警
  --dry-run                    只打印计划，不落库
  --help                       显示本帮助
`.trim();

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error('参数错误：', e.message);
    console.error(HELP);
    process.exit(2);
  }
  if (args.help) { console.log(HELP); process.exit(0); }

  const dates = enumerateDates(args.from, args.to);
  const planned = dates.length * args.vehicles.length;
  console.log(`▶ 目标日期：${args.from} ~ ${args.to}（${dates.length} 天），车辆 [${args.vehicles.join(',')}]，计划 ${planned} 条路单`);
  console.log(`  磅单=${args.withBills ? '开' : '关'}  预警=${args.withAlerts ? '开' : '关'}  模式=${args.dryRun ? 'DRY-RUN' : '落库'}`);

  if (args.dryRun) {
    console.log(`✅ 演练完成：将生成 ${planned} 条路单` + (args.withBills ? ` + ${planned * 2} 张磅单` : '') + '（未落库）');
    return;
  }

  const client = new Client(buildClientConfig());
  await client.connect();
  try {
    const summary = await fillDateRange(client, {
      from: args.from,
      to: args.to,
      vehicles: args.vehicles,
      withBills: args.withBills,
      withAlerts: args.withAlerts,
      onLog: (m) => console.log(m),
    });
    console.log(
      `✅ 完成：生成路单 ${summary.inserted} 条、磅单 ${summary.bills} 张、预警 ${summary.alerts} 条；` +
      `跳过已存在 ${summary.skipped} 条；计划 ${summary.planned} 条。`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('每日数据生成失败：', e);
  process.exit(1);
});
