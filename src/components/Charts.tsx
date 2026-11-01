"use client";

import { useEffect, useRef, useState } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(280, Math.floor(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number) {
  const steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 50) * 50;
}

/** แท่งปลายมน 4px ด้านบน ฐานเหลี่ยม */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Column {
  key: string | number;
  tick: string | null;
  values: (number | null)[];
  lo?: number | null;
  hi?: number | null;
  highlight?: boolean;
  tip: string[];
}

export function ColumnChart({
  columns,
  series,
  unit,
  height = 240,
  title,
  showRange = false,
  marker,
}: {
  columns: Column[];
  series: { name: string; color: string }[];
  unit: string;
  height?: number;
  title: string;
  showRange?: boolean;
  marker?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 34, r: 8, t: 14, b: 30 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const maxV = niceMax(
    Math.max(1, ...columns.flatMap((c) => [...c.values.map((v) => v ?? 0), showRange ? c.hi ?? 0 : 0])),
  );
  const ticks = [0, maxV / 4, maxV / 2, (3 * maxV) / 4, maxV];
  const band = innerW / columns.length;
  const groupW = Math.min(band - 2, series.length * 24 + (series.length - 1) * 2);
  const barW = (groupW - (series.length - 1) * 2) / series.length;
  const y = (v: number) => pad.t + innerH - (v / maxV) * innerH;
  const hc = hover === null ? null : columns[hover];

  return (
    <figure className="m-0">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-sm text-ink-2">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-[3px]" style={{ background: s.color }} aria-hidden />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div ref={ref} className="relative w-full" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={title} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y(t)} textAnchor="end" dominantBaseline="central" fontSize={11} fill="var(--ink-3)">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const gx = pad.l + i * band + (band - groupW) / 2;
            const dim = hover !== null && hover !== i;
            return (
              <g key={c.key} opacity={dim ? 0.45 : 1}>
                {c.values.map((v, si) =>
                  v == null ? null : (
                    <path
                      key={si}
                      d={barPath(gx + si * (barW + 2), y(v), barW, y(0) - y(v))}
                      fill={series[si].color}
                    />
                  ),
                )}
                {showRange && c.lo != null && c.hi != null && (
                  <g stroke="var(--ink)" strokeWidth={1.5} strokeLinecap="round">
                    <line x1={gx + groupW / 2} x2={gx + groupW / 2} y1={y(c.hi)} y2={y(c.lo)} />
                    <line x1={gx + groupW / 2 - 3} x2={gx + groupW / 2 + 3} y1={y(c.hi)} y2={y(c.hi)} />
                  </g>
                )}
                {c.highlight && marker && (
                  <g>
                    <path
                      d={`M${gx + groupW / 2 - 5},${height - 4} L${gx + groupW / 2 + 5},${height - 4} L${gx + groupW / 2},${height - 11} Z`}
                      fill="var(--gold)"
                    />
                  </g>
                )}
                {c.tick && (
                  <text x={gx + groupW / 2} y={pad.t + innerH + 14} textAnchor="middle" fontSize={11} fill="var(--ink-3)">
                    {c.tick}
                  </text>
                )}
                <rect
                  x={pad.l + i * band}
                  y={pad.t}
                  width={band}
                  height={innerH + 20}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={0}
                  aria-label={c.tip.join(", ")}
                />
              </g>
            );
          })}
          <text x={4} y={8} fontSize={11} fill="var(--ink-3)">
            {unit}
          </text>
        </svg>
        {hc && hover !== null && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-md"
            style={{
              left: Math.min(Math.max(pad.l + hover * band + band / 2 - 90, 0), width - 180),
              top: 0,
              width: 180,
            }}
          >
            {hc.tip.map((t, i) => (
              <p key={i} className={i === 0 ? "font-semibold" : "text-ink-2 tnum"}>
                {t}
              </p>
            ))}
          </div>
        )}
      </div>
      {marker && <p className="mt-1 text-xs text-ink-3">สามเหลี่ยมสีเหลืองใต้แกน = {marker}</p>}
    </figure>
  );
}
