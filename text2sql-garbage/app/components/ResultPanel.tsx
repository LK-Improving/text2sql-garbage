'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DataChart, formatCell } from './DataChart';
import { getChartPoints, getChartUnit, getImages, getTable } from './derive';
import { SqlEditor } from './SqlEditor';
import {
  IconChart,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCode,
  IconCopy,
  IconDownload,
  IconFileSpreadsheet,
  IconImage,
  IconLoader,
  IconRefresh,
  IconSpark,
  IconTable,
} from './icons';
import type {
  ChartPoint,
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
  onRerun,
  rerunning = false,
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
  /** 编辑 SQL 后重新执行（由父组件实现，调 /api/execute） */
  onRerun?: (sql: string) => void | Promise<void>;
  rerunning?: boolean;
}) {
  const table = getTable(result);
  const points = getChartPoints(result);
  const unit = getChartUnit(result);
  const images = getImages(result);
  const rowCount = table?.rows.length ?? 0;

  const [resizing, setResizing] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
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

  /** 导出真实 .xlsx：服务端 exceljs 生成后以附件流式返回（不依赖 OSS） */
  const handleExportExcel = async () => {
    if (!table || !table.rows.length) {
      onNotify('当前没有可导出的表格数据');
      return;
    }
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch('/api/export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: table.columns,
          rows: table.rows,
          title: result?.title ?? '查询结果',
        }),
      });
      if (!res.ok) {
        const info = await res.json().catch(() => null);
        onNotify(`导出失败：${info?.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
      const plain = /filename="?([^";]+)"?/i.exec(disposition);
      const name = star
        ? decodeURIComponent(star[1])
        : plain
          ? plain[1]
          : `${result?.title || '查询结果'}.xlsx`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      onNotify(`已导出 ${table.rows.length} 行到 Excel`);
    } catch {
      onNotify('导出失败，请稍后重试');
    } finally {
      setExporting(false);
    }
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
              {result.telemetry && <TelemetryBadge telemetry={result.telemetry} />}
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
                          label="CSV"
                          title="导出为 CSV 文件（前端生成）"
                          onClick={handleDownload}
                        />
                        <GhostButton
                          icon={
                            exporting ? (
                              <IconLoader className="h-3.5 w-3.5 animate-rotate" />
                            ) : (
                              <IconFileSpreadsheet className="h-3.5 w-3.5" />
                            )
                          }
                          label={exporting ? '导出中' : 'Excel'}
                          title="导出为 .xlsx（服务端 exceljs 生成，无需 OSS）"
                          onClick={handleExportExcel}
                        />
                      </div>
                    }
                  >
                    <ResultTable table={table} limit={8} />
                  </SectionCard>
                  <ChartSection
                    points={points}
                    unit={unit}
                    type={chartType}
                    onTypeChange={selectChartType}
                    height={228}
                    title="图表展示"
                    onNotify={onNotify}
                  />
                  {images.length > 0 && (
                    <SectionCard
                      icon={<IconImage className="h-3.5 w-3.5" />}
                      title="图片"
                    >
                      <div className="space-y-2">
                        {images.map((img, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={img.src}
                            alt={img.alt}
                            className="w-full rounded-lg border border-line"
                          />
                        ))}
                      </div>
                    </SectionCard>
                  )}
                </>
              )}

              {tab === 'sql' && (
                <SqlEditorTab
                  sql={result.sql}
                  copied={copiedKey === 'sql'}
                  onCopy={() => handleCopy(result.sql, 'sql', 'SQL 语句')}
                  onRerun={onRerun}
                  rerunning={rerunning}
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
                        label="CSV"
                        title="导出为 CSV 文件（前端生成）"
                        onClick={handleDownload}
                      />
                      <GhostButton
                        icon={
                          exporting ? (
                            <IconLoader className="h-3.5 w-3.5 animate-rotate" />
                          ) : (
                            <IconFileSpreadsheet className="h-3.5 w-3.5" />
                          )
                        }
                        label={exporting ? '导出中' : 'Excel'}
                        title="导出为 .xlsx（服务端 exceljs 生成，无需 OSS）"
                        onClick={handleExportExcel}
                      />
                    </div>
                  }
                >
                  <ResultTable table={table} />
                </SectionCard>
              )}

              {tab === 'chart' && (
                <ChartSection
                  points={points}
                  unit={unit}
                  type={chartType}
                  onTypeChange={selectChartType}
                  height={268}
                  title="图表分析"
                  onNotify={onNotify}
                />
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

/** SQL 标签页：Monaco 可编辑 + 重新执行（编辑后的 SQL 走服务端校验后直接查库） */
function SqlEditorTab({
  sql,
  copied,
  onCopy,
  onRerun,
  rerunning,
}: {
  sql: string;
  copied: boolean;
  onCopy: () => void;
  onRerun?: (sql: string) => void | Promise<void>;
  rerunning: boolean;
}) {
  const [draft, setDraft] = useState(sql ?? '');

  // 换了一轮回答（sql 变化）时同步编辑器内容
  useEffect(() => {
    setDraft(sql ?? '');
  }, [sql]);

  const trimmed = draft.trim();
  const dirty = trimmed !== (sql ?? '').trim();
  const canRun = Boolean(onRerun) && trimmed.length > 0 && !rerunning;

  return (
    <SectionCard
      icon={<IconCode className="h-3.5 w-3.5" />}
      title="SQL 语句"
      meta={dirty ? '已修改' : undefined}
      action={
        <div className="flex items-center gap-1.5">
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
          {onRerun && (
            <button
              type="button"
              onClick={() => {
                if (canRun) onRerun?.(draft);
              }}
              disabled={!canRun}
              title="直接执行编辑后的 SQL（不再经过大模型）"
              className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] whitespace-nowrap transition-colors ${
                canRun
                  ? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
                  : 'cursor-not-allowed border-line bg-canvas text-ink-300'
              }`}
            >
              {rerunning ? (
                <IconLoader className="h-3.5 w-3.5 animate-rotate" />
              ) : (
                <IconRefresh className="h-3.5 w-3.5" />
              )}
              {rerunning ? '执行中' : '重新执行'}
            </button>
          )}
        </div>
      }
    >
      {trimmed ? (
        <>
          <SqlEditor value={draft} onChange={setDraft} height={260} />
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-400">
            可直接编辑上面的 SQL，点「重新执行」会走服务端安全校验（表名白名单 / 强制 LIMIT）后查库，无需大模型。
            {dirty && <span className="text-brand-600"> · 有未执行的修改</span>}
          </p>
        </>
      ) : (
        <p className="text-[12.5px] text-ink-400">本次回答未生成 SQL 语句</p>
      )}
    </SectionCard>
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

