import { useEffect, useRef, useState, type ReactNode } from 'react';

const PAD = { l: 40, r: 12, t: 10, b: 22 };

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 4) * p * 4 > v * 1.6 ? Math.ceil(v / (p / 2) / 4) * (p / 2) * 4 : Math.ceil(v / p / 4) * p * 4;
}

const fmtTick = (t: number, spanMs: number): string => {
  const d = new Date(t);
  return spanMs <= 2 * 86400000 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

type Tip = { x: number; y: number; title: string; rows: { color: string; label: string; value: string }[] };

function Frame({ height, children, tip, legend, empty }: { height: number; children: (w: number) => ReactNode; tip: Tip | null; legend?: { label: string; color: string }[]; empty?: boolean }) {
  const [ref, w] = useWidth();
  return (
    <div>
      <div ref={ref} style={{ position: 'relative', padding: '8px 8px 0' }}>
        {empty ? (
          <div className="empty" style={{ height }}>No data in this range</div>
        ) : (
          <svg className="chart" width={w} height={height} role="img">{children(w)}</svg>
        )}
        {tip && (
          <div className="chart-tip" style={{ left: Math.min(tip.x + 12, w - 160), top: tip.y }}>
            <div style={{ color: 'var(--muted)', marginBottom: 2 }}>{tip.title}</div>
            {tip.rows.map((r) => (
              <div key={r.label}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />{r.label}: <b>{r.value}</b></div>
            ))}
          </div>
        )}
      </div>
      {legend && legend.length > 1 && (
        <div className="legend">{legend.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</div>
      )}
    </div>
  );
}

function Axes({ w, h, max, t0, t1, fmt }: { w: number; h: number; max: number; t0: number; t1: number; fmt: (v: number) => string }) {
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const n = Math.min(6, Math.max(2, Math.floor(iw / 110)));
  const xs = Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
  return (
    <g>
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line className="grid" x1={PAD.l} x2={w - PAD.r} y1={PAD.t + (ih * i) / 4} y2={PAD.t + (ih * i) / 4} />
          <text x={PAD.l - 6} y={PAD.t + (ih * i) / 4 + 3} textAnchor="end">{fmt(max - (max * i) / 4)}</text>
        </g>
      ))}
      {xs.map((t, i) => (
        <text key={i} x={PAD.l + ((t - t0) / (t1 - t0 || 1)) * iw} y={h - 6} textAnchor={i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}>{fmtTick(t, t1 - t0)}</text>
      ))}
    </g>
  );
}

export type BarSeries = { key: string; label: string; color: string };

/** Stacked bars over time buckets. `data` rows carry `t` (bucket start, ms) plus one number per series key. */
export function BarsChart({ data, series, bucketMs, height = 190, format = (n) => String(Math.round(n)) }: { data: Record<string, number>[]; series: BarSeries[]; bucketMs: number; height?: number; format?: (n: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const empty = data.length === 0;
  const t0 = empty ? 0 : Math.min(...data.map((d) => d.t));
  const t1 = empty ? 0 : Math.max(...data.map((d) => d.t)) + bucketMs;
  const count = Math.min(600, Math.max(1, Math.round((t1 - t0) / bucketMs)));
  const byT = new Map(data.map((d) => [d.t, d]));
  const buckets = Array.from({ length: count }, (_, i) => t0 + i * bucketMs);
  const totals = buckets.map((t) => series.reduce((s, k) => s + (byT.get(t)?.[k.key] ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  return (
    <Frame height={height} tip={tip} legend={series} empty={empty}>
      {(w) => {
        const iw = w - PAD.l - PAD.r;
        const ih = height - PAD.t - PAD.b;
        const bw = iw / count;
        return (
          <g onMouseLeave={() => setTip(null)}>
            <Axes w={w} h={height} max={max} t0={t0} t1={t1} fmt={format} />
            {buckets.map((t, i) => {
              let y = PAD.t + ih;
              const row = byT.get(t);
              return (
                <g key={t}>
                  {series.map((s) => {
                    const v = row?.[s.key] ?? 0;
                    const bh = (v / max) * ih;
                    y -= bh;
                    return bh > 0 ? <rect key={s.key} x={PAD.l + i * bw + 1} y={y} width={Math.max(1, bw - 2)} height={bh} fill={s.color} rx={1.5} /> : null;
                  })}
                  <rect x={PAD.l + i * bw} y={PAD.t} width={bw} height={ih} fill="transparent"
                    onMouseMove={(e) => setTip({ x: PAD.l + i * bw + bw / 2, y: Math.max(0, e.nativeEvent.offsetY - 20), title: new Date(t).toLocaleString(), rows: series.map((s) => ({ color: s.color, label: s.label, value: format(row?.[s.key] ?? 0) })) })} />
                </g>
              );
            })}
          </g>
        );
      }}
    </Frame>
  );
}

/** Step line with area fill, e.g. participants over a session. */
export function StepChart({ points, t0, t1, color = 'var(--accent)', label = 'Participants', height = 170 }: { points: { t: number; n: number }[]; t0: number; t1: number; color?: string; label?: string; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const max = niceMax(Math.max(1, ...points.map((p) => p.n)));
  return (
    <Frame height={height} tip={tip} empty={points.length === 0}>
      {(w) => {
        const iw = w - PAD.l - PAD.r;
        const ih = height - PAD.t - PAD.b;
        const X = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * iw;
        const Y = (n: number) => PAD.t + ih - (n / max) * ih;
        let d = `M ${X(t0)} ${Y(0)}`;
        let prev = 0;
        for (const p of points) {
          d += ` L ${X(p.t)} ${Y(prev)} L ${X(p.t)} ${Y(p.n)}`;
          prev = p.n;
        }
        d += ` L ${X(t1)} ${Y(prev)}`;
        return (
          <g onMouseLeave={() => setTip(null)}>
            <Axes w={w} h={height} max={max} t0={t0} t1={t1} fmt={(n) => String(Math.round(n))} />
            <path d={`${d} L ${X(t1)} ${Y(0)} Z`} fill={color} opacity={0.14} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.75} />
            <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent"
              onMouseMove={(e) => {
                const t = t0 + ((e.nativeEvent.offsetX - PAD.l) / iw) * (t1 - t0);
                const n = [...points].reverse().find((p) => p.t <= t)?.n ?? 0;
                setTip({ x: e.nativeEvent.offsetX, y: Math.max(0, e.nativeEvent.offsetY - 30), title: new Date(t).toLocaleTimeString(), rows: [{ color, label, value: String(n) }] });
              }} />
          </g>
        );
      }}
    </Frame>
  );
}
