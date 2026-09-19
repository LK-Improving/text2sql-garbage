// app/api/feedback/route.ts
//
// 评价回答（点赞/点踩）的服务端信号落盘：best-effort 追加到 logs/feedback-YYYY-MM-DD.jsonl，
// 复用 lib/audit 的文件写入模式（不阻塞 UI、失败仅告警）。
// 前端以 localStorage 的 t2s.ratings 为展示状态权威源；本端点只为后续（Phase 2 云端同步 +
// 账号体系）的「反馈分析 / 模型评估」积累服务端原始数据，当前不参与任何业务逻辑分支。

import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const turnId = typeof body?.turnId === 'string' ? body.turnId : '';
  const value: 'up' | 'down' =
    body?.value === 'up' || body?.value === 'down' ? body.value : '';
  if (!turnId || !value) {
    return Response.json({ ok: false, error: '缺少 turnId 或 value' }, { status: 400 });
  }

  const record = {
    turnId,
    conversationId:
      typeof body?.conversationId === 'string' ? body.conversationId : null,
    value,
    at: new Date().toISOString(),
  };

  try {
    const dir = path.resolve(process.cwd(), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `feedback-${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    return Response.json({ ok: true });
  } catch (e) {
    console.warn('[feedback] 写入反馈日志失败：', e);
    // 前端不依赖此结果，失败也返回 ok，避免前端报错
    return Response.json({ ok: true });
  }
}
