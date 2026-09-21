import { describe, it, expect } from 'vitest';
import {
  buildTableComponent,
  buildEchartsComponent,
  buildResultComponents,
  buildRowsSummary,
  isNumericColumn,
} from '../result-builder';

const dbResult = {
  rows: [
    { region_name: '西湖区', total_weight: 152300 },
    { region_name: '滨江区', total_weight: 148700 },
    { region_name: '余杭区', total_weight: 121000 },
  ],
  fields: [
    { name: 'region_name' },
    { name: 'total_weight' },
  ],
};

describe('buildTableComponent', () => {
  it('列 label 中文化', () => {
    const comp = buildTableComponent(dbResult);
    expect(comp).not.toBeNull();
    expect(comp!.type).toBe('table');    expect(comp!.data.columns[0].label).toBe('区域');
    // 值原样保留
    expect(comp!.data.rows[0]['区域' as string] ?? comp!.data.rows[0].region_name).toBe('西湖区');
  });

  it('空结果返回 null', () => {
    expect(buildTableComponent({ rows: [], fields: [] })).toBeNull();
  });
});

describe('buildEchartsComponent', () => {
  it('数值列生成柱状图，系列名中文化', () => {
    const comp = buildEchartsComponent(dbResult);
    expect(comp).not.toBeNull();
    expect(comp!.type).toBe('echarts');
    expect(comp!.data.series[0].name).toBe('总清运量');
    expect(comp!.data.xAxisData).toEqual(['西湖区', '滨江区', '余杭区']);
  });

  it('纯文本结果不生成图表', () => {
    const text = {
      rows: [{ status: 'completed' }],
      fields: [{ name: 'status' }],
    };
    expect(buildEchartsComponent(text)).toBeNull();
  });
});

describe('buildResultComponents', () => {
  it('同时产出 table 与 echarts', () => {
    const comps = buildResultComponents(dbResult);
    expect(comps.map((c) => c.type).sort()).toEqual(['echarts', 'table']);
  });
});

describe('buildRowsSummary', () => {
  // 回归：重新执行 SUM 这类单行查询时，摘要必须带上数值，
  // 否则对话区只显示「共返回 1 行」，用户以为没拿到新数据。
  it('单行结果直接给出数值（带千分位）', () => {
    const summary = buildRowsSummary({
      rows: [{ 总清运量_kg: '84365' }],
      fields: [{ name: '总清运量_kg' }],
    });
    expect(summary).toContain('84,365');
    expect(summary).not.toMatch(/共返回 \*\*1\*\* 行/);
  });

  it('单行空值显示「无数据」', () => {
    const summary = buildRowsSummary({
      rows: [{ 总清运量_kg: null }],
      fields: [{ name: '总清运量_kg' }],
    });
    expect(summary).toContain('无数据');
  });

  it('多行结果给出行数 + 首行预览', () => {
    const summary = buildRowsSummary(dbResult);
    expect(summary).toContain('共返回 **3** 行');
    expect(summary).toContain('西湖区');
  });

  it('零行结果给出明确提示', () => {
    expect(buildRowsSummary({ rows: [], fields: [] })).toContain('未返回任何数据');
  });
});

describe('isNumericColumn', () => {
  // 回归：date 列经 pg 返回为字符串 '2026-09-12'，原实现用 parseFloat 会得到 2026，
  // 误判成数值列，导致图表把日期维度当成度量。修复后日期列不应被判为数值。
  it('日期字符串列不应被误判为数值列', () => {
    const rows = [
      { route_date: '2026-09-12', total: 100 },
      { route_date: '2026-09-13', total: 200 },
      { route_date: '2026-09-14', total: 300 },
    ];
    expect(isNumericColumn(rows, 'route_date')).toBe(false);
    expect(isNumericColumn(rows, 'total')).toBe(true);
  });
});
