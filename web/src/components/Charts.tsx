import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/* Charts in LiveKit Cloud's visual language: thin bright lines, dot-hatched fills, mono tick labels, a dashed segment
   for the bucket that is still filling. No chart library: they are small, and this keeps the look exact. */

const PAD = { l: 44, r: 12, t: 10, b: 22 };

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export const PALETTE = { cyan: 'var(--chart-cyan)', purple: 'var(--chart-purple)', orange: 'var(--chart-orange)', green: 'var(--chart-green)', amber: 'var(--chart-amber)', gray: 'var(--chart-gray)', red: 'var(--chart-red)' };

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p / 4).find((s) => s * 4 >= v) ?? p;
  return step * 4;
}

const fmtTick = (t: number, spanMs: number): string => {
  const d = new Date(t);
  if (spanMs <= 15 * 60000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return spanMs <= 2 * 86400000 ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const compact = (n: number): string => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n * 10) / 10));

type Tip = { x: number; y: number; title: string; rows: { color: string; label: string; value: string }[] };

/** Dot pattern used for every filled area, one per colour. */
function Hatch({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.75" fill={color} opacity="0.55" />
    </pattern>
  );
}

function Frame({ height, children, tip, legend, empty, emptyText = 'No data in this range' }: { height: number; children: (w: number) => ReactNode; tip: Tip | null; legend?: { label: string; color: string }[]; empty?: boolean; emptyText?: string }) {
  const [ref, w] = useWidth();
  return (
    <div>
      {legend && legend.length > 0 && (
        <div className="legend" style={{ paddingTop: 10 }}>{legend.map((l) => <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>)}</div>
      )}
      <div ref={ref} style={{ position: 'relative', padding: '4px 8px 0' }}>
        {empty ? (
          <div className="empty" style={{ height }}>{emptyText}</div>
        ) : (
          <svg className="chart" width={w} height={height} role="img">{children(w)}</svg>
        )}
        {tip && (
          <div className="chart-tip" style={{ left: Math.min(tip.x + 12, w - 170), top: tip.y }}>
            <div style={{ color: 'var(--muted)', marginBottom: 2 }}>{tip.title}</div>
            {tip.rows.map((r) => (
              <div key={r.label}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: r.color, marginRight: 6 }} />{r.label}: <b>{r.value}</b></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Axes({ w, h, max, t0, t1, fmt }: { w: number; h: number; max: number; t0: number; t1: number; fmt: (v: number) => string }) {
  const iw = w - PAD.l - PAD.r;
  const ih = h - PAD.t - PAD.b;
  const n = Math.min(6, Math.max(2, Math.floor(iw / 120)));
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

export type Series = { key: string; label: string; color: string };
type Row = Record<string, number | null>;

/** Bucket start times covering [from, to] (or the data's own extent), so sparse data keeps its place in the range. */
function domain(data: Row[], bucketMs: number, from?: number, to?: number): { t0: number; t1: number; buckets: number[] } {
  const ts = data.map((d) => d.t as number);
  const t0 = from != null ? Math.floor(from / bucketMs) * bucketMs : ts.length ? Math.min(...ts) : 0;
  const t1 = to != null ? Math.floor(to / bucketMs) * bucketMs + bucketMs : ts.length ? Math.max(...ts) + bucketMs : 0;
  const count = Math.min(600, Math.max(1, Math.round((t1 - t0) / bucketMs)));
  return { t0, t1, buckets: Array.from({ length: count }, (_, i) => t0 + i * bucketMs) };
}

/**
 * Line chart with an optional hatched fill under the first series. Missing values break the line (latency) or fall to
 * zero (counts). The final bucket is drawn dashed while it is still open, like Cloud.
 */
export function AreaChart({
  data, series, bucketMs, from, to, height = 200, format = compact, fill = 'first', gaps = false, emptyText,
}: { data: Row[]; series: Series[]; bucketMs: number; from?: number; to?: number; height?: number; format?: (n: number) => string; fill?: 'first' | 'all' | 'none'; gaps?: boolean; emptyText?: string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const uid = useId().replace(/:/g, '');
  const { t0, t1, buckets } = domain(data, bucketMs, from, to);
  const byT = new Map(data.map((d) => [d.t as number, d]));
  const val = (t: number, k: string): number | null => {
    const v = byT.get(t)?.[k];
    return v == null ? (gaps ? null : 0) : v;
  };
  const max = niceMax(Math.max(1, ...buckets.flatMap((t) => series.map((s) => val(t, s.key) ?? 0))));
  const open = to != null && to < t1; // the last bucket has not finished
  return (
    <Frame height={height} tip={tip} legend={series.length > 1 ? series.map((s) => ({ label: s.label, color: s.color })) : undefined} empty={data.length === 0 && !from} emptyText={emptyText}>
      {(w) => {
        const iw = w - PAD.l - PAD.r;
        const ih = height - PAD.t - PAD.b;
        const X = (i: number) => PAD.l + (buckets.length === 1 ? iw / 2 : (i / (buckets.length - 1)) * iw);
        const Y = (v: number) => PAD.t + ih - (v / max) * ih;
        const step = iw / Math.max(1, buckets.length - 1);
        return (
          <g onMouseLeave={() => setTip(null)}>
            <defs>{series.map((s) => <Hatch key={s.key} id={`${uid}-${s.key}`} color={s.color} />)}</defs>
            <Axes w={w} h={height} max={max} t0={t0} t1={t1} fmt={format} />
            {series.map((s, si) => {
              const pts = buckets.map((t, i) => ({ x: X(i), v: val(t, s.key) }));
              const segs: { x: number; v: number }[][] = [[]];
              pts.forEach((p) => (p.v == null ? segs.push([]) : segs[segs.length - 1].push({ x: p.x, v: p.v })));
              const filled = fill === 'all' || (fill === 'first' && si === 0);
              return (
                <g key={s.key}>
                  {segs.filter((sg) => sg.length).map((sg, i) => {
                    // the final point is joined by a dashed line while its bucket is open
                    const solid = open && sg === segs[segs.length - 1] && sg.length > 1 ? sg.slice(0, -1) : sg;
                    const path = (a: { x: number; v: number }[]) => a.map((p, j) => `${j ? 'L' : 'M'} ${p.x} ${Y(p.v)}`).join(' ');
                    return (
                      <g key={i}>
                        {filled && <path d={`${path(sg)} L ${sg[sg.length - 1].x} ${Y(0)} L ${sg[0].x} ${Y(0)} Z`} fill={`url(#${uid}-${s.key})`} />}
                        <path d={path(solid)} fill="none" stroke={s.color} strokeWidth={1.25} strokeLinejoin="round" />
                        {solid !== sg && <path d={path(sg.slice(-2))} fill="none" stroke={s.color} strokeWidth={1.25} strokeDasharray="3 3" />}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            <rect x={PAD.l} y={PAD.t} width={iw} height={ih} fill="transparent"
              onMouseMove={(e) => {
                const i = Math.max(0, Math.min(buckets.length - 1, Math.round((e.nativeEvent.offsetX - PAD.l) / (step || 1))));
                setTip({ x: X(i), y: Math.max(0, e.nativeEvent.offsetY - 24), title: new Date(buckets[i]).toLocaleString(), rows: series.map((s) => ({ color: s.color, label: s.label, value: val(buckets[i], s.key) == null ? '—' : format(val(buckets[i], s.key) as number) })) });
              }} />
          </g>
        );
      }}
    </Frame>
  );
}

/** Stacked bars over time buckets: hatched body with a bright cap line, like Cloud's "Sessions served". */
export function BarsChart({ data, series, bucketMs, from, to, height = 190, format = compact }: { data: Row[]; series: Series[]; bucketMs: number; from?: number; to?: number; height?: number; format?: (n: number) => string }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const uid = useId().replace(/:/g, '');
  const { t0, t1, buckets } = domain(data, bucketMs, from, to);
  const byT = new Map(data.map((d) => [d.t as number, d]));
  const totals = buckets.map((t) => series.reduce((s, k) => s + ((byT.get(t)?.[k.key] as number) ?? 0), 0));
  const max = niceMax(Math.max(1, ...totals));
  return (
    <Frame height={height} tip={tip} legend={series.length > 1 ? series.map((s) => ({ label: s.label, color: s.color })) : undefined} empty={data.length === 0 && from == null}>
      {(w) => {
        const iw = w - PAD.l - PAD.r;
        const ih = height - PAD.t - PAD.b;
        const bw = iw / buckets.length;
        return (
          <g onMouseLeave={() => setTip(null)}>
            <defs>{series.map((s) => <Hatch key={s.key} id={`${uid}-${s.key}`} color={s.color} />)}</defs>
            <Axes w={w} h={height} max={max} t0={t0} t1={t1} fmt={format} />
            {buckets.map((t, i) => {
              let y = PAD.t + ih;
              const row = byT.get(t);
              return (
                <g key={t}>
                  {series.map((s) => {
                    const v = (row?.[s.key] as number) ?? 0;
                    const bh = (v / max) * ih;
                    y -= bh;
                    return bh > 0 ? (
                      <g key={s.key}>
                        <rect x={PAD.l + i * bw + 0.5} y={y} width={Math.max(1, bw - 1)} height={bh} fill={`url(#${uid}-${s.key})`} />
                        <rect x={PAD.l + i * bw + 0.5} y={y} width={Math.max(1, bw - 1)} height={1.5} fill={s.color} />
                      </g>
                    ) : null;
                  })}
                  <rect x={PAD.l + i * bw} y={PAD.t} width={bw} height={ih} fill="transparent"
                    onMouseMove={(e) => setTip({ x: PAD.l + i * bw + bw / 2, y: Math.max(0, e.nativeEvent.offsetY - 20), title: new Date(t).toLocaleString(), rows: series.map((s) => ({ color: s.color, label: s.label, value: format((row?.[s.key] as number) ?? 0) })) })} />
                </g>
              );
            })}
          </g>
        );
      }}
    </Frame>
  );
}

/** Step line with hatched fill, e.g. participants over a session. */
export function StepChart({ points, t0, t1, color = PALETTE.cyan, label = 'Participants', height = 170 }: { points: { t: number; n: number }[]; t0: number; t1: number; color?: string; label?: string; height?: number }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const uid = useId().replace(/:/g, '');
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
            <defs><Hatch id={`${uid}-h`} color={color} /></defs>
            <Axes w={w} h={height} max={max} t0={t0} t1={t1} fmt={(n) => String(Math.round(n))} />
            <path d={`${d} L ${X(t1)} ${Y(0)} Z`} fill={`url(#${uid}-h)`} />
            <path d={d} fill="none" stroke={color} strokeWidth={1.25} />
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

/** Axis-less trend line for KPI cards, with the hatched fill and dashed open bucket. */
export function Spark({ points, from, to, bucketMs, color = PALETTE.cyan, height = 44, fill = true }: { points: { t: number; n: number }[]; from: number; to: number; bucketMs: number; color?: string; height?: number; fill?: boolean }) {
  const [ref, w] = useWidth();
  const uid = useId().replace(/:/g, '');
  const t0 = Math.floor(from / bucketMs) * bucketMs;
  const count = Math.min(400, Math.max(2, Math.round((to - t0) / bucketMs) + 1));
  const byT = new Map(points.map((p) => [p.t, p.n]));
  const vals = Array.from({ length: count }, (_, i) => byT.get(t0 + i * bucketMs) ?? 0);
  const max = Math.max(1, ...vals);
  const X = (i: number) => (i / (count - 1)) * (w - 2) + 1;
  const Y = (v: number) => height - 3 - (v / max) * (height - 8);
  const path = (from: number, upto: number) => vals.slice(from, upto).map((v, i) => `${i ? 'L' : 'M'} ${X(from + i)} ${Y(v)}`).join(' ');
  return (
    <div ref={ref} aria-hidden>
      <svg width={w} height={height} className="chart" style={{ marginTop: 6 }}>
        <defs><Hatch id={`${uid}-h`} color={color} /></defs>
        {fill && <path d={`${path(0, count)} L ${X(count - 1)} ${height} L ${X(0)} ${height} Z`} fill={`url(#${uid}-h)`} />}
        <path d={path(0, count - 1)} fill="none" stroke={color} strokeWidth={1.25} />
        <path d={path(count - 2, count)} fill="none" stroke={color} strokeWidth={1.25} strokeDasharray="3 3" />
      </svg>
    </div>
  );
}

/** Ring chart with a hatched body and outlined segments, plus Cloud's "colour square, name, percent" legend. */
export function Donut({ items, size = 130 }: { items: { name: string; count: number; color?: string }[]; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const total = items.reduce((n, i) => n + i.count, 0);
  const colors = [PALETTE.cyan, PALETTE.purple, PALETTE.orange, PALETTE.green, PALETTE.amber, PALETTE.gray];
  if (!total) return <div className="empty" style={{ height: size }}>No data in this range</div>;
  const R = size / 2 - 2;
  const r = R * 0.62;
  let a0 = -Math.PI / 2;
  const arcs = items.map((it, i) => {
    const frac = it.count / total;
    const a1 = a0 + frac * Math.PI * 2 - (items.length > 1 ? 0.02 : 0);
    const pt = (rad: number, a: number) => `${size / 2 + rad * Math.cos(a)} ${size / 2 + rad * Math.sin(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const full = frac > 0.9999;
    const d = full
      ? `M ${pt(R, 0)} A ${R} ${R} 0 1 1 ${pt(R, Math.PI)} A ${R} ${R} 0 1 1 ${pt(R, 0)} M ${pt(r, 0)} A ${r} ${r} 0 1 0 ${pt(r, Math.PI)} A ${r} ${r} 0 1 0 ${pt(r, 0)}`
      : `M ${pt(R, a0)} A ${R} ${R} 0 ${large} 1 ${pt(R, a1)} L ${pt(r, a1)} A ${r} ${r} 0 ${large} 0 ${pt(r, a0)} Z`;
    const color = it.color ?? colors[i % colors.length];
    a0 += frac * Math.PI * 2;
    return { d, color, ...it, pct: Math.round(frac * 1000) / 10 };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 16, flexWrap: 'wrap' }}>
      <svg width={size} height={size} role="img" aria-label="Breakdown">
        <defs>{arcs.map((a, i) => <Hatch key={i} id={`${uid}-${i}`} color={a.color} />)}</defs>
        {arcs.map((a, i) => <path key={i} d={a.d} fill={`url(#${uid}-${i})`} stroke={a.color} strokeWidth={1.25} fillRule="evenodd" />)}
      </svg>
      <div className="legend" style={{ flexDirection: 'column', gap: 6, padding: 0 }}>
        {arcs.map((a) => <span key={a.name}><i style={{ background: a.color }} />{a.name} <span className="muted">{a.pct}%</span></span>)}
      </div>
    </div>
  );
}
