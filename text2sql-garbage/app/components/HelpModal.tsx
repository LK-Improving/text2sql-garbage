'use client';

import { useEffect } from 'react';
import { IconCheck, IconClose, IconHelp, IconSpark } from './icons';

const FAQ = [
  {
    q: '我可以用自然语言问什么？',
    a: '围绕已接入数据源的业务问题，例如「最近 7 天各区垃圾清运量对比」「上月清运量最高的车辆」等。越具体的口径（时间范围、维度、指标）效果越好。',
  },
  {
    q: '它能修改或删除数据吗？',
    a: '不能。系统仅执行只读查询（SELECT），并强制限制返回行数。写操作、建表/改表等越权请求会被安全校验直接拦截并优雅提示。',
  },
  {
    q: '结果里的 SQL 能改吗？',
    a: '可以。在「SQL 语句」标签页编辑后点「重新执行」，会走服务端安全校验后直接查库，无需重新调用大模型。',
  },
  {
    q: '对话和收藏存在哪里？',
    a: '当前保存在本浏览器本地（localStorage），换浏览器或清理缓存不会同步。多端同步能力将在后续版本提供。',
  },
];

const SHORTCUTS: [string, string][] = [
  ['Enter', '发送问题'],
  ['Shift + Enter', '换行'],
  ['点击表头', '对数据表排序（升序/降序/还原）'],
];

/** 帮助中心：静态弹层，不依赖后端 */
export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="帮助中心"
    >
      <div
        className="absolute inset-0 bg-ink-900/35 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <header className="flex items-center gap-2.5 border-b border-line px-5 py-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <IconHelp className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink-900">帮助中心</div>
            <div className="text-[12px] text-ink-400">用自然语言，探索企业数据</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700"
          >
            <IconClose className="h-[18px] w-[18px]" />
          </button>
        </header>

        <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-800">
              <IconSpark className="h-4 w-4 text-brand-500" />
              能做什么
            </h3>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-ink-600">
              <li className="flex gap-2">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-500" />
                把业务问题转成 SQL 并查询真实数据库
              </li>
              <li className="flex gap-2">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-500" />
                结果以「表格 / 图表 / Excel / CSV」多种形式呈现，可复制或导出
              </li>
              <li className="flex gap-2">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-mint-500" />
                支持多轮追问（如「那上个月呢」），自动关联上下文
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-[13px] font-semibold text-ink-800">安全边界</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
              仅允许只读查询，强制限制返回行数；写操作、建表/改表、非白名单表等越权请求会被拦截并提示，不会执行。
            </p>
          </section>

          <section>
            <h3 className="text-[13px] font-semibold text-ink-800">常见问题</h3>
            <div className="mt-2 space-y-3">
              {FAQ.map((item) => (
                <div key={item.q}>
                  <div className="text-[13px] font-medium text-ink-800">{item.q}</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-500">{item.a}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-[13px] font-semibold text-ink-800">快捷键</h3>
            <div className="mt-2 space-y-1.5">
              {SHORTCUTS.map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3 text-[12.5px] text-ink-600">
                  <kbd className="rounded-md border border-line bg-canvas px-2 py-0.5 font-mono text-[11.5px] text-ink-700">
                    {key}
                  </kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="border-t border-line px-5 py-3 text-center text-[11.5px] text-ink-300">
          仍有疑问？欢迎反馈，帮助我们把产品做得更好。
        </footer>
      </div>
    </div>
  );
}
