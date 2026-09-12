'use client';

import { useId, useMemo, useState } from 'react';
import type { ChartPoint, ChartType } from './types';

/** 表格单元格数字格式化：千分位，最多两位小数 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) return value.toLocaleString('zh-CN');
    return value.toLocaleString('zh-CN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }
  return String(value);
}

/** 坐标轴刻度用的紧凑数字 */
function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${trim(value / 1e8)}亿`;
  if (abs >= 1e4) return `${trim(value / 1e4)}万`;
  if (Number.isInteger(value)) return value.toLocaleString('zh-CN');
  return trim(value);
}

function trim(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** 计算「好看」的坐标轴上限与刻度 */
function niceScale(max: number, count = 4) {
  const safeMax = max > 0 ? max : 1;
  const rough = safeMax / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const stepMul = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = stepMul * mag;
  const top = step * count;
  const ticks = Array.from({ length: count + 1 }, (_, i) => step * i);
  return { top, ticks, step };
}

const PAD = { top: 30, right: 14, bottom: 38, left: 50 };
const VB_H = 250;

/** 饼图配色（与品牌蓝同色系，避免出现脏色） */
const PIE_PALETTE = [
  '#2563eb',
  '#5f93f8',
  '#0ea5a5',
  '#94b9fd',
  '#2bbdb8',
  '#f59e0b',
  '#8b5cf6',
  '#10b981',
  '#f43f5e',
  '#6d7a8c',
];

/** 饼图最多展示扇区数，超出合并为「其他」 */
const PIE_MAX_SLICES = 10;

export function DataChart({
  points,
  unit,
  height = 250,
  type = 'bar',
}: {
  points: ChartPoint[];
  unit?: string;
  height?: number;
  type?: ChartType;
}) {
  if (!points.length) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-canvas-soft text-ink-400">
        <span className="text-[13px]">暂无可视化数据</span>
        <span className="text-[11.5px]">当前结果集中没有可用于绘图的数值列</span>
      </div>
    );
  }

  return type === 'pie' ? (
    <PieView points={points} unit={unit} height={height} />
  ) : (
    <AxisView points={points} unit={unit} height={height} mode={type} />
  );
}

/* ─────────────────────── 柱状 / 折线 ─────────────────────── */

function AxisView({
  points,
  unit,
  height,
  mode,
}: {
  points: ChartPoint[];
  unit?: string;
  height: number;
  mode: 'bar' | 'line';
}) {
  // React 19 的 useId 会包含 « » 等字符，清理后再用于 SVG id 引用
  const gradId = `c${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [active, setActive] = useState<number | null>(null);

  const { top, ticks } = useMemo(() => {
    const max = points.reduce((m, p) => Math.max(m, p.value), 0);
    return niceScale(max);
  }, [points]);

  const band = 60;
  const vbW = Math.max(340, points.length * band + PAD.left + PAD.right);
  const plotW = vbW - PAD.left - PAD.right;
  const plotH = VB_H - PAD.top - PAD.bottom;
  const slot = plotW / points.length;
  const barW = Math.min(slot * 0.5, 34);
  const useLine = mode === 'line';
  const labelStep = Math.ceil(points.length / 12);
  const showValue = points.length <= 12;

  const y = (value: number) => PAD.top + plotH * (1 - value / top);
  const cx = (i: number) => PAD.left + slot * i + slot / 2;

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(2)},${y(p.value).toFixed(2)}`)
    .join(' ');
  const areaPath = `${linePath} L${cx(points.length - 1).toFixed(2)},${(
    PAD.top + plotH
  ).toFixed(2)} L${cx(0).toFixed(2)},${(PAD.top + plotH).toFixed(2)} Z`;

  const activeIndex = active !== null && active < points.length ? active : null;
  const activePoint = activeIndex !== null ? points[activeIndex] : null;
  const tooltipW = activePoint
    ? Math.max(78, String(activePoint.label).length * 11 + 34)
    : 0;
  const tooltipX =
    activeIndex !== null
      ? Math.min(Math.max(cx(activeIndex) - tooltipW / 2, 4), vbW - tooltipW - 4)
      : 0;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${vbW} ${VB_H}`}
        style={{ height, width: '100%' }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="查询结果图表"
        onMouseLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id={`bar-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5f93f8" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <linearGradient id={`area-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b74f0" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3b74f0" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 网格线 + Y 轴刻度 */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={vbW - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={i === 0 ? '#d8dce3' : '#eceef2'}
              strokeWidth={1}
              strokeDasharray={i === 0 ? undefined : '3 5'}
            />
            <text
              x={PAD.left - 9}
              y={y(t) + 3.6}
              textAnchor="end"
              fontSize="10.5"
              fill="#98a2b3"
            >
              {compact(t)}
            </text>
          </g>
        ))}

        {/* 系列 */}
        {useLine ? (
          <>
            <path d={areaPath} fill={`url(#area-${gradId})`} />
            <path
              d={linePath}
              fill="none"
              stroke="#2563eb"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {points.map((p, i) => (
              <circle
                key={i}
                cx={cx(i)}
                cy={y(p.value)}
                r={active === i ? 5 : 3.4}
                fill="#fff"
                stroke="#2563eb"
                strokeWidth={2.2}
              />
            ))}
          </>
        ) : (
          points.map((p, i) => {
            const h = Math.max((p.value / top) * plotH, p.value > 0 ? 2 : 0);
            const x = cx(i) - barW / 2;
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={PAD.top + plotH - h}
                  width={barW}
                  height={h}
                  rx={Math.min(6, barW / 2)}
                  fill={`url(#bar-${gradId})`}
                  opacity={active === null || active === i ? 1 : 0.42}
                  style={{ transition: 'opacity .18s ease' }}
                />
                {showValue && (
                  <text
                    x={cx(i)}
                    y={PAD.top + plotH - h - 8}
                    textAnchor="middle"
                    fontSize="10.5"
                    fontWeight="600"
                    fill="#55637a"
                  >
                    {compact(p.value)}
                  </text>
                )}
              </g>
            );
          })
        )}

        {/* X 轴标签 */}
        {points.map((p, i) =>
          i % labelStep === 0 ? (
            <text
              key={i}
              x={cx(i)}
              y={PAD.top + plotH + 20}
              textAnchor="middle"
              fontSize="10.5"
              fill={active === i ? '#2563eb' : '#98a2b3'}
            >
              {String(p.label).length > 10
                ? `${String(p.label).slice(0, 9)}…`
                : p.label}
            </text>
          ) : null,
        )}

        {/* hover 命中区 */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={PAD.left + slot * i}
            y={PAD.top}
            width={slot}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
          />
        ))}

        {/* 提示气泡 */}
        {activePoint && activeIndex !== null && (
          <g pointerEvents="none">
            <line
              x1={cx(activeIndex)}
              x2={cx(activeIndex)}
              y1={PAD.top - 6}
              y2={PAD.top + plotH}
              stroke="#c2d8ff"
              strokeWidth={1.4}
              strokeDasharray="3 3"
            />
            <rect
              x={tooltipX}
              y={6}
              width={tooltipW}
              height={24}
              rx={7}
              fill="#0d1526"
              opacity="0.92"
            />
            <text
              x={tooltipX + tooltipW / 2}
              y={21.6}
              textAnchor="middle"
              fontSize="11"
              fill="#fff"
            >
              {`${activePoint.label} · ${compact(activePoint.value)}${unit ?? ''}`}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ─────────────────────── 饼图 ─────────────────────── */

const PIE = {
  vbW: 480,
  cx: 130,
  cy: 126,
  rOuter: 92,
  rInner: 52,
  legendX: 252,
  rowH: 20,
};

function polar(r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [PIE.cx + r * Math.cos(rad), PIE.cy + r * Math.sin(rad)];
}

/** 环形扇区路径；满圆用两段半环拼，避免起终点重合画不出来 */
function sectorPath(startDeg: number, endDeg: number, rOuter: number, rInner: number): string {
  const sweep = endDeg - startDeg;
  if (sweep >= 359.999) {
    return `${sectorPath(0, 180, rOuter, rInner)} ${sectorPath(180, 360, rOuter, rInner)}`;
  }
  const [x1, y1] = polar(rOuter, startDeg);
  const [x2, y2] = polar(rOuter, endDeg);
  const [x3, y3] = polar(rInner, endDeg);
  const [x4, y4] = polar(rInner, startDeg);
  const large = sweep > 180 ? 1 : 0;
  return [
    `M${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function PieView({
  points,
  unit,
  height,
}: {
  points: ChartPoint[];
  unit?: string;
  height: number;
}) {
  const [active, setActive] = useState<number | null>(null);

  // 只统计正数，扇区过多时合并尾部为「其他」
  const slices = useMemo(() => {
    const positive = points.filter((p) => Number.isFinite(p.value) && p.value > 0);
    if (positive.length <= PIE_MAX_SLICES) return positive;
    const head = positive.slice(0, PIE_MAX_SLICES - 1);
    const restValue = positive
      .slice(PIE_MAX_SLICES - 1)
      .reduce((sum, p) => sum + p.value, 0);
    return [...head, { label: '其他', value: restValue }];
  }, [points]);

  const total = slices.reduce((sum, p) => sum + p.value, 0);

  if (!slices.length || total <= 0) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-canvas-soft text-ink-400">
        <span className="text-[13px]">暂无可视化数据</span>
        <span className="text-[11.5px]">饼图需要正数值，当前结果集不满足</span>
      </div>
    );
  }

  // 只有 1 个类别时饼图就是一个整圆，没有信息量
  if (slices.length < 2) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-canvas-soft text-ink-400">
        <span className="text-[13px]">暂不适合用饼图</span>
        <span className="text-[11.5px]">当前结果只有 1 个类别，切换柱状图或折线图更直观</span>
      </div>
    );
  }

  const activeSlice = active !== null && active < slices.length ? slices[active] : null;
  const centerLabel = activeSlice ? String(activeSlice.label) : '合计';
  const centerValue = activeSlice ? activeSlice.value : total;
  const centerPct = activeSlice ? (activeSlice.value / total) * 100 : 100;
  const legendTop = PIE.cy - (slices.length * PIE.rowH) / 2;

  // 先算每段弧的起止角度（纯函数式，避免在渲染中累加外部变量）
  const sweeps = slices.map((slice) => (slice.value / total) * 360);
  const arcs = slices.map((slice, i) => {
    const start = sweeps.slice(0, i).reduce((sum, s) => sum + s, 0);
    return { slice, i, start, end: start + sweeps[i] };
  });

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${PIE.vbW} ${VB_H}`}
        style={{ height, width: '100%' }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="查询结果饼图"
        onMouseLeave={() => setActive(null)}
      >
        {arcs.map(({ slice, i, start, end }) => {
          const isActive = active === i;
          const color = PIE_PALETTE[i % PIE_PALETTE.length];
          return (
            <path
              key={i}
              d={sectorPath(start, end, isActive ? PIE.rOuter + 5 : PIE.rOuter, PIE.rInner)}
              fill={color}
              opacity={active === null || isActive ? 1 : 0.4}
              style={{ transition: 'opacity .18s ease' }}
              onMouseEnter={() => setActive(i)}
            >
              <title>{`${slice.label}: ${compact(slice.value)}${unit ?? ''}`}</title>
            </path>
          );
        })}

        {/* 圆心信息 */}
        <text
          x={PIE.cx}
          y={PIE.cy - 4}
          textAnchor="middle"
          fontSize="10.5"
          fill="#98a2b3"
        >
          {centerLabel.length > 8 ? `${centerLabel.slice(0, 7)}…` : centerLabel}
        </text>
        <text
          x={PIE.cx}
          y={PIE.cy + 14}
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          fill="#0d1526"
        >
          {compact(centerValue)}
        </text>
        <text
          x={PIE.cx}
          y={PIE.cy + 30}
          textAnchor="middle"
          fontSize="10.5"
          fill="#6d7a8c"
        >
          {`${trim(centerPct)}%${unit ? ` · ${unit}` : ''}`}
        </text>

        {/* 图例 */}
        {arcs.map(({ slice, i }, idx) => {
          const color = PIE_PALETTE[i % PIE_PALETTE.length];
          const rowY = legendTop + idx * PIE.rowH;
          const pct = (slice.value / total) * 100;
          const label = String(slice.label);
          const shortLabel = label.length > 7 ? `${label.slice(0, 6)}…` : label;
          const isActive = active === i;
          return (
            <g
              key={i}
              onMouseEnter={() => setActive(i)}
              style={{ cursor: 'default' }}
            >
              <rect
                x={PIE.legendX}
                y={rowY - 7}
                width={PIE.rowH - 8}
                height={PIE.rowH - 8}
                rx={3}
                fill={color}
                opacity={active === null || isActive ? 1 : 0.45}
              />
              <text
                x={PIE.legendX + 18}
                y={rowY + 2.5}
                fontSize="11"
                fill={isActive ? '#0d1526' : '#55637a'}
                fontWeight={isActive ? 600 : 400}
              >
                {shortLabel}
              </text>
              <text
                x={PIE.vbW - 44}
                y={rowY + 2.5}
                textAnchor="end"
                fontSize="11"
                fill="#3d4a5c"
              >
                {`${compact(slice.value)}${unit ?? ''}`}
              </text>
              <text
                x={PIE.vbW - 8}
                y={rowY + 2.5}
                textAnchor="end"
                fontSize="10.5"
                fill="#98a2b3"
              >
                {`${trim(pct)}%`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
