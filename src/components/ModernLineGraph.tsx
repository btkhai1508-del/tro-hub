import React, { useState, useMemo } from 'react';
import { TrendingUp, Zap, Droplet } from './AppIcons';
import { cn } from '../lib/utils';

export interface MonthTrendItem {
  month: string;
  dien: number;
  nuoc: number;
  tienDien?: number;
  tienNuoc?: number;
  doanhThu?: number;
  soNguoi?: number;
  soXe?: number;
}

interface ModernLineGraphProps {
  data: MonthTrendItem[];
  selectedMonth: string;
  onSelectMonth?: (month: string) => void;
}

// Generate smooth cubic bezier SVG path from a series of 2D points
function generateSmoothCurve(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const dx1 = (p2.x - p0.x) * 0.18;
    const dy1 = (p2.y - p0.y) * 0.18;
    const dx2 = (p3.x - p1.x) * 0.18;
    const dy2 = (p3.y - p1.y) * 0.18;

    const cp1x = p1.x + dx1;
    const cp1y = p1.y + dy1;
    const cp2x = p2.x - dx2;
    const cp2y = p2.y - dy2;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// Generate closed area path for smooth gradient fill under the curve
function generateAreaPath(points: { x: number; y: number }[], baseY: number): string {
  if (points.length < 2) return '';
  const curve = generateSmoothCurve(points);
  const firstX = points[0].x.toFixed(1);
  const lastX = points[points.length - 1].x.toFixed(1);
  return `${curve} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
}

// Use only real observations from the six months ending at selectedMonth.
function ensureSixMonthsTrend(rawList: MonthTrendItem[], targetMonth: string): MonthTrendItem[] {
  const parts = (targetMonth || '10/2026').split('/');
  const curM = parseInt(parts[0], 10) || 10;
  const curY = parseInt(parts[1], 10) || 2026;

  const result: MonthTrendItem[] = [];
  for (let i = 5; i >= 0; i--) {
    let m = curM - i;
    let y = curY;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    const monthStr = `${String(m).padStart(2, '0')}/${y}`;
    const cleanStr = monthStr.replace('/', '');

    const found = rawList.find(item => {
      const im = String(item.month || '').trim();
      return im === monthStr || im.replace('/', '') === cleanStr || im === `Tháng ${monthStr}`;
    });

    if (found) {
      result.push({
        ...found,
        month: monthStr,
        dien: Number(found.dien || 0),
        nuoc: Number(found.nuoc || 0)
      });
    }
  }
  return result;
}

export function ModernLineGraph({ data, selectedMonth, onSelectMonth }: ModernLineGraphProps) {
  const [activeFilter, setActiveFilter] = useState<'all' | 'dien' | 'nuoc'>('all');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const fmt = (n: number) => Number(n || 0).toLocaleString('vi-VN');

  // Missing periods stay absent; never invent financial or usage data.
  const sixMonths = useMemo(() => {
    return ensureSixMonthsTrend(data || [], selectedMonth);
  }, [data, selectedMonth]);

  // Dimensions
  const svgWidth = 860;
  const svgHeight = 280;
  const leftPad = 60;
  const rightPad = 60;
  const topPad = 40;
  const bottomPad = 50;
  const plotWidth = svgWidth - leftPad - rightPad;
  const plotHeight = svgHeight - topPad - bottomPad;
  const baseY = svgHeight - bottomPad;

  // Scales
  const dienValues = sixMonths.map(d => d.dien);
  const nuocValues = sixMonths.map(d => d.nuoc);

  const rawMinDien = Math.min(...dienValues);
  const rawMaxDien = Math.max(...dienValues);
  const minDien = Math.max(0, Math.floor(rawMinDien * 0.92));
  const maxDien = Math.ceil(rawMaxDien * 1.08);

  const rawMinNuoc = Math.min(...nuocValues);
  const rawMaxNuoc = Math.max(...nuocValues);
  const minNuoc = Math.max(0, Math.floor(rawMinNuoc * 0.90));
  const maxNuoc = Math.ceil(rawMaxNuoc * 1.10);

  // X coordinate
  const getX = (index: number) => {
    return leftPad + (plotWidth / Math.max(1, sixMonths.length - 1)) * index;
  };

  // Y coordinates
  const getYDien = (val: number) => {
    const ratio = (val - minDien) / (maxDien - minDien || 1);
    return baseY - ratio * plotHeight;
  };

  const getYNuoc = (val: number) => {
    const ratio = (val - minNuoc) / (maxNuoc - minNuoc || 1);
    return baseY - ratio * plotHeight;
  };

  // Points arrays
  const dienPoints = sixMonths.map((d, i) => ({ x: getX(i), y: getYDien(d.dien) }));
  const nuocPoints = sixMonths.map((d, i) => ({ x: getX(i), y: getYNuoc(d.nuoc) }));

  // Paths
  const dienCurve = generateSmoothCurve(dienPoints);
  const nuocCurve = generateSmoothCurve(nuocPoints);
  const dienArea = generateAreaPath(dienPoints, baseY);
  const nuocArea = generateAreaPath(nuocPoints, baseY);

  // Currently focused item (hovered or latest selected)
  const activeIndex = hoveredIndex !== null 
    ? hoveredIndex 
    : Math.max(0, sixMonths.findIndex(d => d.month === selectedMonth));

  // Mouse move handler to find closest month
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratioX = clientX / rect.width;
    const svgX = ratioX * svgWidth;

    let closestIdx = 0;
    let minDiff = Infinity;
    sixMonths.forEach((_, i) => {
      const diff = Math.abs(getX(i) - svgX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    });
    setHoveredIndex(closestIdx);
  };

  return (
    <div className="w-full flex flex-col space-y-4">
      {/* Header with Title & Legend Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="icon-plate w-10 h-10 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
            <TrendingUp size={22} />
          </div>
          <div>
            <h3 className="type-h4 text-slate-900 dark:text-white font-bold">
              Biểu đồ tiêu thụ Điện & Nước
            </h3>
            <p className="text-xs text-slate-600 mt-0.5 dark:text-neutral-300">
              Diễn biến chỉ số qua các chu kỳ tháng
            </p>
          </div>
        </div>

        {/* View Mode Filters */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 self-start sm:self-auto">
          <button
            type="button"
            aria-pressed={activeFilter === 'all'} onClick={() => setActiveFilter('all')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
              activeFilter === 'all'
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                : "text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <span>Tất cả</span>
          </button>

          <button
            type="button"
            aria-pressed={activeFilter === 'dien'} onClick={() => setActiveFilter('dien')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
              activeFilter === 'dien'
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                : "text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Zap size={13} className={activeFilter === 'dien' ? "text-white dark:text-slate-900" : "text-slate-900 dark:text-white"} />
            <span>Điện (kW)</span>
          </button>

          <button
            type="button"
            aria-pressed={activeFilter === 'nuoc'} onClick={() => setActiveFilter('nuoc')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
              activeFilter === 'nuoc'
                ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs"
                : "text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white"
            )}
          >
            <Droplet size={13} className={activeFilter === 'nuoc' ? "text-white dark:text-slate-900" : "text-slate-900 dark:text-white"} />
            <span>Nước (m³)</span>
          </button>
        </div>
      </div>

      {sixMonths.length > 0 ? <>
      {/* SVG Canvas Container */}
      <div className="relative w-full bg-slate-50/60 dark:bg-slate-900/50 rounded-2xl border border-slate-200/50 dark:border-slate-800/80 p-2 sm:p-3 overflow-hidden select-none">
        <svg role="img" aria-label="Xu hướng điện và nước theo kỳ. Mở bảng số liệu bên dưới để đọc hoặc chọn kỳ bằng bàn phím."
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-56 sm:h-64 cursor-crosshair overflow-visible"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            {/* Amber gradient for Electricity */}
            <linearGradient id="modernDienGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.30" />
              <stop offset="60%" stopColor="#f59e0b" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.00" />
            </linearGradient>

            {/* Blue gradient for Water */}
            <linearGradient id="modernNuocGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
              <stop offset="60%" stopColor="#2563eb" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.00" />
            </linearGradient>

            {/* Drop shadow filter for active point */}
            <filter id="pointGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.35" />
            </filter>
          </defs>

          {/* Horizontal Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = topPad + plotHeight * ratio;
            return (
              <g key={idx}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={svgWidth - rightPad}
                  y2={y}
                  className="stroke-slate-200/70 dark:stroke-slate-800"
                  strokeDasharray="4,4"
                  strokeWidth="1"
                />
              </g>
            );
          })}

          {/* Baseline axis */}
          <line
            x1={leftPad}
            y1={baseY}
            x2={svgWidth - rightPad}
            y2={baseY}
            className="stroke-slate-300 dark:stroke-slate-700"
            strokeWidth="1.2"
          />

          {/* Hover Indicator Vertical Line */}
          {activeIndex !== null && (
            <line
              x1={getX(activeIndex)}
              y1={topPad - 10}
              x2={getX(activeIndex)}
              y2={baseY}
              className="stroke-indigo-400 dark:stroke-indigo-400"
              strokeDasharray="3,3"
              strokeWidth="1.5"
            />
          )}

          {/* Area Fills */}
          {(activeFilter === 'all' || activeFilter === 'dien') && (
            <path
              d={dienArea}
              fill="url(#modernDienGradient)"
              className="transition-opacity duration-300"
            />
          )}

          {(activeFilter === 'all' || activeFilter === 'nuoc') && (
            <path
              d={nuocArea}
              fill="url(#modernNuocGradient)"
              className="transition-opacity duration-300"
            />
          )}

          {/* Smooth Curves */}
          {(activeFilter === 'all' || activeFilter === 'dien') && (
            <path
              d={dienCurve}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-xs"
            />
          )}

          {(activeFilter === 'all' || activeFilter === 'nuoc') && (
            <path
              d={nuocCurve}
              fill="none"
              stroke="#2563eb"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-xs"
            />
          )}

          {/* Data Points and Value Badges */}
          {sixMonths.map((item, idx) => {
            const cx = getX(idx);
            const dy = getYDien(item.dien);
            const wy = getYNuoc(item.nuoc);
            const isHovered = activeIndex === idx;

            return (
              <g
                key={idx}
                className="cursor-pointer"
                onClick={() => onSelectMonth && onSelectMonth(item.month)}
              >
                {/* Month Label on X-axis */}
                <g>
                  {isHovered && (
                    <rect
                      x={cx - 30}
                      y={baseY + 10}
                      width={60}
                      height={22}
                      rx={6}
                      className="fill-indigo-600 text-white"
                    />
                  )}
                  <text
                    x={cx}
                    y={baseY + 25}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={isHovered ? "800" : "600"}
                    className={cn(
                      isHovered
                        ? "fill-white"
                        : "fill-slate-500 dark:fill-slate-400 hover:fill-slate-900"
                    )}
                  >
                    {item.month}
                  </text>
                </g>

                {/* Electricity Dot & Label */}
                {(activeFilter === 'all' || activeFilter === 'dien') && (
                  <g>
                    {isHovered && (
                      <circle
                        cx={cx}
                        cy={dy}
                        r="11"
                        fill="#f59e0b"
                        opacity="0.25"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={dy}
                      r={isHovered ? "6.5" : "4.5"}
                      fill="#f59e0b"
                      stroke="#ffffff"
                      strokeWidth={isHovered ? "2.5" : "1.8"}
                      filter={isHovered ? "url(#pointGlow)" : undefined}
                      className="transition-all duration-200"
                    />
                    <text
                      x={cx}
                      y={dy - 10}
                      textAnchor="middle"
                      fontSize={isHovered ? "11.5" : "10"}
                      fontWeight="800"
                      fill="#d97706"
                      className="select-none font-num drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)] dark:drop-shadow-none"
                    >
                      {fmt(item.dien)}
                    </text>
                  </g>
                )}

                {/* Water Dot & Label */}
                {(activeFilter === 'all' || activeFilter === 'nuoc') && (
                  <g>
                    {isHovered && (
                      <circle
                        cx={cx}
                        cy={wy}
                        r="11"
                        fill="#2563eb"
                        opacity="0.25"
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={wy}
                      r={isHovered ? "6.5" : "4.5"}
                      fill="#2563eb"
                      stroke="#ffffff"
                      strokeWidth={isHovered ? "2.5" : "1.8"}
                      filter={isHovered ? "url(#pointGlow)" : undefined}
                      className="transition-all duration-200"
                    />
                    <text
                      x={cx}
                      y={wy + 18}
                      textAnchor="middle"
                      fontSize={isHovered ? "11.5" : "10"}
                      fontWeight="800"
                      fill="#2563eb"
                      className="select-none font-num drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)] dark:drop-shadow-none"
                    >
                      {fmt(item.nuoc)} m³
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <details className="kit-disclosure kit-data-surface rounded-2xl">
        <summary className="kit-disclosure-summary apple-headline">Xem số liệu theo kỳ<span className="kit-disclosure-chevron" aria-hidden="true">⌄</span></summary>
        <div className="px-3 pb-3 space-y-1">
          <div className="grid grid-cols-3 gap-2 px-2 apple-callout kit-text-secondary"><span>Kỳ</span><span className="text-right">Điện (kWh)</span><span className="text-right">Nước (m³)</span></div>
          {sixMonths.map(item => <div key={item.month} className="grid grid-cols-3 items-center gap-2 border-t border-[var(--separator)] px-2 apple-callout">
            <button type="button" className="min-h-11 text-left font-semibold kit-text-primary" aria-label={"Xem kỳ " + item.month} aria-pressed={item.month === selectedMonth} onClick={() => onSelectMonth?.(item.month)}>{item.month}</button>
            <span className="text-right font-num kit-text-primary">{fmt(item.dien)}</span><span className="text-right font-num kit-text-primary">{fmt(item.nuoc)}</span>
          </div>)}
          {sixMonths.length < 6 && <p className="pt-2 apple-callout kit-text-secondary">Chỉ hiển thị các kỳ có dữ liệu. Không nội suy kỳ còn thiếu.</p>}
        </div>
      </details>
      </> : <div role="status" className="kit-data-surface rounded-2xl p-6 text-center"><p className="apple-headline kit-text-primary">Chưa có dữ liệu biểu đồ</p><p className="mt-1 apple-callout kit-text-secondary">Số liệu điện và nước sẽ hiển thị khi được cập nhật cho kỳ này.</p></div>}
    </div>
  );
}
