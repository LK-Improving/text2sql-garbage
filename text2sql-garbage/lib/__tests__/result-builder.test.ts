import { describe, it, expect } from 'vitest';
import {
  buildTableComponent,
  buildEchartsComponent,
  buildResultComponents,
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
    expect(comp!.type).toBe('table');
    expect(comp!.data.columns[0].label).toBe('区域');
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
