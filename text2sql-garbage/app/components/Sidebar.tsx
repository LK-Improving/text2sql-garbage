'use client';

import { useEffect, type CSSProperties } from 'react';
import {
  IconBoard,
  IconClose,
  IconDatabase,
  IconHistory,
  IconLogo,
  IconMenu,
  IconPlus,
  IconSidebarCollapse,
  IconStar,
} from './icons';
import type { UnavailableHandler } from './types';

const NAV_ITEMS = [
  { label: '对话记录', Icon: IconHistory },
  { label: '我的收藏', Icon: IconStar },
  { label: '数据看板', Icon: IconBoard },
  { label: '数据源管理', Icon: IconDatabase },
] as const;

/** 展开时的侧栏宽度，收起动画要共用同一个值 */
export const SIDEBAR_WIDTH = 236;

export function Sidebar({
  history,
  activeId,
  onUnavailable,
  collapsed = false,
  onToggle,
  onOpen,
  mobileOpen = false,
  onMobileClose,
}: {
  history: { id: string; question: string }[];
  activeId: string | null;
  onUnavailable: UnavailableHandler;
  collapsed?: boolean;
  onToggle?: () => void;
  /** 桌面端折叠后，从左侧把手重新展开 */
  onOpen?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  /** 移动端点击任意条目：先关抽屉，再走原有「暂未开放」提示 */
  const handleMobileItem = (feature: string) => {
    onMobileClose?.();
    onUnavailable(feature);
  };

  // Esc 关闭抽屉；视口变宽到桌面断点时也自动收起，避免状态残留
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onMobileClose?.();
    };
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) onMobileClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    mq.addEventListener('change', onChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      mq.removeEventListener('change', onChange);
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* 桌面端：静态侧栏（≥768px 显示，可收起） */}
      <div
        className={`hidden shrink-0 overflow-hidden border-r border-line transition-[width] duration-300 ease-out md:block ${
          collapsed ? 'w-0 border-r-0' : 'w-[var(--sidebar-w)]'
        }`}
        style={{ '--sidebar-w': `${SIDEBAR_WIDTH}px` } as CSSProperties}
        aria-hidden={collapsed}
      >
        <SidebarBody
          history={history}
          activeId={activeId}
          onUnavailable={onUnavailable}
          onToggle={onToggle}
        />
      </div>

      {/* 桌面端：侧栏收起后，左缘的「展开」把手 */}
      {collapsed && onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="展开侧边栏"
          title="展开侧边栏"
          className="group fixed top-1/2 left-0 z-40 hidden -translate-y-1/2 items-center gap-1 rounded-r-xl border border-l-0 border-line bg-surface py-3 pr-1.5 pl-2 text-ink-400 shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 md:flex"
        >
          <IconMenu className="h-3.5 w-3.5" />
          <span className="text-[11.5px] [writing-mode:vertical-rl]">菜单</span>
        </button>
      )}

      {/* 移动端：遮罩 + 抽屉（<768px 显示）
          注意：抽屉 z-index 必须高于遮罩，否则关闭按钮的点击可能被遮罩吃掉 */}
      <div
        onClick={onMobileClose}
        className={`fixed inset-0 z-50 bg-ink-900/25 backdrop-blur-[2px] transition-opacity duration-200 md:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!mobileOpen}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="导航菜单"
        className={`fixed inset-y-0 left-0 z-[60] flex w-[82vw] max-w-[300px] flex-col border-r border-line bg-surface shadow-pop transition-transform duration-300 ease-out md:hidden ${
          mobileOpen ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
        }`}
      >
        <SidebarBody
          history={history}
          activeId={activeId}
          onUnavailable={handleMobileItem}
          onClose={onMobileClose}
        />
      </div>
    </>
  );
}

/** 侧栏内容（桌面静态版与移动抽屉版共用） */
function SidebarBody({
  history,
  activeId,
  onUnavailable,
  onToggle,
  onClose,
}: {
  history: { id: string; question: string }[];
  activeId: string | null;
  onUnavailable: UnavailableHandler;
  onToggle?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col bg-surface">
      {/* 品牌 */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <IconLogo className="h-9 w-9 shrink-0 rounded-[9px] shadow-brand" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-tight text-ink-900">
            智能数据问答平台
          </div>
          <div className="truncate text-[11.5px] text-ink-400">
            用自然语言，探索企业数据
          </div>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭菜单"
            title="关闭菜单"
            className="shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700"
          >
            <IconClose className="h-[17px] w-[17px]" />
          </button>
        ) : (
          onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="收起侧边栏"
              title="收起侧边栏"
              className="shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700"
            >
              <IconSidebarCollapse className="h-[15px] w-[15px]" />
            </button>
          )
        )}
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => onUnavailable('新建对话')}
          className="group flex w-full items-center justify-center gap-2 rounded-[10px] bg-linear-to-b from-brand-500 to-brand-600 px-3 py-2.5 text-[13.5px] font-medium text-white shadow-brand transition-all hover:from-brand-400 hover:to-brand-600 active:translate-y-px"
        >
          <IconPlus className="h-4 w-4 transition-transform group-hover:rotate-90" />
          新建对话
        </button>
      </div>

      {/* 导航 */}
      <nav className="mt-4 px-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map(({ label, Icon }) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => onUnavailable(label)}
                className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13.5px] text-ink-600 transition-colors hover:bg-canvas hover:text-ink-900"
              >
                <Icon className="h-[17px] w-[17px] text-ink-400" />
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* 历史对话 */}
      <div className="scroll-thin mt-5 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2.5 pb-1.5 text-[11px] font-semibold tracking-wider text-ink-400">
          历史对话
        </div>

        {history.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] leading-relaxed text-ink-300">
            还没有对话记录，试试右侧的问题示例吧
          </p>
        ) : (
          <ul className="space-y-0.5">
            {history.map((item) => {
              const active = item.id === activeId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onUnavailable('查看历史对话')}
                    title={item.question}
                    className={`flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] transition-colors ${
                      active
                        ? 'bg-brand-50 font-medium text-brand-700'
                        : 'text-ink-600 hover:bg-canvas hover:text-ink-900'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        active ? 'bg-brand-500' : 'bg-ink-300'
                      }`}
                    />
                    <span className="truncate">{item.question}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 底部品牌卡 */}
      <div className="p-3">
        <div className="mesh-glow dot-grid relative overflow-hidden rounded-xl border border-line bg-canvas-soft p-3.5">
          <div className="relative">
            <div className="text-[13px] font-semibold text-ink-900">让数据更简单</div>
            <div className="mt-0.5 text-[11.5px] text-ink-500">
              用对话的方式，发现数据价值
            </div>
            <svg viewBox="0 0 120 34" className="mt-2 h-8 w-full" aria-hidden="true">
              <path
                d="M2 28 L20 20 L38 24 L56 12 L74 16 L92 5 L118 9"
                fill="none"
                stroke="#3b74f0"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.75"
              />
              <circle cx="92" cy="5" r="3" fill="#2563eb" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