type SortState = { field: string; dir: 'asc' | 'desc' } | null;

const PAGE_SIZES = [10, 20, 50];

/** 排序用的取值：数值列转 number，其余转 string；空值返回 null（排最后） */
function sortValueOf(value: unknown, numeric: boolean): number | string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!numeric) return String(value);
  const n =
    typeof value === 'number' ? value : Number(String(value).replace(/[,，\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 数据表：预览模式（传 limit）只展示前 N 行；
 * 完整模式（不传 limit）支持**点表头排序 + 分页**，替代之前「超 40 行直接截断」的粗糙做法。
 */
function ResultTable({ table, limit }: { table: TableData | null; limit?: number }) {
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const columns = table?.columns ?? [];
  const rows = table?.rows ?? [];

  const numericFields = useMemo(
    () =>
      columns
        .filter((col) => {
          const sample = rows
            .slice(0, 30)
            .filter((r) => r[col.field] !== null && r[col.field] !== undefined);
          if (!sample.length) return false;
          const hits = sample.filter((r) => {
            const v = r[col.field];
            if (typeof v === 'number') return Number.isFinite(v);
            return typeof v === 'string' && /^-?[\d,]+(\.\d+)?$/.test(v.trim());
          }).length;
          return hits / sample.length >= 0.8;
        })
        .map((col) => col.field),
    [columns, rows],
  );

  // 换了一份结果就重置排序与翻页
  useEffect(() => {
    setSort(null);
    setPage(0);
  }, [table]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const numeric = numericFields.includes(sort.field);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValueOf(a[sort.field], numeric);
      const bv = sortValueOf(b[sort.field], numeric);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), 'zh-CN') * dir;
    });
  }, [rows, sort, numericFields]);

  if (!table || !columns.length) {
    return (
      <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-canvas-soft">
        <span className="text-[12.5px] text-ink-400">本次回答没有表格数据</span>
      </div>
    );
  }

  const preview = typeof limit === 'number';
  const pageCount = preview ? 1 : Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const displayRows = preview
    ? sorted.slice(0, limit)
    : sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (field: string) => {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' };
      if (prev.dir === 'asc') return { field, dir: 'desc' };
      return null; // 第三次点击恢复原始顺序
    });
    setPage(0);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-canvas">
              {columns.map((col) => {
                const isNum = numericFields.includes(col.field);
                const active = sort?.field === col.field;
                return (
                  <th
                    key={col.field}
                    className={`sticky top-0 border-b border-line px-2.5 py-2 font-semibold whitespace-nowrap text-ink-600 ${
                      isNum ? 'text-right' : 'text-left'
                    }`}
                  >
                    {preview ? (
                      col.label
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.field)}
                        title="点击排序（升序 / 降序 / 还原）"
                        className={`inline-flex w-full items-center gap-0.5 hover:text-brand-600 ${
                          isNum ? 'flex-row-reverse justify-start' : 'justify-start'
                        }`}
                      >
                        <span className="truncate">{col.label}</span>
                        <span className={active ? 'text-brand-500' : 'text-ink-300'}>
                          {active && sort?.dir === 'asc' ? (
                            <IconChevronUp className="h-3 w-3" />
                          ) : (
                            <IconChevronDown className="h-3 w-3" />
                          )}
                        </span>
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} className="transition-colors even:bg-canvas-soft hover:bg-brand-50/60">
                {columns.map((col) => {
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
      </div>

      {preview && sorted.length > limit && (
        <div className="border-t border-line bg-canvas-soft px-2.5 py-1.5 text-center text-[11.5px] text-ink-400">
          共 {sorted.length} 条，仅展示前 {limit} 条 · 切换到「数据表」查看全部
        </div>
      )}

      {!preview && sorted.length > PAGE_SIZES[0] && (
        <div className="flex items-center gap-2 border-t border-line bg-canvas-soft px-2.5 py-1.5 text-[11.5px] text-ink-500">
          <span className="tabular-nums">
            共 {sorted.length} 条 · 第 {safePage + 1}/{pageCount} 页
          </span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="ml-auto rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-ink-600"
            title="每页条数"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} 条/页
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 disabled:opacity-40 enabled:hover:border-brand-200 enabled:hover:text-brand-700"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 disabled:opacity-40 enabled:hover:border-brand-200 enabled:hover:text-brand-700"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── P2-1 遥测 / P2-3 图表导出 ─────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 响应遥测徽标：命中缓存 / 首 token 耗时 / 总耗时 */
function TelemetryBadge({ telemetry }: { telemetry: NonNullable<OutputConfig['telemetry']> }) {
  const secs = (ms?: number) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(2)}s` : null);
  const parts: string[] = [];
  if (telemetry.cacheHit) parts.push('命中 SQL 缓存 · 已跳过模型');
  else if (secs(telemetry.ttftMs)) parts.push(`首字 ${secs(telemetry.ttftMs)}`);
  const total = secs(telemetry.totalMs);
  if (total) parts.push(`总耗时 ${total}`);
  if (!parts.length) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-500">
      <IconSpark className="h-3.5 w-3.5 text-brand-500" />
      <span className="truncate">{parts.join(' · ')}</span>
      {telemetry.cacheHit && (
        <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10.5px] font-medium text-brand-700">
          缓存
        </span>
      )}
    </div>
  );
}

/** 图表卡片：内置「导出 PNG / 复制图片」，把页面上的自绘 SVG 栅格化成位图 */
function ChartSection({
  points,
  unit,
  type,
  onTypeChange,
  height,
  title,
  onNotify,
}: {
  points: ChartPoint[];
  unit?: string;
  type: ChartType;
  onTypeChange: (type: ChartType) => void;
  height: number;
  title: string;
  onNotify: NotifyHandler;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'png' | 'copy' | null>(null);

  const run = async (mode: 'png' | 'copy') => {
    const svg = wrapRef.current?.querySelector('svg');
    if (!svg) {
      onNotify('暂无可导出的图表');
      return;
    }
    setBusy(mode);
    try {
      const blob = await svgToPngBlob(svg);
      if (!blob) {
        onNotify('图表导出失败，请改用「下载数据」');
        return;
      }
      if (mode === 'png') {
        downloadBlob(blob, buildChartFileName(title));
        onNotify('已导出图表 PNG');
      } else {
        const ok = await copyImageBlob(blob);
        onNotify(ok ? '图表已复制到剪贴板，可直接粘贴' : '复制失败，可改用「PNG」下载');
      }
    } finally {
      setBusy(null);
    }
  };

  const busyIcon = (mode: 'png' | 'copy', fallback: ReactNode) =>
    busy === mode ? <IconLoader className="h-3.5 w-3.5 animate-rotate" /> : fallback;

  return (
    <SectionCard
      icon={<IconChart className="h-3.5 w-3.5" />}
      title={title}
      action={
        <div className="flex items-center gap-1.5">
          <ChartTypeSwitch value={type} onChange={onTypeChange} />
          <GhostButton
            icon={busyIcon('png', <IconDownload className="h-3.5 w-3.5" />)}
            label="PNG"
            title="导出图表为 PNG 图片"
            onClick={() => run('png')}
          />
          <GhostButton
            icon={busyIcon('copy', <IconImage className="h-3.5 w-3.5" />)}
            label="复制图"
            title="把图表复制为图片（可粘贴到聊天/文档）"
            onClick={() => run('copy')}
          />
        </div>
      }
    >
      <div ref={wrapRef} className="rounded-lg bg-surface">
        <DataChart points={points} unit={unit} height={height} type={type} />
      </div>
    </SectionCard>
  );
}

/** 把自绘 SVG 序列化后栅格化成 2x 高清 PNG Blob（白底，带上页面字体） */
async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob | null> {
  try {
    const viewBox = svg.getAttribute('viewBox') || '0 0 680 250';
    const nums = viewBox.split(/[\s,]+/).map(Number);
    const vbW = nums[2] || 680;
    const vbH = nums[3] || 250;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(vbW));
    clone.setAttribute('height', String(vbH));
    const fontFamily = window.getComputedStyle(svg).fontFamily;
    if (fontFamily) clone.style.fontFamily = fontFamily;

    // 补一层白底，否则 PNG 透明背景在深色文档里看不清
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(vbW));
    bg.setAttribute('height', String(vbH));
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    const xml = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('svg image load failed'));
      img.src = url;
    });

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vbW * scale);
    canvas.height = Math.round(vbH * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(img, 0, 0, vbW, vbH);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
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

/** 复制图片到剪贴板（需安全上下文 + ClipboardItem 支持，失败返回 false） */
async function copyImageBlob(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function buildChartFileName(title: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
  const safe = (title || '图表')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `${safe || '图表'}_${stamp}.png`;
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
