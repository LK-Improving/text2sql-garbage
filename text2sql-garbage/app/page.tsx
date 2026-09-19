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
import type { ChatMessage, Conversation, OutputConfig, ResultTab, Turn } from './components/types';

const FALLBACK_ERROR = '请求失败，请检查网络或稍后重试。';

/** 布局偏好持久化 key */
const PANEL_WIDTH_KEY = 't2s.panelWidth';
const SIDEBAR_KEY = 't2s.sidebarCollapsed';
const PANEL_DISMISSED_KEY = 't2s.panelDismissed';
/** 会话数据持久化 key */
const CONV_KEY = 't2s.conversations';
const ACTIVE_KEY = 't2s.activeId';

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

/** 由首条问题生成会话标题 */
function deriveTitle(question: string): string {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 18) || '新对话';
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<ResultTab>('overview');
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** 移动端导航抽屉（汉堡菜单）开合状态 */
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  /** 桌面端：结果面板是否被用户关闭（收起为 0 宽） */
  const [panelDismissed, setPanelDismissed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [rerunning, setRerunning] = useState(false);

  const busyRef = useRef(false);
  /** 供 ask / handleRerun 读取最新状态，避免 useCallback 陈旧闭包 */
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);

  /** 当前会话（派生） */
  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const turns = activeConv?.turns ?? [];
  const latestTurn = turns.length ? turns[turns.length - 1] : null;
  const loading = turns.some((turn) => turn.status === 'streaming');

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

  /** 移动端抽屉关闭：引用稳定，供 Sidebar 的 Esc/断点监听安全依赖 */
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  /** 桌面端：关闭 / 展开结果面板，并记住偏好 */
  const togglePanelDismissed = useCallback(() => {
    setPanelDismissed((prev) => {
      const next = !prev;
      persistLayout(PANEL_DISMISSED_KEY, next ? '1' : '0');
      return next;
    });
  }, [persistLayout]);

  // 同步最新状态到 ref（供 ask 构造多轮上下文）
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 首次挂载：恢复会话数据（放 effect 里避免 SSR/CSR 不一致）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CONV_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Conversation[];
        if (Array.isArray(parsed) && parsed.length) {
          setConversations(parsed);
          const aid = window.localStorage.getItem(ACTIVE_KEY);
          setActiveId(aid && parsed.some((c) => c.id === aid) ? aid : parsed[0].id);
          return;
        }
      }
    } catch {
      /* 解析失败则回落到空会话 */
    }
    // 没有任何存储 → 初始化一个空会话，保证 UI 可用
    const id = newId('conv');
    setConversations([{ id, title: '新对话', turns: [], createdAt: Date.now(), updatedAt: Date.now() }]);
    setActiveId(id);
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 兜底：activeId 指向的会话不存在时（例如被删除），自动落到第一个；全删则置空
  useEffect(() => {
    if (activeId && conversations.some((c) => c.id === activeId)) return;
    setActiveId(conversations.length ? conversations[0].id : null);
  }, [conversations, activeId]);

  // 会话数据落盘（防抖，避免流式输出期间高频写入）
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (conversations.length === 0) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(CONV_KEY, JSON.stringify(conversations));
      } catch {
        /* 配额超限等，忽略 */
      }
    }, 400);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [conversations]);
  useEffect(() => {
    try {
      if (activeId) window.localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      /* 忽略 */
    }
  }, [activeId]);

  // 首次挂载：恢复上次的布局偏好（放 effect 里避免 SSR/CSR 不一致）
  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(savedWidth) && savedWidth > 0) {
      setPanelWidth(clampPanelWidth(savedWidth));
    }
    if (window.localStorage.getItem(SIDEBAR_KEY) === '1') setSidebarCollapsed(true);
    if (window.localStorage.getItem(PANEL_DISMISSED_KEY) === '1') setPanelDismissed(true);
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

  /** 新建一个空会话并切换过去 */
  const handleNewChat = useCallback(() => {
    const id = newId('conv');
    setConversations((prev) => [
      { id, title: '新对话', turns: [], createdAt: Date.now(), updatedAt: Date.now() },
      ...prev,
    ]);
    setActiveId(id);
    setInput('');
    setTab('overview');
    setPanelOpen(false);
    setMobileNavOpen(false);
  }, []);

  /** 切换会话 */
  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
    setMobileNavOpen(false);
    setPanelDismissed(false);
  }, []);

  /** 删除会话（有内容的先确认，避免误删） */
  const handleDelete = useCallback((id: string) => {
    const target = conversationsRef.current.find((c) => c.id === id);
    if (target && target.turns.length && !window.confirm('删除该对话？历史记录将一并清空。')) {
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /** 重命名会话 */
  const handleRename = useCallback((id: string, title: string) => {
    const t = title.trim().slice(0, 30);
    if (!t) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c)),
    );
  }, []);

  /** 结果面板「重新执行」：把编辑后的 SQL 交给 /api/execute（走校验但不过大模型） */
  const handleRerun = useCallback(
    async (sql: string) => {
      const targetId = activeIdRef.current;
      const targetTurnId = latestTurn?.id;
      if (!targetId || !targetTurnId || !sql.trim() || rerunning) return;
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
          setConversations((prev) =>
            prev.map((c) =>
              c.id === targetId
                ? {
                    ...c,
                    updatedAt: Date.now(),
                    turns: c.turns.map((turn) =>
                      turn.id === targetTurnId
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
                  }
                : c,
            ),
          );
          notify(err);
          return;
        }

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetId
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  turns: c.turns.map((turn) =>
                    turn.id === targetTurnId ? { ...turn, result: data as OutputConfig } : turn,
                  ),
                }
              : c,
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

    const now = Date.now();
    const turnId = newId('turn');
    const newTurn: Turn = {
      id: turnId,
      question,
      stream: '',
      result: null,
      error: null,
      status: 'streaming',
      startedAt: now,
    };

    // 目标会话：有激活会话就追加，否则新建一个
    const convId = activeIdRef.current;
    const existing = convId ? conversationsRef.current.find((c) => c.id === convId) : undefined;
    const targetId: string = existing ? (convId as string) : newId('conv');

    setConversations((prev) => {
      if (existing) {
        return prev.map((c) =>
          c.id === targetId
            ? {
                ...c,
                turns: [...c.turns, newTurn],
                title: c.title === '新对话' || !c.title ? deriveTitle(question) : c.title,
                updatedAt: now,
              }
            : c,
        );
      }
      return [
        ...prev,
        {
          id: targetId,
          title: deriveTitle(question),
          turns: [newTurn],
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
    setActiveId(targetId);
    setInput('');
    setTab('overview');
    setPanelOpen(false);
    setMobileNavOpen(false);

    const patch = (updater: (turn: Turn) => Turn) =>
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetId
            ? {
                ...c,
                updatedAt: Date.now(),
                turns: c.turns.map((turn) => (turn.id === turnId ? updater(turn) : turn)),
              }
            : c,
        ),
      );

    // P2-2：带上最近 2 轮（问题 + 结论摘要）作为多轮上下文，让「那上个月呢」这类指代能被解析。
    const prevTurns = conversationsRef.current.find((c) => c.id === targetId)?.turns ?? [];
    const history: ChatMessage[] = prevTurns.slice(-2).flatMap((turn) => {
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
            // 拿到结果时自动展开被收起的结果面板，避免用户错过内容
            setPanelDismissed(false);
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

  const conversationItems = useMemo(
    () => conversations.map((c) => ({ id: c.id, title: c.title })),
    [conversations],
  );

  return (
    <div className="flex h-full overflow-hidden bg-canvas">
      <Sidebar
        conversations={conversationItems}
        activeId={activeId}
        onNewChat={handleNewChat}
        onSelect={handleSelect}
        onDelete={handleDelete}
        onRename={handleRename}
        onUnavailable={showUnavailable}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        onOpen={toggleSidebar}
        mobileOpen={mobileNavOpen}
        onMobileClose={closeMobileNav}
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
          conversationTitle={activeConv?.title ?? '新对话'}
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
            dismissed={panelDismissed}
            onToggleDismiss={togglePanelDismissed}
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
