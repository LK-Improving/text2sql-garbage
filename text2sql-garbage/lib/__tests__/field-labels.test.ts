import { describe, it, expect } from 'vitest';
import { humanizeField, localizeColumns } from '../field-labels';

describe('humanizeField', () => {
  it('把字段名映射成中文业务名', () => {
    expect(humanizeField('total_weight')).toBe('总清运量');
    expect(humanizeField('region_name')).toBe('区域');
    expect(humanizeField('plate_number')).toBe('车牌号');
  });

  it('带 _kg 后缀时抽成单位括号', () => {
    expect(humanizeField('total_weight_kg')).toBe('总清运量(kg)');
  });

  it('聚合前缀 sum_ 被剥离', () => {
    expect(humanizeField('sum_total_weight')).toBe('总清运量');
  });

  it('模型给的中文别名原样保留', () => {
    expect(humanizeField('车牌号')).toBe('车牌号');
  });

  it('未知字段做保底美化', () => {
    expect(humanizeField('some_field_name')).toBe('some field name');
  });
});

describe('localizeColumns', () => {
  it('批量把列 label 中文化', () => {
    const cols = [
      { field: 'region_name', label: 'region_name' },
      { field: 'total_weight', label: 'total_weight' },
    ];
    const out = localizeColumns(cols);
    expect(out[0].label).toBe('区域');
    expect(out[1].label).toBe('总清运量');
  });
});
