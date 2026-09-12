import { describe, it, expect } from 'vitest';
import { getTable, getChartPoints, getChartUnit, getImages } from '../derive';

const result = {
  sql: 'SELECT region_name, total_weight FROM t_route_manifest',
  title: 't',
  summary: 's',
  components: [
    { type: 'markdown', data: { content: '摘要' } },
    {
      type: 'table',
      data: {
        columns: [
          { field: 'region_name', label: '区域' },
          { field: 'total_weight', label: '总清运量' },
        ],
        rows: [
          { region_name: '西湖区', total_weight: 152300 },
          { region_name: '滨江区', total_weight: 148700 },
        ],
      },
    },
    {
      type: 'echarts',
      data: {
        chartType: 'bar',
        title: '总清运量 对比',
        xAxisData: ['西湖区', '滨江区'],
        series: [{ name: '总清运量', data: [152300, 148700] }],
      },
    },
  ],
};

describe('getTable', () => {
  it('从 table 组件提取列与行', () => {
    const t = getTable(result as any);
    expect(t).not.toBeNull();
    expect(t!.columns).toHaveLength(2);
    expect(t!.rows).toHaveLength(2);
  });

  it('无 table 组件时返回 null', () => {
    expect(getTable({ components: [] } as any)).toBeNull();
  });
});

describe('getChartPoints', () => {
  it('优先从 echarts 组件抽取数据点', () => {
    const pts = getChartPoints(result as any);
    expect(pts).toEqual([
      { label: '西湖区', value: 152300 },
      { label: '滨江区', value: 148700 },
    ]);
  });

  it('缺失 echarts 时从 table 推断', () => {
    const noChart = {
      components: [
        {
          type: 'table',
          data: {
            columns: [
              { field: 'region_name', label: '区域' },
              { field: 'total_weight', label: '总清运量' },
            ],
            rows: [{ region_name: '西湖区', total_weight: 100 }],
          },
        },
      ],
    };
    const pts = getChartPoints(noChart as any);
    expect(pts).toHaveLength(1);
    expect(pts[0].value).toBe(100);
  });
});

describe('getChartUnit', () => {
  it('从数值列标签里抽单位', () => {
    const r = {
      components: [
        {
          type: 'table',
          data: {
            columns: [
              { field: 'region_name', label: '区域' },
              { field: 'total_weight', label: '总清运量(kg)' },
            ],
            rows: [{ region_name: 'a', total_weight: 1 }],
          },
        },
      ],
    };
    expect(getChartUnit(r as any)).toBe('kg');
  });
});

describe('getImages', () => {
  it('收集 image 组件并提取 src', () => {
    const r = {
      components: [
        { type: 'image', data: { url: 'http://x/a.png', alt: '图A' } },
        { type: 'markdown', data: { content: 'x' } },
      ],
    };
    const imgs = getImages(r as any);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].src).toBe('http://x/a.png');
    expect(imgs[0].alt).toBe('图A');
  });

  it('无 image 组件时返回空', () => {
    expect(getImages({ components: [] } as any)).toEqual([]);
  });
});
