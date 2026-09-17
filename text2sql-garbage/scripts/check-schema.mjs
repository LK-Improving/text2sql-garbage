#!/usr/bin/env node
// scripts/check-schema.mjs
// G6 质量门禁：校验 lib/schema.ts（运行时「唯一」数据源）与 test-data/schema.sql（建表脚本）的
// 表名 + 列名集合一致。防止历史上「schema 注入成单字符 / 出现第二份 schema 漂移」事故复发。
//
// 用法：node scripts/check-schema.mjs   （exit 0 一致；exit 1 不一致）

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..'); // text2sql-garbage
const schemaTsPath = resolve(root, 'lib', 'schema.ts');
const schemaSqlPath = resolve(root, '..', 'test-data', 'schema.sql');

function fail(msg) {
  console.error('❌ schema 一致性校验失败：');
  console.error(msg);
  process.exit(1);
}

if (!existsSync(schemaTsPath)) fail(`找不到 ${schemaTsPath}`);
if (!existsSync(schemaSqlPath)) fail(`找不到 ${schemaSqlPath}`);

const ts = readFileSync(schemaTsPath, 'utf8');
const sql = readFileSync(schemaSqlPath, 'utf8');

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

// ---- 比对 ----
const tsSet = new Set(Object.keys(tsTables));
const sqlSet = new Set(Object.keys(sqlTables));
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

console.log(`✅ schema 一致性校验通过：共 ${tsSet.size} 张表，列集合完全一致。`);
console.log(`   表：${[...tsSet].join(', ')}`);
process.exit(0);
