// lib/result-builder.ts
//
// 把「数据库查询结果 → 前端渲染组件」的逻辑集中到这里，供 /api/chat 与 /api/execute 复用，
// 避免两套实现漂移（之前只在 route.ts 里有一份，/api/execute 若再抄一份迟早对不齐）。

import type { OutputComponent } from '@/app/components/types';
import { humanizeField } from './field-labels';

export type DbResult = { rows: any[]; fields: { name: string }[] };

/** 判断某列是否基本是数值列（用于图表推断与表格右对齐） */
export function isNumericColumn(rows: Record<string, any>[], field: string): boolean {
  let hits = 0;
  let total = 0;
  for (const row of rows.slice(0, 40)) {
    const raw = row[field];
    if (raw === null || raw === undefined || raw === '') continue;
    total += 1;
    // 严格数值判定：用正则排除日期（'2026-09-12' 经 parseFloat 会得到 2026，误判成数值）、
    // 带冒号的时间等；否则 date 维度列会被当成度量列，图表 X/Y 轴就选错了。
    const text = String(raw).trim();
    const isNum =
      /^-?[\d,]+(\.\d+)?$/.test(text) && Number.isFinite(Number(text.replace(/,/g, '')));
    if (isNum) hits += 1;
  }
  return total > 0 && hits / total >= 0.8;
}

export function buildTableComponent(dbResult: DbResult): OutputComponent | null {
  if (!dbResult?.rows?.length || !dbResult.fields?.length) return null;
  // label 走中文化：字段名 → 业务名（如 total_weight → 总清运量(kg)），
  // 表格表头、CSV、Excel 三处导出的表头都从这里取，改一处即全生效。
  const columns = dbResult.fields.map((f) => ({ field: f.name, label: humanizeField(f.name) }));
  const rows = dbResult.rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const col of columns) obj[col.field] = row[col.field] ?? null;
    return obj;
  });
  return { type: 'table', data: { columns, rows } };
}

export function buildEchartsComponent(dbResult: DbResult): OutputComponent | null {
  if (!dbResult?.rows?.length || !dbResult.fields?.length) return null;
  const rows = dbResult.rows.map((row) => {
    const obj: Record<string, any> = {};
    for (const f of dbResult.fields) obj[f.name] = row[f.name];
    return obj;
  });
  const fieldNames = dbResult.fields.map((f) => f.name);
  const numericFields = fieldNames.filter((f) => isNumericColumn(rows, f));
  if (!numericFields.length) return null;
  const labelField = fieldNames.find((f) => !numericFields.includes(f)) ?? fieldNames[0];
  const valueField = numericFields[0];
  const xAxisData = rows.map((r) => String(r[labelField] ?? ''));
  const seriesData = rows.map((r) => {
    const v = r[valueField];
    return typeof v === 'number' ? v : parseFloat(String(v)) || 0;
  });
  if (xAxisData.length < 2) return null;
  const valueLabel = humanizeField(valueField);
  return {
    type: 'echarts',
    data: {
      chartType: 'bar',
      title: `${valueLabel} 对比`,
      xAxisData,
      series: [{ name: valueLabel, data: seriesData }],
    },
  };
}

/** 同时构建 table + echarts（有数据时才给对应组件），顺序与 /api/chat 保持一致 */
export function buildResultComponents(dbResult: DbResult): OutputComponent[] {
  const comps: OutputComponent[] = [];
  const tableComp = buildTableComponent(dbResult);
  const echartsComp = buildEchartsComponent(dbResult);
  if (tableComp) comps.push(tableComp);
  if (echartsComp) comps.push(echartsComp);
  return comps;
}

/** 数值/文本格式化：数字带千分位，空值统一说「无数据」 */
function formatValue(raw: any): string {
  if (raw === null || raw === undefined || raw === '') return '无数据';
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : String(raw);
  }
  const text = String(raw).trim();
  if (/^-?[\d,]+(\.\d+)?$/.test(text)) {
    const n = Number(text.replace(/,/g, ''));
    if (Number.isFinite(n)) return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  return text;
}

/**
 * 把查询结果压成**对话区可见**的一句话摘要。
 *
 * 之前 /api/execute 只回「共返回 N 行」，而对话区正文直接取 summary，
 * 于是「SUM 查最近 30 天」这种单行结果在对话里只显示行数、不显示数值，
 * 用户会以为「重新执行没生效 / 没给新数据」。这里单行结果直接把字段值摆出来。
 */
export function buildRowsSummary(dbResult: DbResult, maxFields = 4): string {
  const rows = dbResult?.rows ?? [];
  const fields = dbResult?.fields ?? [];
  if (!rows.length) return '已重新执行修改后的 SQL，但未返回任何数据。';

  // 单行结果（SUM / COUNT / 单条明细）：把字段值直接摆进摘要
  if (rows.length === 1 && fields.length) {
    const shown = fields.slice(0, maxFields);
    const parts = shown.map((f) => `${humanizeField(f.name)}：**${formatValue(rows[0][f.name])}**`);
    const more = fields.length > shown.length ? `（另有 ${fields.length - shown.length} 个字段未展开）` : '';
    return `已重新执行修改后的 SQL，结果：${parts.join('　·　')}${more}`;
  }

  // 多行结果：给出条数，并用第一行的「类别列 + 数值列」做个预览
  const numericField = fields.find((f) => isNumericColumn(rows, f.name));
  const textField = fields.find((f) => f.name !== numericField?.name);
  const preview =
    textField && numericField && rows.length > 1
      ? `，如 ${humanizeField(textField.name)} **${formatValue(rows[0][textField.name])}** 为 **${formatValue(rows[0][numericField.name])}**`
      : '';
  return `已重新执行修改后的 SQL，共返回 **${rows.length}** 行${preview}，完整数据见右侧结果面板。`;
}
