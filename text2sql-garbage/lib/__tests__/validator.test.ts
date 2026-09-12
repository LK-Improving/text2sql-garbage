import { describe, it, expect } from 'vitest';
import { validateSQL, stripLiteralsAndComments } from '../validator';

describe('stripLiteralsAndComments', () => {
  it('把字符串字面量替换成空串，避免误杀', () => {
    const out = stripLiteralsAndComments("SELECT * FROM t WHERE name = 'DELETE FROM t_x'");
    expect(out).not.toContain('DELETE');
    expect(out).toContain("name = ''");
  });

  it('剥离行注释与块注释', () => {
    const sql = `SELECT /* this is a DROP */ id FROM t_region -- comment with INSERT`;
    const out = stripLiteralsAndComments(sql);
    expect(out).not.toContain('DROP');
    expect(out).not.toContain('INSERT');
  });
});

describe('validateSQL — 只读校验', () => {
  it('放行合法只读 SELECT 并自动补 LIMIT', () => {
    const r = validateSQL('SELECT id, region_name FROM t_region');
    expect(r.valid).toBe(true);
    expect(r.sql).toContain('LIMIT 1000');
    expect(r.tables).toContain('t_region');
  });

  it('支持 WITH ... SELECT 形式的 CTE', () => {
    const r = validateSQL(
      "WITH month_alert AS (SELECT vehicle_id FROM t_alert) SELECT vehicle_id FROM month_alert",
    );
    expect(r.valid).toBe(true);
    // CTE 名不应被当成真实表误拦
    expect(r.error).toBeUndefined();
  });

  it('拦下写操作 DELETE', () => {
    const r = validateSQL("DELETE FROM t_region WHERE id = 1");
    expect(r.valid).toBe(false);
    // 注意：DELETE 会在「必须是只读查询」那步就被拦下（早于写操作关键字检查），两者都算拒绝
    expect(r.error).toMatch(/仅允许 SELECT|禁止的操作/);
  });

  it('拦下 DROP', () => {
    const r = validateSQL('DROP TABLE t_region');
    expect(r.valid).toBe(false);
  });

  it('拦下危险函数 pg_sleep', () => {
    const r = validateSQL('SELECT pg_sleep(10) FROM t_region');
    expect(r.valid).toBe(false);
  });

  it('拦下白名单外的表', () => {
    const r = validateSQL('SELECT * FROM t_secret LIMIT 10');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('不允许访问的表');
  });

  it('把超过上限的 LIMIT 收敛到 10000', () => {
    const r = validateSQL('SELECT id FROM t_region LIMIT 99999');
    expect(r.valid).toBe(true);
    expect(r.sql).toContain('LIMIT 10000');
  });

  it('多语句（带分号）一律拒绝', () => {
    const r = validateSQL('SELECT 1 FROM t_region; SELECT 2 FROM t_region');
    expect(r.valid).toBe(false);
  });
});
