import type { ChartPoint, OutputConfig, TableData } from './types';

/** 从结果里取第一个可用的表格 */
export function getTable(result: OutputConfig | null | undefined): TableData | null {
  if (!result?.components?.length) return null;

  for (const comp of result.components) {
    const data = comp?.data;
    if (comp?.type !== 'table' || !data?.columns || !Array.isArray(data.rows)) continue;

    const columns = (data.columns as any[]).map((col, i) => {
      const field = col?.field ?? col?.key ?? col?.name ?? col?.prop ?? i;
      return {
        field: String(field),
        label: String(col?.label ?? col?.title ?? col?.name ?? field ?? `列 ${i + 1}`),
      };
    });

    const rows = (data.rows as any[]).map((row) =>
      row && typeof row === 'object' ? (row as Record<string, any>) : {},
    );

    if (columns.length) return { columns, rows };
  }

  return null;
}

/** 收集 image 组件（FR4 契约里 image 类型，之前只声明未渲染） */
export function getImages(
  result: OutputConfig | null | undefined,
): { src: string; alt: string }[] {
  if (!result?.components?.length) return [];
  const images: { src: string; alt: string }[] = [];
  for (const comp of result.components) {
    if (comp?.type !== 'image') continue;
    const data = comp?.data;
    const src =
      typeof data === 'string'
        ? data
        : typeof data?.url === 'string'
          ? data.url
          : typeof data?.src === 'string'
            ? data.src
            : typeof data?.content === 'string'
              ? data.content
              : '';
    if (!src) continue;
    const alt =
      typeof data?.alt === 'string' ? data.alt : typeof data?.title === 'string' ? data.title : '结果图片';
    images.push({ src, alt });
  }
  return images;
}

/** 汇总所有 markdown 组件的内容（作为分析结论） */
export function getMarkdown(result: OutputConfig | null | undefined): string {
  if (!result?.components?.length) return '';

  return result.components
    .filter((comp) => comp?.type === 'markdown')
    .map((comp) => {
      const data = comp?.data;
      if (typeof data === 'string') return data;
      if (typeof data?.content === 'string') return data.content;
      if (typeof data?.text === 'string') return data.text;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/** 助手气泡要展示的正文 */
export function getAnswer(result: OutputConfig | null | undefined): string {
  if (!result) return '';
  const markdown = getMarkdown(result);
  const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
  if (summary && markdown) return markdown.includes(summary) ? markdown : `${summary}\n\n${markdown}`;
  return summary || markdown;
}

function toNumber(value: any): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[,，\s%]/g, '');
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toPointLabel(value: any, index: number): string {
  if (value === null || value === undefined || value === '') return `#${index + 1}`;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value.slice(5, 10);
  }
  return String(value);
}

/** 从 echarts 组件里提取数据点 */
function pointsFromEcharts(comp: any): ChartPoint[] {
  const option = comp?.data?.option ?? comp?.data;
  const series = Array.isArray(option?.series) ? option.series[0] : null;
  const rawSeries = series?.data;
  if (!Array.isArray(rawSeries)) return [];

  // 两种结构都要认：
  // 1) 标准 echarts：{ xAxis: { data: [...] } } / { xAxis: [{ data: [...] }] }
  // 2) 后端精简结构：{ xAxisData: [...] }
  const xAxis = option?.xAxis;
  const categories =
    (Array.isArray(xAxis) ? xAxis[0]?.data : xAxis?.data) ??
    (Array.isArray(option?.xAxisData) ? option.xAxisData : null) ??
    (Array.isArray(option?.categories) ? option.categories : null) ??
    null;

  const points: ChartPoint[] = [];
  rawSeries.forEach((item: any, i: number) => {
    const value = toNumber(item?.value ?? item);
    if (value === null) return;
    const label = categories?.[i] ?? item?.name ?? `#${i + 1}`;
    points.push({ label: toPointLabel(label, i), value });
  });

  return points;
}

/** 判断某列是否基本是数值列 */
function isNumericColumn(rows: Record<string, any>[], field: string): boolean {
  let hits = 0;
  let total = 0;
  for (const row of rows.slice(0, 40)) {
    const raw = row[field];
    if (raw === null || raw === undefined || raw === '') continue;
    total += 1;
    if (toNumber(raw) !== null) hits += 1;
  }
  return total > 0 && hits / total >= 0.8;
}

/** 从表格里推断「类别列 + 数值列」，生成图表数据 */
function pointsFromTable(table: TableData): ChartPoint[] {
  const { columns, rows } = table;
  if (!rows.length) return [];

  const valueCol = columns.find((col) => isNumericColumn(rows, col.field));
  if (!valueCol) return [];

  const labelCol =
    columns.find((col) => col.field !== valueCol.field && !isNumericColumn(rows, col.field)) ??
    columns.find((col) => col.field !== valueCol.field) ??
    valueCol;

  const points: ChartPoint[] = [];
  rows.forEach((row, i) => {
    const value = toNumber(row[valueCol.field]);
    if (value === null) return;
    points.push({ label: toPointLabel(row[labelCol.field], i), value });
  });

  // 数据过多时保留最近的若干条，避免图形挤成一团
  return points.length > 40 ? points.slice(-40) : points;
}

/** 图表数据：优先 echarts 组件，其次从表格推断 */
export function getChartPoints(result: OutputConfig | null | undefined): ChartPoint[] {
  if (!result?.components?.length) return [];

  const echartsComp = result.components.find((comp) => comp?.type === 'echarts');
  if (echartsComp) {
    const points = pointsFromEcharts(echartsComp);
    if (points.length) return points;
  }

  const table = getTable(result);
  return table ? pointsFromTable(table) : [];
}

/** 尝试从数值列名里抽出单位，例如「垃圾清运量（吨）」→「吨」 */
export function getChartUnit(result: OutputConfig | null | undefined): string | undefined {
  const table = getTable(result);
  if (!table?.rows.length) return undefined;

  // 只在真正的数值列上找单位，避免把「日期（YYYY-MM-DD）」当成单位
  const numericCols = table.columns.filter((col) => isNumericColumn(table.rows, col.field));
  for (const col of numericCols) {
    const matched = /[（(]([^（）()]{1,6})[）)]/.exec(col.label);
    if (matched) return matched[1];
  }
  return undefined;
}
