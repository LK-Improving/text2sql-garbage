'use client';

import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconGlobe,
  IconLoader,
  IconRefresh,
  IconRobot,
  IconSend,
  IconSpark,
  IconThumbDown,
  IconThumbUp,
} from './icons';
import { getAnswer } from './derive';
import type { RatingValue, Turn, UnavailableHandler } from './types';

const FAQ_QUESTIONS = [
  '最近7天的垃圾清运量是多少？',
  '各区的垃圾清运量对比',
  '上个月的垃圾清运趋势',
  '今天的环卫车辆作业次数',
  '哪个区域的垃圾清运量最多？',
  '近一个月的垃圾清运量同比变化',
];

export function ChatPanel({
  turns,
  input,
  onInputChange,
  onAsk,
  onUnavailable,
  ratings,
  onRate,
  loading,
}: {
  turns: Turn[];
  input: string;
  onInputChange: (value: string) => void;
  onAsk: (question: string) => void;
  onUnavailable: UnavailableHandler;
  ratings?: Record<string, RatingValue>;
  onRate?: (turnId: string, value: RatingValue) => void;
  loading: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [, tick] = useState(0);

  // 流式输出期间每秒刷新一次耗时
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  // 智能吸底：用户往回翻的时候不打断阅读
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto"
      >
        {turns.length === 0 ? (
          <Welcome onAsk={onAsk} />
        ) : (
          <div className="mx-auto w-full max-w-[820px] space-y-7 px-4 py-6 lg:px-8 lg:py-8">
            {turns.map((turn, index) => (
              <TurnBlock
                key={turn.id}
                turn={turn}
                isLatest={index === turns.length - 1}
                onAsk={onAsk}
                onUnavailable={onUnavailable}
                ratings={ratings}
                onRate={onRate}
              />
            ))}
          </div>
        )}
      </div>

      <Composer
        input={input}
        onInputChange={onInputChange}
        onAsk={onAsk}
        onUnavailable={onUnavailable}
        loading={loading}
        compact={turns.length > 0}
      />
    </section>
  );
}

/* ───────────────────────────── 空状态 / 欢迎页 ───────────────────────────── */

