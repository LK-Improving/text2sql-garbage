#!/usr/bin/env node
/**
 * Text-to-SQL 评测脚本（P0-3）
 *
 * 用法：
 *   node scripts/run-eval.mjs                        # 全量跑，输出到 ../test-data/
 *   node scripts/run-eval.mjs --only=A01,A02         # 只跑指定用例
 *   node scripts/run-eval.mjs --concurrency=5        # 提高并发（注意模型限流）
 *
 * 判定口径：
 *   1. 安全拒绝类用例（expected_behavior = refuse）：必须被 validator 拦下，或模型明确拒绝。
 *   2. 其余用例：分别执行「生成的 SQL」与「标准答案 SQL」，比较结果集（值的多重集合），
 *      完全一致记 match；行内值相同但列顺序/别名不同记 partial；结果不同记 mismatch。
 *   3. SQL 执行报错记 exec_error；未产出 SQL 记 no_sql。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EVAL_FILE = path.resolve(ROOT, 'test-data/text2sql-eval.jsonl');

/* ───────── 参数 ───────── */
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const BASE_URL = arg('base', 'http://localhost:3000');
const CONCURRENCY = Number(arg('concurrency', 3));
const OUT_DIR = path.resolve(ROOT, arg('out', 'test-data'));
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

// 用本地时间做文件名后缀（toISOString 是 UTC，会和本机日期差一天）
const now = new Date();
const pad2 = (n) => String(n).padStart(2, '0');
const STAMP = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}_${pad2(
  now.getHours(),
)}${pad2(now.getMinutes())}`;

/* ───────── 工具 ───────── */

function readJsonl(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** 调用 /api/chat，解析 SSE */
async function askQuestion(question, attempt = 1) {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
  });

  if (res.status === 429 && attempt <= 3) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return askQuestion(question, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) throw new Error('响应没有数据流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  let error = null;
  let raw = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        if (json.type === 'result') result = json.data;
        else if (json.type === 'error') error = String(json.message ?? '未知错误');
        else if (json.type === 'llm_stream') raw += json.content ?? '';
      } catch {
        /* 非 JSON 帧忽略 */
      }
    }
  }

  return { result, error, raw, elapsed: Date.now() - started };
}

/**
 * 结果与标准答案比对：
 *   match       —— 行数与每行取值完全一致
 *   match_extra —— 期望列（expected_columns）的值全部正确，只是多给了额外列（算通过）
 *   partial     —— 值一致但列顺序 / 别名不同（把每行的值排序后再比）
 *   mismatch    —— 结果集不同
 *
 * 为什么容忍「多给列」：评测集自带 expected_columns，设计意图是校验关键列是否正确，
 * 而不是要求 SELECT 列表逐字一致；真实产品里多返回一列也通常是有用信息而非错误。
 */
function compareRows(actual, expected, expectedColumns = []) {
  const byOrder = (rows) => rows.map((r) => Object.values(r).map((v) => String(v)).join('|'));
  const byValue = (rows) =>
    rows
      .map((r) => Object.values(r).map((v) => String(v)).sort().join('|'))
      .sort();

  if (actual.length !== expected.length) return 'mismatch';

  const a = byOrder(actual);
  const b = byOrder(expected);
  if (a.every((v, i) => v === b[i])) return 'match';

  const sa = byValue(actual);
  const sb = byValue(expected);
  if (sa.every((v, i) => v === sb[i])) return 'partial';

  // 退一步：只看期望列是否都在、值是否一致
  if (expectedColumns.length && actual.length) {
    const actualKeys = Object.keys(actual[0] ?? {});
    const hasAll = expectedColumns.every((k) => actualKeys.includes(k));
    if (hasAll) {
      const proj = (rows) =>
        rows.map((r) => expectedColumns.map((k) => String(r[k])).join('|')).sort();
      const pa = proj(actual);
      const pb = proj(expected);
      if (pa.every((v, i) => v === pb[i])) return 'match_extra';
    }
  }

  return 'mismatch';
}

/** 后端校验失败时不回传 SQL，从 LLM 原始输出里捞出来便于排查 */
function extractSqlFromRaw(raw = '') {
  try {
    const block = raw.match(/```json\s*([\s\S]*?)```/i);
    const text = block ? block[1] : (raw.match(/\{[\s\S]*\}/) || [])[0];
    if (!text) return null;
    const parsed = JSON.parse(text.trim());
    return typeof parsed.sql === 'string' ? parsed.sql : null;
  } catch {
    return null;
  }
}

const SECURITY_HINT = ['安全校验不通过', '禁止', '不允许访问', '仅允许 SELECT', '多条语句'];
const isSecurityBlock = (msg = '') => SECURITY_HINT.some((h) => msg.includes(h));

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ───────── 主流程 ───────── */

async function main() {
  if (!process.env.DATABASE_URL) {
    // 评测脚本需要直连库跑标准答案；从项目 .env 读取
    const envFile = path.resolve(ROOT, 'text2sql-garbage/.env');
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] === 'DATABASE_URL') process.env.DATABASE_URL = m[2].trim();
    }
  }

  const cases = readJsonl(EVAL_FILE).filter((c) => !ONLY.length || ONLY.includes(c.id));
  // 确保输出目录存在（--out 可指向任意路径，避免 ENOENT）
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("SET statement_timeout = '10s'");

  console.log(`▶ 共 ${cases.length} 条用例，并发 ${CONCURRENCY}，目标 ${BASE_URL}\n`);

  const results = [];
  let cursor = 0;

  async function worker(workerId) {
    while (cursor < cases.length) {
      const index = cursor++;
      const item = cases[index];
      const refuse = item.expected_behavior === 'refuse' || item.expected_sql === null;

      let row = {
        id: item.id,
        category: item.category,
        difficulty: item.difficulty,
        question: item.question,
        expected: refuse ? 'refuse' : 'answer',
        status: 'unknown',
        sql: null,
        error: null,
        elapsed: 0,
        detail: '',
      };

      try {
        const { result, error, raw, elapsed } = await askQuestion(item.question);
        row.elapsed = elapsed;

        if (error) {
          row.error = error;
          row.sql = extractSqlFromRaw(raw);
          row.status = isSecurityBlock(error)
            ? refuse
              ? 'pass'
              : 'false_reject'
            : 'error';
          row.detail = error;
        } else if (!result || !result.sql) {
          row.status = refuse ? 'pass' : 'no_sql';
          row.detail = refuse ? '未生成 SQL（符合预期）' : '未产出 SQL';
        } else {
          row.sql = result.sql;

          if (refuse) {
            // 期望拒绝却生成了 SQL：只要 validator 没放行写操作就算过
            row.status = 'false_accept';
            row.detail = '期望被拒绝，实际生成了 SQL';
          } else {
            let baseline = null;
            let baselineErr = null;
            try {
              baseline = (await client.query(item.expected_sql)).rows;
            } catch (e) {
              baselineErr = e.message;
            }

            let actual = null;
            let actualErr = null;
            try {
              actual = (await client.query(result.sql)).rows;
            } catch (e) {
              actualErr = e.message;
            }

            if (actualErr) {
              row.status = 'exec_error';
              row.detail = actualErr;
            } else if (baselineErr) {
              row.status = 'unknown';
              row.detail = `标准答案执行失败：${baselineErr}`;
            } else {
              row.status = compareRows(actual, baseline, item.expected_columns ?? []);
              const cols = (rows) => (rows[0] ? Object.keys(rows[0]).length : 0);
              row.detail =
                row.status === 'match'
                  ? `结果一致（${actual.length} 行）`
                  : row.status === 'match_extra'
                    ? `期望列全部正确，额外多给 ${cols(actual) - cols(baseline)} 列`
                    : row.status === 'partial'
                      ? `值一致但列顺序/别名不同（${actual.length} 行）`
                      : `结果不一致：实际 ${actual.length} 行 ${cols(actual)} 列 / 期望 ${baseline.length} 行 ${cols(baseline)} 列`;
            }
          }
        }
      } catch (err) {
        row.status = 'error';
        row.error = err.message;
        row.detail = err.message;
      }

      results.push(row);
      const mark = ['pass', 'match', 'match_extra'].includes(row.status)
        ? '✅'
        : row.status === 'partial'
          ? '🟡'
          : '❌';
      console.log(
        `${mark} [${row.id}] ${row.category} · ${row.status} · ${(row.elapsed / 1000).toFixed(1)}s · ${row.detail.slice(0, 60)}`,
      );
      if (row.status === 'false_accept' && row.sql) console.log(`     生成的 SQL: ${row.sql.slice(0, 120)}`);
      if (ONLY.length) await sleep(0);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, (_, i) => worker(i)));
  await client.end();

  /* ───────── 汇总 ───────── */
  results.sort((a, b) => a.id.localeCompare(b.id));
  const total = results.length;
  const answered = results.filter((r) => r.expected === 'answer');
  const refused = results.filter((r) => r.expected === 'refuse');

  const count = (arr, ...statuses) => arr.filter((r) => statuses.includes(r.status)).length;
  const correct = count(answered, 'match', 'match_extra', 'partial');
  const execOk = count(answered, 'match', 'match_extra', 'partial', 'mismatch');
  const acc = total ? ((count(results, 'pass', 'match', 'match_extra', 'partial') / total) * 100).toFixed(1) : '0.0';
  const answerAcc = answered.length ? ((correct / answered.length) * 100).toFixed(1) : '0.0';
  const execRate = answered.length ? ((execOk / answered.length) * 100).toFixed(1) : '0.0';
  const times = results.map((r) => r.elapsed).sort((a, b) => a - b);
  const avg = (times.reduce((s, t) => s + t, 0) / total / 1000).toFixed(1);
  const p95 = (times[Math.floor(total * 0.95) - 1] / 1000).toFixed(1);

  const byCategory = {};
  for (const r of results) {
    byCategory[r.category] ??= { total: 0, ok: 0 };
    byCategory[r.category].total += 1;
    if (['pass', 'match', 'match_extra', 'partial'].includes(r.status)) byCategory[r.category].ok += 1;
  }

  const lines = [];
  lines.push(`# Text-to-SQL 评测报告 — ${STAMP}`);
  lines.push('');
  lines.push(`- 用例数：**${total}**（问答案例 ${answered.length} / 安全拒绝 ${refused.length}）`);
  lines.push(`- 目标服务：\`${BASE_URL}\``);
  lines.push('');
  lines.push('## 总体指标');
  lines.push('');
  lines.push('| 指标 | 实测 | 目标 | 结论 |');
  lines.push('|---|---|---|---|');
  lines.push(`| SQL 可执行率 | ${execRate}% | ≥ 95% | ${Number(execRate) >= 95 ? '达标' : '未达标'} |`);
  lines.push(`| 结果准确率 | ${answerAcc}% | ≥ 90% | ${Number(answerAcc) >= 90 ? '达标' : '未达标'} |`);
  lines.push(`| 整体通过率 | ${acc}% | — | — |`);
  lines.push(`| 平均响应 | ${avg}s | < 5s | ${Number(avg) < 5 ? '达标' : '未达标'} |`);
  lines.push(`| P95 响应 | ${p95}s | — | — |`);
  lines.push('');
  lines.push('## 分类表现');
  lines.push('');
  lines.push('| 类别 | 通过 / 总数 | 通过率 |');
  lines.push('|---|---|---|');
  for (const [cat, v] of Object.entries(byCategory)) {
    lines.push(`| ${cat} | ${v.ok} / ${v.total} | ${((v.ok / v.total) * 100).toFixed(0)}% |`);
  }
  lines.push('');
  lines.push('## 明细');
  lines.push('');
  lines.push('| 用例 | 类别 | 问题 | 状态 | 耗时 | 说明 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of results) {
    const mark = ['pass', 'match', 'match_extra'].includes(r.status) ? '✅' : r.status === 'partial' ? '🟡' : '❌';
    lines.push(
      `| ${r.id} | ${r.category} | ${r.question.replace(/\|/g, '\\|').slice(0, 40)} | ${mark} ${r.status} | ${(r.elapsed / 1000).toFixed(1)}s | ${r.detail.replace(/\|/g, '\\|').slice(0, 70)} |`,
    );
  }
  lines.push('');
  const bad = results.filter((r) => !['pass', 'match', 'match_extra', 'partial'].includes(r.status));
  if (bad.length) {
    lines.push('## 待改进用例');
    lines.push('');
    for (const r of bad) {
      lines.push(`### ${r.id} · ${r.category} · ${r.status}`);
      lines.push(`- 问题：${r.question}`);
      lines.push(`- 说明：${r.detail}`);
      if (r.sql) lines.push(`- 生成的 SQL：\`\`\`sql\n${r.sql}\n\`\`\``);
      if (r.error) lines.push(`- 错误：${r.error}`);
      lines.push('');
    }
  }

  const report = lines.join('\n');
  const mdPath = path.join(OUT_DIR, `eval-report-${STAMP}.md`);
  const jsonPath = path.join(OUT_DIR, `eval-result-${STAMP}.json`);
  fs.writeFileSync(mdPath, report, 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ stamp: STAMP, summary: { total, acc: Number(acc), answerAcc: Number(answerAcc), execRate: Number(execRate), avg: Number(avg), p95: Number(p95) }, byCategory, results }, null, 2),
    'utf8',
  );

  console.log(`\n${report.split('## 分类表现')[0]}`);
  console.log(`\n📄 报告：${mdPath}`);
  console.log(`📄 数据：${jsonPath}`);
}

main().catch((e) => {
  console.error('评测失败：', e);
  process.exit(1);
});
