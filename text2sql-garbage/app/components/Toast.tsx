'use client';

import { IconAlert, IconClose } from './icons';

export function Toast({
  message,
  onClose,
}: {
  message: string | null;
  onClose: () => void;
}) {
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 ${
        message ? '' : 'hidden'
      }`}
    >
      {message && (
        <div className="pointer-events-auto flex animate-toast-in items-center gap-2.5 rounded-xl border border-ink-800/10 bg-ink-900/95 py-2.5 pr-2 pl-3.5 text-white shadow-pop backdrop-blur">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
            <IconAlert className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13px]">{message}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭提示"
            className="ml-1 rounded-lg p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
