import { describe, it, expect, afterEach, vi } from 'vitest';
import { isRateLimitEnabled, beijingDateStr } from '../rate-limit';

afterEach(() => {
  // 还原受测环境变量，避免用例间互相污染
  vi.unstubAllEnvs();
});

describe('rate-limit 纯函数', () => {
  it('isRateLimitEnabled：默认非生产环境关闭', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('RATE_LIMIT_ENABLED', '');
    expect(isRateLimitEnabled()).toBe(false);
  });

  it('isRateLimitEnabled：生产环境默认开启', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_ENABLED', '');
    expect(isRateLimitEnabled()).toBe(true);
  });

  it('isRateLimitEnabled：RATE_LIMIT_ENABLED=true 强制开启（即便非生产）', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RATE_LIMIT_ENABLED', 'true');
    expect(isRateLimitEnabled()).toBe(true);
  });

  it('isRateLimitEnabled：RATE_LIMIT_ENABLED=false 强制关闭（即便生产）', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RATE_LIMIT_ENABLED', 'false');
    expect(isRateLimitEnabled()).toBe(false);
  });

  it('beijingDateStr：返回 YYYY-MM-DD 格式', () => {
    const s = beijingDateStr(new Date('2026-09-21T14:00:00.000Z')); // 北京 22:00 → 仍是 09-21
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s).toBe('2026-09-21');
  });

  it('beijingDateStr：跨 UTC 日界仍按北京自然日计日', () => {
    // UTC 2026-09-21T18:00:00Z = 北京 2026-09-22T02:00 → 应归入 09-22
    const s = beijingDateStr(new Date('2026-09-21T18:00:00.000Z'));
    expect(s).toBe('2026-09-22');
  });
});
