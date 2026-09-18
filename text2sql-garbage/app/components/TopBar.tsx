'use client';

import {
  IconChevronDown,
  IconDatabase,
  IconHelp,
  IconLayers,
  IconMenu,
  IconSidebarExpand,
  IconUser,
} from './icons';
import type { UnavailableHandler } from './types';

export function TopBar({
  loading,
  hasResult,
  onUnavailable,
  onOpenPanel,
  sidebarCollapsed = false,
  onToggleSidebar,
  onOpenNav,
}: {
  loading: boolean;
  hasResult: boolean;
  onUnavailable: UnavailableHandler;
  onOpenPanel: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenNav?: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-1.5">
        {onOpenNav && (
          <button
            type="button"
            onClick={onOpenNav}
            aria-label="打开导航菜单"
            title="菜单"
            className="shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700 md:hidden"
          >
            <IconMenu className="h-[18px] w-[18px]" />
          </button>
        )}
        {sidebarCollapsed && onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label="展开侧边栏"
            title="展开侧边栏"
            className="hidden shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700 md:block"
          >
            <IconSidebarExpand className="h-[17px] w-[17px]" />
          </button>
        )}

        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <IconLayers className="h-4 w-4 shrink-0 text-brand-500" />
          <span className="font-medium text-ink-800">智能问数</span>
          <span className="text-ink-300">/</span>
          <span className="truncate text-ink-500">新建对话</span>
          {loading && (
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-medium text-brand-600">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand-500" />
              正在分析
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {hasResult && (
          <button
            type="button"
            onClick={onOpenPanel}
            className="mr-0.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-medium text-ink-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 lg:hidden"
          >
            查看结果
          </button>
        )}

        <button
          type="button"
          onClick={() => onUnavailable('数据库切换')}
          className="hidden items-center gap-2 rounded-lg border border-line bg-canvas-soft px-2.5 py-1.5 text-[12.5px] text-ink-600 transition-colors hover:border-line-strong hover:bg-canvas hover:text-ink-900 sm:flex"
        >
          <IconDatabase className="h-[15px] w-[15px] text-brand-500" />
          <span className="text-ink-400">数据库:</span>
          <span className="font-medium text-ink-800">城市环卫数据</span>
          <IconChevronDown className="h-3.5 w-3.5 text-ink-400" />
        </button>

        <button
          type="button"
          onClick={() => onUnavailable('帮助中心')}
          aria-label="帮助"
          className="rounded-lg p-2 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700"
        >
          <IconHelp className="h-[17px] w-[17px]" />
        </button>

        <button
          type="button"
          onClick={() => onUnavailable('账号设置')}
          className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 transition-colors hover:border-line-strong hover:bg-canvas"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-linear-to-br from-brand-400 to-brand-600 text-white">
            <IconUser className="h-3.5 w-3.5" />
          </span>
          <span className="hidden text-[12.5px] font-medium text-ink-700 sm:block">用户名</span>
        </button>
      </div>
    </header>
  );
}
