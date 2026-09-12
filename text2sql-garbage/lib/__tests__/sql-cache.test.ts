import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCacheKey,
  getCachedPlan,
  setCachedPlan,
  clearSqlCache,
  normalizeQuestion,
} from '../sql-cache';

const plan = {
  sql: 'SELECT 1',
  title: 't',
  summary: 's',
  components: [],
};

describe('sql-cache', () => {
  beforeEach(() => clearSqlCache());

  it('normalizeQuestion 忽略空格与标点差异', () => {
    expect(normalizeQuestion('查各区域清运量？')).toBe(normalizeQuestion('查各区域清运量'));
  });

  it('同问题同历史 → 相同 key', () => {
    const k1 = makeCacheKey('各区域清运量', 'user:上月');
    const k2 = makeCacheKey('各区域清运量', 'user:上月');
    expect(k1).toBe(k2);
    expect(k1).not.toBe('');
  });

  it('缓存命中后取出计划', () => {
    const key = makeCacheKey('各区域清运量', '');
    setCachedPlan(key, plan);
    const hit = getCachedPlan(key);
    expect(hit).not.toBeNull();
    expect(hit!.plan.sql).toBe('SELECT 1');
  });

  it('空 key 不命中也不写入', () => {
    expect(getCachedPlan('')).toBeNull();
    setCachedPlan('', plan);
    expect(getCachedPlan('')).toBeNull();
  });
});
