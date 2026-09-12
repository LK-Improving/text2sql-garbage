// app/api/execute/route.ts
//
// 「编辑 SQL → 重新执行」闭环的后端：只接受已经写好的 SQL，走与 /api/chat 相同的
// 安全校验（黑名单 + 表名白名单 + 强制 LIMIT）后直接查库，**不再调用大模型**。

import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { validateSQL } from '@/lib/validator';
import { buildResultComponents } from '@/lib/result-builder';

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
    return Response.json({ ok: false, sql: rawSql, error: validated.error }, { status: 400 });
  }
  const sql = validated.sql!;

  // 2) 执行查询（执行期错误返回 ok:false，交给前端展示，不算 500）
  try {
    const res = await query(sql);
    const components = buildResultComponents({ rows: res.rows, fields: res.fields });
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
      summary: `已重新执行修改后的 SQL，共返回 **${res.rows.length}** 行。`,
      components,
    });
  } catch (err: any) {
    return Response.json({ ok: false, sql, error: err?.message || String(err) });
  }
}
