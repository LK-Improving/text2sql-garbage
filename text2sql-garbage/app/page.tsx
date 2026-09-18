// app/page.tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import {
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  ResultPanel,
} from './components/ResultPanel';
import { Sidebar } from './components/Sidebar';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { classifyError } from '@/lib/error-hints';
import type { ChatMessage, OutputConfig, ResultTab, Turn } from './components/types';

const FALLBACK_ERROR = '请求失败，请检查网络或稍后重试。';

/** 布局偏好持久化 key */
const PANEL_WIDTH_KEY = 't2s.panelWidth';
const SIDEBAR_KEY = 't2s.sidebarCollapsed';

/** 面板拉到最宽时，给中间对话区保留的最小宽度 */
const CHAT_MIN_WIDTH = 460;

/** 兼容 LangChain chunk.content 的多种形态（string / 内容块数组） */
function normalizeChunk(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '',
      )
      .join('');
  }
  if (content && typeof content === 'object' && typeof (content as any).text === 'string') {
    return (content as any).text;
  }
  return '';
}

export default function Home() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<ResultTab>('overview');
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 移动端导航抽屉（汉堡菜单）开合状态 */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [rerunning, setRerunning] = useState(false);

  const busyRef = useRef(false);
  /** turns 的镜像：ask 的 useCallback 依赖为空，直接读 turns 会拿到旧值，用 ref 规避陈旧闭包 */
  const turnsRef = useRef<Turn[]>([]);

  /** 面板宽度收敛到 [MIN, MAX]，并保证对话区不会被挤没 */
  const clampPanelWidth = useCallback((value: number) => {
    const viewport = typeof window === 'undefined' ? 1440 : window.innerWidth;
    const max = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, viewport - CHAT_MIN_WIDTH));
    return Math.round(Math.min(Math.max(value, MIN_PANEL_WIDTH), max));
  }, []);

  // ⚠️ 布局偏好只在触发操作时落盘，绝不放进「state → effect 写存储」的链路：
  // 严格模式下 effect 会挂载两次，写入 effect 会在「恢复 effect」第二次执行前
  // 把初始值写回存储，导致刷新后恢复失败。
  const persistLayout = useCallback((key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* 隐私模式 / 存储被禁用，忽略 */
    }
  }, []);

  const handlePanelWidth = useCallback(
    (next: number) => {
      const clamped = clampPanelWidth(next);
      setPanelWidth(clamped);
      persistLayout(PANEL_WIDTH_KEY, String(clamped));
    },
    [clampPanelWidth, persistLayout],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      persistLayout(SIDEBAR_KEY, next ? '1' : '0');
      return next;
    });
  }, [persistLayout]);

  const loading = turns.some((turn) => turn.status === 'streaming');
  const latestTurn = turns.length ? turns[turns.length - 1] : null;

  // 同步 turns 到 ref（供 ask 构造多轮上下文）
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const historyItems = useMemo(
    () => [...turns].reverse().map((turn) => ({ id: turn.id, question: turn.question })),
    [turns],
  );

  // 首次挂载：恢复上次的布局偏好（放 effect 里避免 SSR/CSR 不一致）
  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      setPanelWidth(clampPanelWidth(savedWidth));
    }
    if (window.localStorage.getItem(SIDEBAR_KEY) === '1') setSidebarCollapsed(true);
  }, [clampPanelWidth]);

  // 视口变化时重新收敛宽度
  useEffect(() => {
    const onResize = () => setPanelWidth((w) => clampPanelWidth(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPanelWidth]);

  // 提示 2.6s 后自动消失
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** 除「点击 FAQ / 输入问题」以外的功能统一提示暂未开放 */
  const showUnavailable = useCallback((feature: string) => {
    setToast({ key: Date.now(), text: `「${feature}」暂未开放，敬请期待` });
  }, []);

  /** 已实现功能的操作反馈（复制成功、导出完成等） */
  const notify = useCallback((message: string) => {
    setToast({ key: Date.now(), text: message });
  }, []);

  /** 结果面板「重新执行」：把编辑后的 SQL 交给 /api/execute（走校验但不过大模型） */
  const handleRerun = useCallback(
    async (sql: string) => {
      const targetId = latestTurn?.id;
      if (!targetId || !sql.trim() || rerunning) return;
      setRerunning(true);
      try {
        const res = await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        });
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          /* 响应体不是 JSON */
        }

        if (!res.ok || !data?.ok) {
          const hint = classifyError(data?.error || `执行失败（${res.status}）`);
          const err = data?.error || `${hint.label}：${hint.message}`;
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === targetId
                ? {
                    ...turn,
                    result: {
                      sql: typeof data?.sql === 'string' ? data.sql : sql,
                      title: '自定义查询',
                      summary: `${err}\n\n> ${data?.suggestion || hint.suggestion}`,
                      components: [
                        {
                          type: 'markdown',
                          data: {
                            content: `**⚠️ ${hint.label}**：${hint.message}\n\n> ${data?.suggestion || hint.suggestion}`,
                          },
                        },
                      ],
                    } as OutputConfig,
                  }
                : turn,
            ),
          );
          notify(err);
          return;
        }

        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === targetId ? { ...turn, result: data as OutputConfig } : turn,
          ),
        );
        notify('已用修改后的 SQL 重新执行');
      } catch {
        notify('重新执行请求失败，请检查网络');
      } finally {
        setRerunning(false);
      }
    },
    [latestTurn, rerunning, notify],
  );

  const ask = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question || busyRef.current) return;
    busyRef.current = true;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        stream: '',
        result: null,
        error: null,
        status: 'streaming',
        startedAt: Date.now(),
      },
    ]);
    setInput('');
    setTab('overview');
    setPanelOpen(false);
    setMobileNavOpen(false);

    const patch = (updater: (turn: Turn) => Turn) =>
      setTurns((prev) => prev.map((turn) => (turn.id === id ? updater(turn) : turn)));

    // P2-2：带上最近 2 轮（问题 + 结论摘要）作为多轮上下文，让「那上个月呢」这类指代能被解析。
    const history: ChatMessage[] = turnsRef.current
      .slice(-2)
      .flatMap((turn) => {
        const msgs: ChatMessage[] = [{ role: 'user', content: turn.question }];
        const answer = turn.result?.summary?.trim();
        if (answer) msgs.push({ role: 'assistant', content: answer.slice(0, 300) });
        return msgs;
      });

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: question }],
        }),
      });

      if (!response.ok) throw new Error(`服务返回 ${response.status}`);
      if (!response.body) throw new Error('响应中没有可读取的数据流');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const line = event.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;

          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }

          if (json.type === 'llm_stream') {
            const piece = normalizeChunk(json.content);
            if (piece) patch((turn) => ({ ...turn, stream: turn.stream + piece }));
          } else if (json.type === 'result') {
            patch((turn) => ({
              ...turn,
              result: (json.data ?? null) as OutputConfig | null,
              status: 'done',
            }));
          } else if (json.type === 'error') {
            patch((turn) => ({
              ...turn,
              error: String(json.message ?? '生成失败'),
              status: 'error',
            }));
          }
        }
      }

      // 流已结束但没收到 result / error 事件时的兜底
      patch((turn) =>
        turn.status === 'streaming'
          ? {
              ...turn,
              status: turn.result ? 'done' : 'error',
              error: turn.result ? null : '模型没有返回可解析的结果，请换个问法再试',
            }
          : turn,
      );
    } catch (error) {
      patch((turn) => ({
        ...turn,
        status: 'error',
        error: error instanceof Error ? error.message : FALLBACK_ERROR,
      }));
    } finally {
      busyRef.current = false;
    }
  }, []);

  return (
    <div className="flex h-full overflow-hidden bg-canvas">
      <Sidebar
        history={historyItems}
        activeId={latestTurn?.id ?? null}
        onUnavailable={showUnavailable}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          loading={loading}
          hasResult={Boolean(latestTurn?.result)}
          onUnavailable={showUnavailable}
          onOpenPanel={() => setPanelOpen(true)}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={toggleSidebar}
          onOpenNav={() => setMobileNavOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <ChatPanel
            turns={turns}
            input={input}
            onInputChange={setInput}
            onAsk={ask}
            onUnavailable={showUnavailable}
            loading={loading}
          />

          <ResultPanel
            result={latestTurn?.result ?? null}
            loading={loading}
            tab={tab}
            onTab={setTab}
            onNotify={notify}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            width={panelWidth}
            onWidthChange={handlePanelWidth}
            onDoubleClickResize={() => setPanelWidth(clampPanelWidth(DEFAULT_PANEL_WIDTH))}
            onRerun={handleRerun}
            rerunning={rerunning}
          />
        </div>
      </div>

      <Toast message={toast?.text ?? null} onClose={() => setToast(null)} />
    </div>
  );
}
