'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DataChart, formatCell } from './DataChart';
import { getChartPoints, getChartUnit, getTable } from './derive';
import {
  IconChart,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconCheck,
  IconClose,
  IconCode,
  IconCopy,
  IconDownload,
  IconTable,
} from './icons';
import type {
  ChartType,
  NotifyHandler,
  OutputConfig,
  ResultTab,
  TableData,
} from './types';

const TABS: { id: ResultTab; label: string }[] = [
  { id: 'overview', label: '查询结果' },
  { id: 'sql', label: 'SQL 语句' },
  { id: 'table', label: '数据表' },
  { id: 'chart', label: '图表分析' },
];

const CHART_OPTIONS: { id: ChartType; label: string; Icon: typeof IconChartBar }[] = [
  { id: 'bar', label: '柱状图', Icon: IconChartBar },
  { id: 'line', label: '折线图', Icon: IconChartLine },
  { id: 'pie', label: '饼图', Icon: IconChartPie },
];

/** 结果面板默认宽度（收起侧栏后同一块屏幕能容纳更宽的表） */
export const DEFAULT_PANEL_WIDTH = 520;
export const MIN_PANEL_WIDTH = 360;
export const MAX_PANEL_WIDTH = 920;

export function ResultPanel({
  result,
  loading,
  tab,
  onTab,
  onNotify,
  open,
  onClose,
  width,
  onWidthChange,
  onDoubleClickResize,
}: {
  result: OutputConfig | null;
  loading: boolean;
  tab: ResultTab;
  onTab: (tab: ResultTab) => void;
  onNotify: NotifyHandler;
  open: boolean;
  onClose: () => void;
  width: number;
  onWidthChange: (width: number) => void;
  onDoubleClickResize?: () => void;
}) {
  const table = getTable(result);
  const points = getChartPoints(result);
  const unit = getChartUnit(result);
  const rowCount = table?.rows.length ?? 0;

  const [resizing, setResizing] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  // 图形形态：默认按数据量推断（点数多 → 折线，避免柱子挤成一团），
  // 用户手动选择后绑定在当前结果上；换了新结果就回落到默认值。
  const defaultChartType: ChartType = points.length > 14 ? 'line' : 'bar';
  const [chartChoice, setChartChoice] = useState<{
    for: OutputConfig | null;
    type: ChartType;
  } | null>(null);
  const chartType =
    chartChoice && chartChoice.for === result ? chartChoice.type : defaultChartType;
  const selectChartType = (type: ChartType) => setChartChoice({ for: result, type });

  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  /** 复制并给出「已复制」的短反馈 */
  const handleCopy = async (text: string, key: string, label: string) => {
    if (!text) {
      onNotify(`没有可复制的${label}`);
      return;
    }
    const ok = await writeClipboard(text);
    if (!ok) {
      onNotify('复制失败，请手动选择后复制');
      return;
    }
    setCopiedKey(key);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
    onNotify(`已复制${label}`);
  };

  const handleDownload = () => {
    if (!table || !table.rows.length) {
      onNotify('当前没有可下载的表格数据');
      return;
    }
    const name = buildCsvFileName(result?.title ?? '查询结果');
    downloadCsv(table, name);
    onNotify(`已导出 ${table.rows.length} 行数据`);
  };

  const copyIcon = (key: string) =>
    copiedKey === key ? (
      <IconCheck className="h-3.5 w-3.5 text-mint-500" />
    ) : (
      <IconCopy className="h-3.5 w-3.5" />
    );

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-ink-900/25 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        style={{ '--panel-w': `${width}px` } as CSSProperties}
        className={`fixed inset-y-0 right-0 z-40 flex w-[92vw] max-w-[420px] flex-col border-l border-line bg-surface transition-transform duration-300 ease-out lg:relative lg:z-auto lg:w-[var(--panel-w)] lg:max-w-none lg:translate-x-0 lg:shadow-none ${
          open ? 'translate-x-0 shadow-pop' : 'translate-x-full'
        }`}
      >
        {/* 拖拽调宽手柄（仅桌面端） */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖拽调整结果面板宽度"
          title="拖拽调整宽度，双击恢复默认"
          onPointerDown={(e) => beginResize(e, width, onWidthChange, setResizing)}
          onDoubleClick={onDoubleClickResize}
          className="group absolute inset-y-0 left-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize touch-none select-none lg:block"
        >
          <span
            className={`absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 transition-colors duration-150 ${
              resizing ? 'bg-brand-500' : 'bg-transparent group-hover:bg-brand-300'
            }`}
          />
        </div>

        {/* 标签栏 */}
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3">
          <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {TABS.map((item) => {
              const active = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTab(item.id)}
                  className={`relative shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-500 hover:bg-canvas hover:text-ink-800'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="关闭结果面板"
            className="shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-canvas hover:text-ink-700 lg:hidden"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-canvas-soft p-3.5">
          {loading && !result ? (
            <PanelSkeleton />
          ) : !result ? (
            <PanelEmpty />
          ) : (
            <div className="animate-fade space-y-3.5">
              {tab === 'overview' && (
                <>
                  <SqlSection
                    sql={result.sql}
                    collapsed
                    copied={copiedKey === 'sql'}
                    onCopy={() => handleCopy(result.sql, 'sql', 'SQL 语句')}
                  />
                  <SectionCard
                    icon={<IconTable className="h-3.5 w-3.5" />}
                    title="查询结果"
                    meta={rowCount ? `${rowCount} 条` : undefined}
                    action={
                      <div className="flex items-center gap-1.5">
                        <GhostButton
                          icon={copyIcon('table-overview')}
                          label="复制"
                          title="复制表格（可直接粘贴到 Excel）"
                          onClick={() =>
                            handleCopy(
                              table ? toTsv(table) : '',
                              'table-overview',
                              '表格数据',
                            )
                          }
                        />
                        <GhostButton
                          icon={<IconDownload className="h-3.5 w-3.5" />}
                          label="下载数据"
                          title="导出为 CSV 文件"
                          onClick={handleDownload}
                        />
                      </div>
                    }
                  >
                    <ResultTable table={table} limit={8} />
                  </SectionCard>
                  <SectionCard
                    icon={<IconChart className="h-3.5 w-3.5" />}
                    title="图表展示"
                    action={<ChartTypeSwitch value={chartType} onChange={selectChartType} />}
                  >
                    <DataChart points={points} unit={unit} height={228} type={chartType} />
                  </SectionCard>
                </>
              )}

              {tab === 'sql' && (
                <SqlSection
                  sql={result.sql}
                  copied={copiedKey === 'sql'}
                  onCopy={() => handleCopy(result.sql, 'sql', 'SQL 语句')}
                />
              )}

              {tab === 'table' && (
                <SectionCard
                  icon={<IconTable className="h-3.5 w-3.5" />}
                  title="数据表"
                  meta={rowCount ? `${rowCount} 条` : undefined}
                  action={
                    <div className="flex items-center gap-1.5">
                      <GhostButton
                        icon={copyIcon('table-full')}
                        label="复制"
                        title="复制表格（可直接粘贴到 Excel）"
                        onClick={() =>
                          handleCopy(table ? toTsv(table) : '', 'table-full', '表格数据')
                        }
                      />
                      <GhostButton
                        icon={<IconDownload className="h-3.5 w-3.5" />}
                        label="下载数据"
                        title="导出为 CSV 文件"
                        onClick={handleDownload}
                      />
                    </div>
                  }
                >
                  <ResultTable table={table} />
                </SectionCard>
              )}

              {tab === 'chart' && (
                <SectionCard
                  icon={<IconChart className="h-3.5 w-3.5" />}
                  title="图表分析"
                  action={<ChartTypeSwitch value={chartType} onChange={selectChartType} />}
                >
                  <DataChart points={points} unit={unit} height={268} type={chartType} />
                </SectionCard>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/* ───────────────────────────── 交互工具 ───────────────────────────── */

/** 指针拖拽调整面板宽度；面板贴右，鼠标左移 → 变宽 */
function beginResize(
  e: React.PointerEvent<HTMLElement>,
  startWidth: number,
  onWidthChange: (width: number) => void,
  setResizing: (value: boolean) => void,
) {
  if (e.button !== 0) return;
  e.preventDefault();

  const target = e.currentTarget;
  const pointerId = e.pointerId;
  const startX = e.clientX;
  setResizing(true);

  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* 某些浏览器不支持，忽略 */
  }

  const onMove = (ev: PointerEvent) => {
    onWidthChange(startWidth + (startX - ev.clientX));
  };

  const onEnd = () => {
    setResizing(false);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onEnd);
    target.removeEventListener('pointercancel', onEnd);
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* 已释放 */
    }
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onEnd);
  target.addEventListener('pointercancel', onEnd);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 非安全上下文或未授权 → 走 execCommand 降级 */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 导出 CSV：表头用列 label，值原样 */
function toCsv(table: TableData): string {
  const head = table.columns.map((col) => csvCell(col.label)).join(',');
  const body = table.rows.map((row) =>
    table.columns.map((col) => csvCell(row[col.field])).join(','),
  );
  return [head, ...body].join('\r\n');
}

/** 复制 TSV：制表符分隔，粘贴进 Excel 会自动分列 */
function toTsv(table: TableData): string {
  const head = table.columns.map((col) => col.label).join('\t');
  const body = table.rows.map((row) =>
    table.columns.map((col) => formatCell(row[col.field])).join('\t'),
  );
  return [head, ...body].join('\n');
}

function buildCsvFileName(title: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
  const safe = (title || '查询结果')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${safe || '查询结果'}_${stamp}.csv`;
}

function downloadCsv(table: TableData, fileName: string) {
  // 前置 BOM，Excel 打开中文才不乱码
  const blob = new Blob([`\uFEFF${toCsv(table)}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* ───────────────────────────── 子组件 ───────────────────────────── */

function SectionCard({
  icon,
  title,
  meta,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="shrink-0 text-brand-500">{icon}</span>
        <h3 className="shrink-0 text-[13px] font-semibold text-ink-800">{title}</h3>
        {meta && (
          <span className="shrink-0 rounded-full bg-canvas px-1.5 py-0.5 font-mono text-[11px] text-ink-500 tabular-nums">
            {meta}
          </span>
        )}
        <div className="ml-auto min-w-0">{action}</div>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function GhostButton({
  icon,
  label,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11.5px] whitespace-nowrap text-ink-500 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
    >
      {icon}
      {label}
    </button>
  );
}

function ChartTypeSwitch({
  value,
  onChange,
}: {
  value: ChartType;
  onChange: (type: ChartType) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-canvas p-0.5">
      {CHART_OPTIONS.map(({ id, label, Icon }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={`rounded-[6px] p-1 transition-colors ${
              active
                ? 'bg-surface text-brand-600 shadow-card'
                : 'text-ink-400 hover:text-ink-700'
            }`}
          >
            <Icon className="h-[15px] w-[15px]" />
          </button>
        );
      })}
    </div>
  );
}

function SqlSection({
  sql,
  collapsed = false,
  copied,
  onCopy,
}: {
  sql: string;
  collapsed?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = (sql || '').trim();
  const long = collapsed && text.length > 260;

  return (
    <SectionCard
      icon={<IconCode className="h-3.5 w-3.5" />}
      title="生成的 SQL 语句"
      action={
        <GhostButton
          icon={
            copied ? (
              <IconCheck className="h-3.5 w-3.5 text-mint-500" />
            ) : (
              <IconCopy className="h-3.5 w-3.5" />
            )
          }
          label={copied ? '已复制' : '复制'}
          title="复制 SQL 语句"
          onClick={onCopy}
        />
      }
    >
      {text ? (
        <>
          <pre
            className={`scroll-thin overflow-auto rounded-lg border border-white/5 bg-[#0f172a] px-3 py-2.5 font-mono text-[12px] leading-relaxed ${
              long && !expanded ? 'max-h-[132px]' : 'max-h-[380px]'
            }`}
          >
            <code>{highlightSql(text)}</code>
          </pre>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 text-[11.5px] font-medium text-brand-600 hover:text-brand-700"
            >
              {expanded ? '收起' : '展开全部'}
            </button>
          )}
        </>
      ) : (
        <p className="text-[12.5px] text-ink-400">本次回答未生成 SQL 语句</p>
      )}
    </SectionCard>
  );
}

function ResultTable({ table, limit }: { table: TableData | null; limit?: number }) {
  if (!table || !table.columns.length) {
    return (
      <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-canvas-soft">
        <span className="text-[12.5px] text-ink-400">本次回答没有表格数据</span>
      </div>
    );
  }

  const rows = typeof limit === 'number' ? table.rows.slice(0, limit) : table.rows;
  const numericFields = table.columns
    .filter((col) => {
      const sample = table.rows.slice(0, 30).filter((r) => r[col.field] !== null && r[col.field] !== undefined);
      if (!sample.length) return false;
      const hits = sample.filter((r) => {
        const v = r[col.field];
        if (typeof v === 'number') return Number.isFinite(v);
        return typeof v === 'string' && /^-?[\d,]+(\.\d+)?$/.test(v.trim());
      }).length;
      return hits / sample.length >= 0.8;
    })
    .map((col) => col.field);

  return (
    <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-canvas">
            {table.columns.map((col) => (
              <th
                key={col.field}
                className={`sticky top-0 border-b border-line px-2.5 py-2 font-semibold whitespace-nowrap text-ink-600 ${
                  numericFields.includes(col.field) ? 'text-right' : 'text-left'
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="transition-colors even:bg-canvas-soft hover:bg-brand-50/60">
              {table.columns.map((col) => {
                const isNum = numericFields.includes(col.field);
                return (
                  <td
                    key={col.field}
                    className={`border-b border-line px-2.5 py-1.5 whitespace-nowrap ${
                      isNum
                        ? 'text-right font-mono text-ink-800 tabular-nums'
                        : 'text-left text-ink-700'
                    }`}
                  >
                    {formatCell(row[col.field])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {typeof limit === 'number' && table.rows.length > limit && (
        <div className="border-t border-line bg-canvas-soft px-2.5 py-1.5 text-center text-[11.5px] text-ink-400">
          共 {table.rows.length} 条，仅展示前 {limit} 条 · 切换到「数据表」查看全部
        </div>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-3 shadow-card">
          <div className="skeleton h-3.5 w-28" />
          <div className="mt-3 space-y-2">
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-3 w-[86%]" />
            <div className="skeleton h-3 w-[62%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PanelEmpty() {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center px-6 text-center">
      <div className="dot-grid flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface">
        <IconChart className="h-6 w-6 text-ink-300" />
      </div>
      <p className="mt-3 text-[13px] font-medium text-ink-600">结果面板</p>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-400">
        提问后，这里会展示生成的 SQL、数据表与图表
      </p>
      <p className="mt-2 text-[11.5px] text-ink-300">拖拽左边缘可调整面板宽度</p>
    </div>
  );
}

/* ───────────────────────────── SQL 语法高亮 ───────────────────────────── */

const SQL_PATTERN = [
  '(--[^\\n]*)',
  '(/\\*[\\s\\S]*?\\*/)',
  "('(?:[^']|'')*')",
  '(\\b\\d+(?:\\.\\d+)?\\b)',
  '(\\b(?:SELECT|FROM|WHERE|GROUP\\s+BY|ORDER\\s+BY|LIMIT|OFFSET|HAVING|LEFT\\s+JOIN|RIGHT\\s+JOIN|INNER\\s+JOIN|FULL\\s+JOIN|JOIN|ON|AS|AND|OR|NOT|IN|IS|NULL|BETWEEN|LIKE|ILIKE|DESC|ASC|CASE|WHEN|THEN|ELSE|END|DISTINCT|UNION|ALL|WITH|INTERVAL|CAST|USING|EXISTS|COUNT|SUM|AVG|MIN|MAX|ROUND|COALESCE|NOW|CURRENT_DATE|CURDATE|DATE_SUB|DATE_TRUNC)\\b)',
].join('|');

const SQL_STYLES: Record<number, string> = {
  1: 'text-[#5f7189] italic',
  2: 'text-[#5f7189] italic',
  3: 'text-[#7fd6a4]',
  4: 'text-[#f0b775]',
  5: 'text-[#8ab4ff] font-semibold',
};

function highlightSql(sql: string): ReactNode {
  const re = new RegExp(SQL_PATTERN, 'gi');
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(sql)) !== null) {
    if (match.index > cursor) {
      nodes.push(<span key={key++}>{sql.slice(cursor, match.index)}</span>);
    }
    const groupIndex = [1, 2, 3, 4, 5].find((i) => match![i] !== undefined) ?? 0;
    nodes.push(
      <span key={key++} className={SQL_STYLES[groupIndex] ?? 'text-[#dbe4f0]'}>
        {match[0]}
      </span>,
    );
    cursor = match.index + match[0].length;
    if (match[0].length === 0) re.lastIndex += 1;
  }

  if (cursor < sql.length) {
    nodes.push(<span key={key++}>{sql.slice(cursor)}</span>);
  }

  return <span className="text-[#dbe4f0]">{nodes}</span>;
}
