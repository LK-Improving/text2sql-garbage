#!/usr/bin/env node
/**
 * 评测门禁阈值校验（M2 · G7）
 *
 * 读取 test-data/eval-result-*.json 中最新一份，校验 NFR 量化阈值：
 *   - SQL 可执行率 execRate  >= 95
 *   - 结果准确率   answerAcc   >= 90
 *   - P95 响应     p95         <  5
 *
 * 不达标 exit(1)（CI 红），达标 exit(0)。配合 pnpm eval:gate 使用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..'); // 仓库根
const DIR = path.resolve(ROOT, 'test-data');

const THRESHOLDS = {
  execRate: { label: 'SQL 可执行率', sym: '≥', min: 95, cmp: (v, t) => v >= t },
  answerAcc: { label: '结果准确率', sym: '≥', min: 90, cmp: (v, t) => v >= t },
  p95: { label: 'P95 响应(s)', sym: '<', max: 5, cmp: (v, t) => v < t },
};

function findLatest() {
  if (!fs.existsSync(DIR)) return null;
  return fs
    .readdirSync(DIR)
    .filter((f) => f.startsWith('eval-result-') && f.endsWith('.json'))
    .map((f) => ({ f, m: fs.statSync(path.join(DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
}

const latest = findLatest();
if (!latest) {
  console.error('❌ 未找到 eval-result-*.json，请先运行 `pnpm eval` 生成评测报告。');
  process.exit(1);
}

const file = path.join(DIR, latest.f);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const s = data.summary ?? {};
console.log(`📄 评测报告：${file}`);
console.log(`   用例数 ${s.total ?? '?'} · 整体通过率 ${s.acc ?? '?'}%`);

let ok = true;
for (const [key, t] of Object.entries(THRESHOLDS)) {
  const val = Number(s[key]);
  if (Number.isNaN(val)) {
    console.error(`❌ 指标 ${key} 缺失，评测报告结构异常`);
    ok = false;
    continue;
  }
  const pass = t.cmp(val, t.min ?? t.max);
  if (!pass) ok = false;
  console.log(`${pass ? '✅' : '❌'} ${t.label}: ${val}（阈值 ${t.sym} ${t.min ?? t.max}）`);
}

if (!ok) {
  console.error('\n❌ 评测门禁未通过（G7），本次 CI 不通过。');
  process.exit(1);
}
console.log('\n✅ 评测门禁通过（G7）');
