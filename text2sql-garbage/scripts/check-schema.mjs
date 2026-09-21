#!/usr/bin/env node
// scripts/check-schema.mjs
// G6 质量门禁：校验 lib/schema.ts（运行时「唯一」数据源）与 test-data/schema.sql（建表脚本）的
// 表名 + 列名集合一致。防止历史上「schema 注入成单字符 / 出现第二份 schema 漂移」事故复发。
//
// 用法：node scripts/check-schema.mjs   （exit 0 一致；exit 1 不一致）

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // text2sql-garbage
const schemaTsPath = resolve(root, 'lib', 'schema.ts');
const schemaSqlPath = resolve(root, '..', 'test-data', 'schema.sql');
const libDir = resolve(root, 'lib');

function fail(msg) {
  console.error('❌ schema 一致性校验失败：');
  console.error(msg);
  process.exit(1);
}

if (!existsSync(schemaTsPath)) fail(`找不到 ${schemaTsPath}`);
if (!existsSync(schemaSqlPath)) fail(`找不到 ${schemaSqlPath}`);

const ts = readFileSync(schemaTsPath, 'utf8');
const sql = readFileSync(schemaSqlPath, 'utf8');

// 基础设施表：只由服务端代码直连读写（如限流计数），不注入 prompt、不进 validateSQL 白名单。
// 它们合法地只存在于 schema.sql，G6 因此跳过与 TABLE_METADATA 的表名比对；
// 但「往列表里加一行就能变绿」必须是受审计的，所以每张豁免表同时满足四条硬约束：
//   ① 不得出现在 lib/schema.ts（否则会被 ALLOWED_TABLES 放行并注入 prompt）
//   ② 必须在 schema.sql 真实建表，且建表语句上方紧邻注释块带 `-- @internal` 显式声明
//   ③ 必须被 lib/ 下的服务端源码真实引用（防止把漏同步的业务表塞进豁免列表蒙混过关）
//   ④ 列集合必须等于此处声明的期望值（防 schema.sql 与 lib/ 内联 DDL 漂移成第二份 schema）
const INTERNAL_TABLES = {
  // 期望列集合与 lib/rate-limit.ts 的 ensureTable() 内联 DDL 单一同源，改一处必须同步另一处
  t_rate_limit: ['quota_date', 'used_count', 'updated_at'],
};

/** 建表语句上方紧邻的注释块里是否带 `-- @internal` 声明 */
function hasInternalDeclaration(sqlText, table) {
  const re = new RegExp(
    `CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?(?:[a-z_]+\\.)?${table}\\s*\\(`,
    'i',
  );
  const idx = sqlText.search(re);
  if (idx < 0) return false;
  const lines = sqlText.slice(0, idx).split('\n').filter((l) => l.trim() !== '');
  const comments = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('--')) break;
    comments.unshift(line);
  }
  return comments.some((l) => /@internal\b/i.test(l));
}

/** 收集 lib 下的服务端 TS 源码（排除业务 schema.ts 与测试文件） */
function collectLibSources(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      files.push(...collectLibSources(full));
      continue;
    }
    if (/\.ts$/.test(entry.name) && full !== resolve(dir, 'schema.ts')) files.push(full);
  }
  return files;
}

// ---- 解析 lib/schema.ts ----
// 表名：2 空格缩进下的 `t_xxx: {`
const tableNames = [...ts.matchAll(/^\s{2}(t_[a-z_]+):\s*\{/gm)].map((m) => m[1]);
// 每个表的 columns 数组，按出现顺序与表名一一对应
const colArrays = [...ts.matchAll(/columns:\s*\[([\s\S]*?)\],/g)].map((m) =>
  [...m[1].matchAll(/name:\s*'([^']+)'/g)].map((x) => x[1]),
);
if (tableNames.length !== colArrays.length) {
  fail(
    `表数量不匹配：TABLE_METADATA 解析到 ${tableNames.length} 张表，但 columns 数组有 ${colArrays.length} 个。` +
      '请检查 schema.ts 解析逻辑或文件结构。',
  );
}
const tsTables = {};
tableNames.forEach((t, i) => {
  tsTables[t] = colArrays[i] || [];
});

// ---- 解析 schema.sql ----
const sqlTables = {};
const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\)\s*;/gi;
let m;
while ((m = createRe.exec(sql))) {
  const tname = m[1];
  const body = m[2];
  const cols = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('--')) continue;
    if (/^(CONSTRAINT|PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|\);)/i.test(line)) continue;
    const col = line.match(/^([a-z_]+)\s+[A-Z][A-Za-z0-9()]*/);
    if (col) cols.push(col[1]);
  }
  sqlTables[tname] = cols;
}

