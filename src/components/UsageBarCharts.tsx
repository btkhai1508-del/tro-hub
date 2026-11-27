import React, { useMemo, useState } from 'react';
import { Droplet, Zap } from './AppIcons';

/**
 * Electricity and water of the last six months as two small bar charts (one measure each, never two scales on
 * one axis). Readable on a phone: the two charts stack, every bar is a tap target that selects its month, the
 * selected month is the full-colour bar with its value written above it, the others are the same hue, lighter.
 */
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

interface Props {
  data: MonthTrendItem[];
  selectedMonth: string;
  onSelectMonth?: (month: string) => void;
}

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('vi-VN');

/** The six months ending at `selected` ("MM/YYYY"); a month with no data is kept as an empty slot. */
function sixMonths(data: MonthTrendItem[], selected: string): (MonthTrendItem & { missing?: boolean })[] {
  const [m0, y0] = (selected || '').split('/').map(Number);
  const out: (MonthTrendItem & { missing?: boolean })[] = [];
  for (let i = 5; i >= 0; i--) {
    let m = (m0 || 1) - i;
    let y = y0 || new Date().getFullYear();
    while (m <= 0) { m += 12; y -= 1; }
    const label = `${String(m).padStart(2, '0')}/${y}`;
    const found = data.find((d) => String(d.month).trim() === label || String(d.month).replace('/', '') === label.replace('/', ''));
    out.push(found ? { ...found, month: label, dien: Number(found.dien) || 0, nuoc: Number(found.nuoc) || 0 } : { month: label, dien: 0, nuoc: 0, missing: true });
  }
  return out;
}

interface ChartProps {
  title: string;
  unit: string;
  icon: React.ReactNode;
  /** Tailwind classes for the bar colour (light + dark). */
  barClass: string;
  rows: (MonthTrendItem & { missing?: boolean })[];
  value: (r: MonthTrendItem) => number;
  money?: (r: MonthTrendItem) => number | undefined;
  selectedMonth: string;
  onSelectMonth?: (month: string) => void;
}

function UsageChart({ title, unit, icon, barClass, rows, value, money, selectedMonth, onSelectMonth }: ChartProps) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...rows.map(value));
  const selected = rows.find((r) => r.month === selectedMonth);
  const shown = rows.find((r) => r.month === hover) ?? selected;
  const shownMoney = shown && money ? money(shown) : undefined;

  return (
    <figure className="min-w-0 rounded-2xl border border-neutral-200/70 bg-white/60 p-4 dark:border-neutral-700/60 dark:bg-neutral-900/40">
      <figcaption className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          {icon}
          {title}
        </span>
        <span className="text-right">
          <span className="block font-num text-xl font-semibold tabular-nums text-neutral-900 dark:text-white">
            {shown && !shown.missing ? `${fmt(value(shown))} ${unit}` : '—'}
          </span>
          <span className="block text-[11px] text-neutral-600 dark:text-neutral-300">
            Tháng {shown?.month ?? selectedMonth}{shownMoney ? ` · ${fmt(shownMoney)} đ` : ''}
          </span>
        </span>
      </figcaption>

      <div className="mt-4 flex h-36 items-end gap-1.5 border-b border-neutral-300 dark:border-neutral-600" role="list" aria-label={`${title} 6 tháng`}>
        {rows.map((r) => {
          const v = value(r);
          const isSel = r.month === selectedMonth;
          const isHot = r.month === hover;
          const pct = r.missing ? 0 : Math.max(v > 0 ? 3 : 0, (v / max) * 100);
          return (
            <button
              key={r.month}
              type="button"
              role="listitem"
              onClick={() => onSelectMonth?.(r.month)}
              onMouseEnter={() => setHover(r.month)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(r.month)}
              onBlur={() => setHover(null)}
              aria-label={`Tháng ${r.month}: ${r.missing ? 'chưa có số liệu' : `${fmt(v)} ${unit}`}`}
              aria-pressed={isSel}
              className="group relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-neutral-500"
            >
              {(isSel || isHot) && !r.missing && (
                <span className="mb-1 whitespace-nowrap font-num text-[10px] font-semibold tabular-nums text-neutral-800 dark:text-neutral-100">{fmt(v)}</span>
              )}
              <span
                className={`block w-full max-w-9 rounded-t-[4px] transition-opacity ${barClass} ${isSel ? 'opacity-100' : isHot ? 'opacity-80' : 'opacity-40'}`}
                style={{ height: `${pct}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5" aria-hidden="true">
        {rows.map((r) => (
          <span key={r.month} className={`min-w-0 flex-1 text-center font-num text-[10px] tabular-nums ${r.month === selectedMonth ? 'font-bold text-neutral-900 dark:text-white' : 'text-neutral-500 dark:text-neutral-400'}`}>
            {r.month.slice(0, 2)}/{r.month.slice(5)}
          </span>
        ))}
      </div>
    </figure>
  );
}

export function UsageBarCharts({ data, selectedMonth, onSelectMonth }: Props) {
  const rows = useMemo(() => sixMonths(data || [], selectedMonth), [data, selectedMonth]);
  return (
    <div className="space-y-3">
      <div>
        <h3 className="type-h3 font-bold text-neutral-900 dark:text-white">Điện nước 6 tháng gần nhất</h3>
        <p className="text-xs text-neutral-600 dark:text-neutral-300">Chạm vào một cột để xem tháng đó.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <UsageChart title="Điện" unit="kWh" icon={<Zap size={16} />} barClass="bg-[#eb6834] dark:bg-[#d95926]"
          rows={rows} value={(r) => r.dien} money={(r) => r.tienDien} selectedMonth={selectedMonth} onSelectMonth={onSelectMonth} />
        <UsageChart title="Nước" unit="m³" icon={<Droplet size={16} />} barClass="bg-[#2a78d6] dark:bg-[#3987e5]"
          rows={rows} value={(r) => r.nuoc} money={(r) => r.tienNuoc} selectedMonth={selectedMonth} onSelectMonth={onSelectMonth} />
      </div>
    </div>
  );
}
