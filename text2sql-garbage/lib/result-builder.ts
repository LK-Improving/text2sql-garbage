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
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
    if (Number.isFinite(v)) hits += 1;
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