// ---- 基础设施表守卫 ----
// 必须放在集合比对之前：若豁免表被写进 lib/schema.ts，它会先进 tsSet、又被下面的
// sqlSet 过滤掉，onlyTs 会抢先 fail 并报成「仅在 lib/schema.ts 中」，这条真正的诊断就不可达了。
const tsSet = new Set(Object.keys(tsTables));
const internalNames = Object.keys(INTERNAL_TABLES);
const libSources = existsSync(libDir) ? collectLibSources(libDir) : [];
const internalIssues = [];
for (const t of internalNames) {
  if (tsSet.has(t)) {
    internalIssues.push(
      `  ${t}：泄漏进 lib/schema.ts（会进 ALLOWED_TABLES 白名单并被注入 prompt），必须从 TABLE_METADATA 移除`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(sqlTables, t)) {
    internalIssues.push(`  ${t}：登记在豁免列表但未在 schema.sql 建表`);
    continue;
  }
  if (!hasInternalDeclaration(sql, t)) {
    internalIssues.push(
      `  ${t}：建表语句上方缺少 "-- @internal" 声明，禁止无审计豁免 G6`,
    );
  }
  if (!libSources.some((f) => readFileSync(f, 'utf8').includes(t))) {
    internalIssues.push(`  ${t}：未被 lib/ 任何服务端源码引用，疑似用豁免掩盖漏同步`);
  }
  const expected = [...INTERNAL_TABLES[t]].sort().join(', ');
  const actual = [...sqlTables[t]].sort().join(', ');
  if (expected !== actual) {
    internalIssues.push(`  ${t}：列集合漂移（豁免列表期望 ${expected} / schema.sql 实际 ${actual}）`);
  }
}
if (internalIssues.length) fail(internalIssues.join('\n'));

// ---- 业务表比对 ----
const internal = new Set(internalNames);
const sqlSet = new Set(Object.keys(sqlTables).filter((t) => !internal.has(t)));
const onlyTs = [...tsSet].filter((t) => !sqlSet.has(t));
const onlySql = [...sqlSet].filter((t) => !tsSet.has(t));
if (onlyTs.length || onlySql.length) {
  const lines = [];
  if (onlyTs.length) lines.push(`  仅在 lib/schema.ts 中： ${onlyTs.join(', ')}`);
  if (onlySql.length) lines.push(`  仅在 schema.sql 中： ${onlySql.join(', ')}`);
  fail(lines.join('\n'));
}

let mismatch = false;
for (const t of tsSet) {
  const a = [...tsTables[t]].sort();
  const b = [...sqlTables[t]].sort();
  if (a.length !== b.length || a.some((c, i) => c !== b[i])) {
    mismatch = true;
    console.error(`  • ${t}:`);
    console.error(`      schema.ts : ${tsTables[t].join(', ')}`);
    console.error(`      schema.sql: ${sqlTables[t].join(', ')}`);
  }
}

if (mismatch) {
  fail('以上表的列集合不一致。请同步修改 lib/schema.ts 或 test-data/schema.sql（两者必须严格一致）。');
}

console.log(`✅ schema 一致性校验通过：共 ${tsSet.size} 张业务表，列集合完全一致。`);
console.log(`   表：${[...tsSet].join(', ')}`);
if (internalNames.length) {
  console.log(`   已审计豁免的基础设施表（不进白名单/prompt）：${internalNames.join(', ')}`);
}
process.exit(0);
