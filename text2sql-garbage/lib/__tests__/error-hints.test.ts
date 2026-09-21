import { describe, it, expect } from 'vitest';
import { classifyError, formatErrorHint } from '../error-hints';

describe('classifyError', () => {
  it('字段不存在 → field', () => {
    expect(classifyError('column "region" does not exist').category).toBe('field');
  });

  it('表不存在 → table', () => {
    expect(classifyError('relation "t_xxx" does not exist').category).toBe('table');
  });

  it('安全拦截（写操作）→ permission', () => {
    expect(classifyError('禁止的操作：DROP').category).toBe('permission');
  });

  // 回归：validator 的原文是「仅允许 SELECT 查询（支持 WITH ... SELECT）」，
  // 旧正则写死小写导致匹配不上，DELETE 会被显示成「执行失败」。
  it('安全拦截（非 SELECT）→ permission', () => {
    const hint = classifyError('仅允许 SELECT 查询（支持 WITH ... SELECT）');
    expect(hint.category).toBe('permission');
    expect(hint.label).toBe('安全拦截');
    expect(hint.message).not.toContain('SQL 执行失败');
  });

  it('白名单外表 → table', () => {
    expect(classifyError('不允许访问的表：t_secret').category).toBe('table');
  });

  it('语法错误 → syntax', () => {
    expect(classifyError('syntax error at or near "FROM"').category).toBe('syntax');
  });

  it('超时 → timeout', () => {
    expect(classifyError('canceling statement due to statement timeout').category).toBe('timeout');
  });

  it('连接失败 → connection', () => {
    expect(classifyError('connect ECONNREFUSED 127.0.0.1:5432').category).toBe('connection');
  });

  it('未知错误 → unknown', () => {
    expect(classifyError('something weird happened').category).toBe('unknown');
  });

  it('formatErrorHint 产出可展示的中文 markdown', () => {
    const { markdown, hint } = formatErrorHint('column "x" does not exist');
    expect(hint.category).toBe('field');
    expect(markdown).toContain('字段不存在');
  });
});
