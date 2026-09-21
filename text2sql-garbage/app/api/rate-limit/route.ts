import { getDailyUsage, isRateLimitEnabled } from '@/lib/rate-limit';

// 限流状态查询（前端「今日剩余 N 次」提示用）。
// 只读不消耗配额；强制动态渲染，避免被 CDN/Next 缓存成旧值。
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const enabled = isRateLimitEnabled();
  try {
    const usage = await getDailyUsage();
    return new Response(
      JSON.stringify({
        enabled,
        used: usage.used,
        limit: usage.limit,
        remaining: usage.remaining,
        resetAt: usage.resetAt,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (e) {
    // 计数表异常不影响主流程：返回「未知」状态，前端降级展示
    console.error('[rate-limit] 状态查询失败：', e);
    return new Response(
      JSON.stringify({ enabled, used: 0, limit: 0, remaining: 0, resetAt: null, error: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    );
  }
}
