// app/api/execute/route.ts
//
// 「编辑 SQL → 重新执行」闭环的后端：只接受已经写好的 SQL，走与 /api/chat 相同的
// 安全校验（黑名单 + 表名白名单 + 强制 LIMIT）后直接查库，**不再调用大模型**。

import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { validateSQL } from '@/lib/validator';
import { buildResultComponents, buildRowsSummary } from '@/lib/result-builder';
import { classifyError } from '@/lib/error-hints';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const rawSql = typeof body?.sql === 'string' ? body.sql.trim() : '';
  if (!rawSql) {
    return Response.json({ ok: false, error: 'SQL 不能为空' }, { status: 400 });
  }

  // 1) 复用同一套安全校验：改写后的 SQL 同样不能越权
  const validated = validateSQL(rawSql);
  if (!validated.valid) {
    // P2-3：返回统一分级错误，前端直接展示中文类别 + 建议
    const hint = classifyError(validated.error || '安全校验不通过');
    return Response.json(
      {
        ok: false,
        sql: rawSql,
        error: `${hint.label}：${hint.message}`,
        suggestion: hint.suggestion,
        category: hint.category,
      },
      { status: 400 },
    );
  }
  const sql = validated.sql!;

  // 2) 执行查询（执行期错误返回 ok:false，交给前端展示，不算 500）
  try {
    const res = await query(sql);
    const dbResult = { rows: res.rows, fields: res.fields };
    const components = buildResultComponents(dbResult);
    if (!components.length) {
      components.push({
        type: 'markdown',
        data: { content: '✅ 查询执行成功，但未返回可展示的数据。' },
      });
    }
    return Response.json({
      ok: true,
      sql,
      title: '自定义查询结果',
      // 摘要里带上具体数值：单行结果（SUM/COUNT）直接把值写出来，
      // 否则对话区只会显示「共 N 行」，用户会以为重新执行没生效。
      summary: buildRowsSummary(dbResult),
      components,
    });
  } catch (err: any) {
    const raw = err?.message || String(err);
    const hint = classifyError(raw);
    return Response.json({
      ok: false,
      sql,
      error: `${hint.label}：${hint.message}`,
      suggestion: hint.suggestion,
      category: hint.category,
      detail: raw,
    });
  }
}