function Welcome({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="mesh-glow relative flex min-h-full items-center justify-center px-4 py-10 lg:px-8">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-[0.55]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-linear-to-t from-surface to-transparent" />

      <div className="relative w-full max-w-[760px] animate-rise">
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand-400 via-brand-500 to-brand-700 text-white shadow-brand">
            <IconRobot className="h-7 w-7" />
            <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-surface bg-mint-500 text-white">
              <IconSpark className="h-3 w-3" />
            </span>
          </div>

          <div className="pt-0.5">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink-900 sm:text-[26px]">
              你好，我是数据助手
            </h1>
            <p className="mt-1.5 max-w-[520px] text-[14px] leading-relaxed text-ink-500">
              我可以将你的问题转换为 SQL 并查询数据，为你提供准确的分析结果。
            </p>
          </div>
        </div>

        <div className="mt-8">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-500">
            <span className="h-1 w-4 rounded-full bg-brand-500" />
            你可以试着问我：
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {FAQ_QUESTIONS.map((question, index) => (
              <button
                key={question}
                type="button"
                onClick={() => onAsk(question)}
                style={{ animationDelay: `${60 + index * 45}ms` }}
                className="group flex animate-rise items-center gap-2.5 rounded-xl border border-line bg-surface/90 px-3 py-3 text-left text-[13px] text-ink-700 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:bg-brand-50/60 hover:text-brand-700 hover:shadow-pop"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-ink-400 transition-colors group-hover:border-brand-200 group-hover:bg-brand-100 group-hover:text-brand-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                <span className="min-w-0 flex-1 leading-snug">{question}</span>
                <IconArrowRight className="h-4 w-4 shrink-0 -translate-x-1 text-brand-400 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── 单轮对话 ───────────────────────────── */

function TurnBlock({
  turn,
  isLatest,
  onAsk,
  onUnavailable,
  ratings,
  onRate,
}: {
  turn: Turn;
  isLatest: boolean;
  onAsk: (question: string) => void;
  onUnavailable: UnavailableHandler;
  ratings?: Record<string, RatingValue>;
  onRate?: (turnId: string, value: RatingValue) => void;
}) {
  const answer = getAnswer(turn.result);

  return (
    <div className="space-y-6">
      {/* 用户提问 */}
      <div className="flex animate-rise items-start justify-end gap-2.5">
        <div className="max-w-[80%] rounded-2xl rounded-tr-[6px] bg-linear-to-b from-brand-500 to-brand-600 px-3.5 py-2.5 text-[14px] leading-relaxed text-white shadow-brand">
          {turn.question}
        </div>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-ink-600 to-ink-800 text-white">
          <span className="text-[12px] font-medium">我</span>
        </div>
      </div>

      {/* 助手回复 */}
      <div className="flex animate-rise items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-brand">
          <IconRobot className="h-[18px] w-[18px]" />
        </div>

        <div className="min-w-0 flex-1 space-y-3 pt-0.5">
          <ThinkingCard turn={turn} isLatest={isLatest} />

          {turn.status === 'done' && turn.result && (
            <>
              {answer ? (
                <Markdown>{answer}</Markdown>
              ) : (
                <p className="text-[14px] text-ink-500">已生成结果，详情见右侧结果面板。</p>
              )}

              <div className="flex items-center gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => onRate?.(turn.id, 'up')}
                  aria-label="有帮助"
                  aria-pressed={ratings?.[turn.id] === 'up'}
                  title="有帮助"
                  className={`rounded-lg p-1.5 transition-colors ${
                    ratings?.[turn.id] === 'up'
                      ? 'bg-mint-500/10 text-mint-500'
                      : 'text-ink-400 hover:bg-canvas hover:text-mint-500'
                  }`}
                >
                  <IconThumbUp className="h-[17px] w-[17px]" />
                </button>
                <button
                  type="button"
                  onClick={() => onRate?.(turn.id, 'down')}
                  aria-label="没帮助"
                  aria-pressed={ratings?.[turn.id] === 'down'}
                  title="没帮助"
                  className={`rounded-lg p-1.5 transition-colors ${
                    ratings?.[turn.id] === 'down'
                      ? 'bg-rose-500/10 text-rose-500'
                      : 'text-ink-400 hover:bg-canvas hover:text-rose-500'
                  }`}
                >
                  <IconThumbDown className="h-[17px] w-[17px]" />
                </button>

                <button
                  type="button"
                  onClick={() => onAsk(turn.question)}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-ink-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                >
                  <IconRefresh className="h-[15px] w-[15px]" />
                  重新回答
                </button>
              </div>
            </>
          )}

          {turn.status === 'error' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/5 px-3.5 py-3">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium text-ink-900">查询失败</div>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink-600">
                  {turn.error || '请求失败，请稍后重试。'}
                </p>
                <button
                  type="button"
                  onClick={() => onAsk(turn.question)}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-600 transition-colors hover:border-brand-200 hover:text-brand-700"
                >
                  <IconRefresh className="h-[15px] w-[15px]" />
                  重新回答
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── 思考过程 ───────────────────────────── */

const STEPS = [
  { title: '理解问题', desc: '解析问题意图与查询范围' },
  { title: '生成分析结果', desc: '结合表结构生成 SQL 与结论' },
  { title: '汇总与校验', desc: '整理数据并生成摘要与图表' },
];

type StepState = 'pending' | 'active' | 'done' | 'error';

function stepStates(turn: Turn): StepState[] {
  if (turn.status === 'error') return ['done', 'error', 'pending'];
  if (turn.status === 'done') return ['done', 'done', 'done'];
  return turn.stream ? ['done', 'active', 'pending'] : ['active', 'pending', 'pending'];
}

function ThinkingCard({ turn, isLatest }: { turn: Turn; isLatest: boolean }) {
  const [open, setOpen] = useState(true);
  const rawRef = useRef<HTMLPreElement>(null);
  const streaming = turn.status === 'streaming';
  const states = stepStates(turn);

  useEffect(() => {
    if (!isLatest) setOpen(false);
  }, [isLatest]);

  useEffect(() => {
    const el = rawRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turn.stream]);

  const elapsed = Math.max(0, Math.round((Date.now() - turn.startedAt) / 1000));
  const summary = streaming
    ? `正在分析… ${elapsed}s`
    : turn.status === 'error'
      ? '分析中断'
      : `思考完成 · ${elapsed}s`;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-canvas-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-canvas"
      >
        <span
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
            streaming ? 'bg-brand-100 text-brand-600' : 'bg-mint-500/10 text-mint-500'
          }`}
        >
          {streaming ? (
            <IconLoader className="h-3 w-3 animate-rotate" />
          ) : turn.status === 'error' ? (
            <IconAlert className="h-3 w-3 text-rose-500" />
          ) : (
            <IconCheck className="h-3 w-3" />
          )}
        </span>
        <span className="text-[12.5px] font-medium text-ink-700">思考过程</span>
        {turn.rerunAt && (
          <span
            title="模型输出保留首次生成的原貌；右侧结果面板的数据已按你编辑后的 SQL 重新查询"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-1.5 py-px text-[10.5px] font-medium text-brand-600"
          >
            <IconRefresh className="h-2.5 w-2.5" />
            已重新执行
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-ink-400 tabular-nums">
          {summary}
        </span>
        <IconChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform duration-200 ${
            open ? '' : '-rotate-90'
          }`}
        />
      </button>

      {open && (
        <div className="animate-fade border-t border-line px-3 pt-2.5 pb-3">
          <ol className="space-y-0">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative flex gap-3 pb-2.5 last:pb-0">
                {index < STEPS.length - 1 && (
                  <span
                    className={`absolute top-6 left-[10px] h-[calc(100%_-_14px)] w-px ${
                      states[index] === 'done' ? 'bg-brand-200' : 'bg-line-strong'
                    }`}
                  />
                )}
                <StepIcon state={states[index]} index={index} />
                <div className="min-w-0 pt-0.5">
                  <div
                    className={`text-[13px] leading-tight font-medium ${
                      states[index] === 'pending' ? 'text-ink-400' : 'text-ink-800'
                    }`}
                  >
                    {step.title}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink-400">{step.desc}</div>
                </div>
              </li>
            ))}
          </ol>

          {turn.stream && (
            <div className="mt-1">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-400">
                模型输出
                {streaming && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-1.5 py-px text-[10.5px] font-medium text-brand-600">
                    <span className="h-1 w-1 animate-pulse-soft rounded-full bg-brand-500" />
                    流式
                  </span>
                )}
              </div>
              <pre
                ref={rawRef}
                className="scroll-thin max-h-32 overflow-auto rounded-lg border border-line bg-[#0f172a] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-[#c7d4e8]"
              >
                {turn.stream}
                {streaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-[7px] translate-y-0.5 animate-caret bg-brand-400 align-middle" />
                )}
              </pre>
              {turn.rerunAt && !streaming && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                  以上是模型<strong className="font-medium text-ink-500">首次生成</strong>的原始输出（含最初的
                  SQL）。重新执行只重查数据、更新右侧结果面板，不会改写这段内容。
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StepIcon({ state, index }: { state: StepState; index: number }) {
  const base =
    'relative z-10 flex h-[21px] w-[21px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors';

  if (state === 'done') {
    return (
      <span className={`${base} border-brand-200 bg-brand-500 text-white`}>
        <IconCheck className="h-3 w-3" strokeWidth={2.6} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className={`${base} border-brand-200 bg-brand-50 text-brand-600`}>
        <IconLoader className="h-3 w-3 animate-rotate" strokeWidth={2.4} />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className={`${base} border-rose-500/30 bg-rose-500/10 text-rose-500`}>
        <IconAlert className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span className={`${base} border-line-strong bg-surface text-ink-400`}>{index + 1}</span>
  );
}

/* ───────────────────────────── 输入区 ───────────────────────────── */

function Composer({
  input,
  onInputChange,
  onAsk,
  onUnavailable,
  loading,
  compact,
}: {
  input: string;
  onInputChange: (value: string) => void;
  onAsk: (question: string) => void;
  onUnavailable: UnavailableHandler;
  loading: boolean;
  compact: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [input]);

  const canSend = input.trim().length > 0 && !loading;

  const submit = () => {
    if (!canSend) return;
    onAsk(input);
  };

  return (
    <div
      className={`shrink-0 border-t border-line bg-surface/85 backdrop-blur-md ${
        compact ? 'px-4 py-3 lg:px-8' : 'px-4 pb-5 lg:px-8'
      }`}
    >
      <div className="mx-auto w-full max-w-[820px]">
        <div className="group flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card transition-colors focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-500/10">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="请输入你的问题，例如：最近7天的垃圾清运量是多少？"
            className="scroll-thin max-h-[168px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-base leading-relaxed text-ink-900 outline-none placeholder:text-ink-400 md:text-[14px]"
          />

          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="发送"
            className={`mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-all ${
              canSend
                ? 'bg-linear-to-b from-brand-500 to-brand-600 shadow-brand hover:from-brand-400 active:translate-y-px'
                : 'cursor-not-allowed bg-ink-300'
            }`}
          >
            {loading ? (
              <IconLoader className="h-[18px] w-[18px] animate-rotate" strokeWidth={2.1} />
            ) : (
              <IconSend className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => onUnavailable('联网搜索')}
            className="flex items-center gap-1.5 rounded-full border border-line bg-canvas-soft px-2.5 py-1 text-[12px] text-ink-500 transition-colors hover:text-ink-700"
          >
            <IconGlobe className="h-3.5 w-3.5" />
            联网搜索
          </button>

          <span className="hidden text-[11.5px] text-ink-300 sm:block">
            Enter 发送 · Shift + Enter 换行
          </span>
        </div>
      </div>
    </div>
  );
}
