// app/api/export-excel/route.ts
//
// 前端表格导出为 Excel（FR5）。**不依赖 OSS**：用 exceljs 在服务端内存里生成 xlsx，
// 直接以附件形式回给浏览器下载；同时在项目 downloads/ 目录留一份本地副本便于排查。
// 这样既满足了「前端能下载」，又不引入任何云存储凭证。

import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

const MAX_ROWS = 10000; // 防 OOM：超过则拒绝
const MAX_COLS = 60;

/** Excel 工作表名：≤31 字符，且不能含 : \ / ? * [ ] */
function sanitizeSheetName(name: string): string {
  const cleaned = (name || '')
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 31) || '查询结果';
}

/** 文件名安全化（去掉非法字符，控制长度） */
function sanitizeFileName(name: string): string {
  const cleaned = (name || '查询结果')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return cleaned || '查询结果';
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const columns = Array.isArray(body?.columns) ? body.columns : null;
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  const title = typeof body?.title === 'string' ? body.title : '查询结果';

  if (!columns || !rows) {
    return Response.json({ ok: false, error: '缺少 columns 或 rows' }, { status: 400 });
  }
  if (!columns.length) {
    return Response.json({ ok: false, error: '没有可导出的列' }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return Response.json(
      { ok: false, error: `数据量过大（${rows.length} 行 > 上限 ${MAX_ROWS} 行），请缩小查询范围后再导出` },
      { status: 413 },
    );
  }
  if (columns.length > MAX_COLS) {
    return Response.json({ ok: false, error: `列数过多（> ${MAX_COLS} 列）` }, { status: 413 });
  }

  const cols: { field: string; label: string }[] = columns
    .slice(0, MAX_COLS)
    .map((c: any, i: number) => {
    const field = String(c?.field ?? c?.key ?? c?.name ?? i);
    const label = String(c?.label ?? c?.title ?? c?.name ?? c?.field ?? `列${i + 1}`);
    return { field, label };
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'text2sql-garbage';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sanitizeSheetName(title));
  worksheet.columns = cols.map((c) => ({ header: c.label, key: c.field, width: 18 }));
  // 表头样式（加粗 + 浅灰底）
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };

  for (const row of rows.slice(0, MAX_ROWS)) {
    const obj: Record<string, any> = {};
    for (const c of cols) {
      let v = row?.[c.field];
      if (v === null || v === undefined) v = '';
      else if (v instanceof Date) v = v.toISOString();
      else if (typeof v === 'object') v = JSON.stringify(v);
      obj[c.field] = v;
    }
    worksheet.addRow(obj);
  }

  let buffer: Buffer;
  try {
    const raw = await workbook.xlsx.writeBuffer();
    buffer = Buffer.from(raw as unknown as ArrayBuffer);
  } catch (err: any) {
    return Response.json(
      { ok: false, error: `生成 Excel 失败：${err?.message || err}` },
      { status: 500 },
    );
  }

  const fileName = `${sanitizeFileName(title)}_${timestamp()}.xlsx`;

  // 本地留存一份（downloads/ 已 gitignore）；写盘失败不影响下载
  try {
    const dir = path.join(process.cwd(), 'downloads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), buffer);
  } catch {
    /* 忽略本地留存失败 */
  }

  const asciiFallback = `export_${timestamp()}.xlsx`;
  return new Response(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 中文文件名用 RFC 5987 的 filename*（UTF-8），并保留 ASCII 兜底
      'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(
        fileName,
      )}`,
      'Cache-Control': 'no-cache',
      'Content-Length': String(buffer.length),
    },
  });
}
