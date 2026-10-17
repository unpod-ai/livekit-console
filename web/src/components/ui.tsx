import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Copy, HelpCircle, Inbox } from 'lucide-react';
import { RefreshSelect } from '../lib/live';

export type Crumb = { label: string; to?: string };

export function PageHeader({ crumbs, title, sub, actions, refresh = true }: { crumbs?: Crumb[]; title: string; sub?: ReactNode; actions?: ReactNode; refresh?: boolean }) {
  return (
    <header className="page-head">
      <div>
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <ChevronRight size={12} aria-hidden />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
              </Fragment>
            ))}
          </nav>
        )}
        <h1 className="page-title">{title}</h1>
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      <div className="head-actions">
        {actions}
        {refresh && <RefreshSelect />}
      </div>
    </header>
  );
}

export const Help = ({ text }: { text: string }) => <HelpCircle size={12} aria-label={text} role="img"><title>{text}</title></HelpCircle>;

export function Kpi({ label, value, unit, foot, help, accent, to, spark }: { label: string; value: ReactNode; unit?: string; foot?: ReactNode; help?: string; accent?: boolean; to?: string; spark?: ReactNode }) {
  const body = (
    <>
      <div className="kpi-label">{label}{help && <Help text={help} />}</div>
      <div className="kpi-value">{value}{unit && <small>{unit}</small>}</div>
      {foot && <div className="kpi-foot">{foot}</div>}
      {spark}
    </>
  );
  return to
    ? <Link to={to} className={`kpi link ${accent ? 'accent' : ''}`}>{body}</Link>
    : <div className={`kpi ${accent ? 'accent' : ''}`}>{body}</div>;
}

export const Kpis = ({ children }: { children: ReactNode }) => <div className="kpis">{children}</div>;

export function Panel({ title, actions, children, flush = true, icon }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; icon?: ReactNode }) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel-head">
          <h2 className="panel-title">{icon}{title}</h2>
          {actions}
        </div>
      )}
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Empty({ title, children, icon }: { title?: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={28} aria-hidden />}
      {title && <div className="empty-title">{title}</div>}
      {children && <div>{children}</div>}
    </div>
  );
}

export const Alert = ({ kind = 'info', children }: { kind?: 'info' | 'bad' | 'warn'; children: ReactNode }) => (
  <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : undefined}>{children}</div>
);

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function Badge({ children, tone, dot, pulse }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'info'; dot?: boolean; pulse?: boolean }) {
  return (
    <span className={`badge ${tone ?? ''} ${pulse ? 'pulse' : ''}`}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

const STATE_TONES: Record<string, 'ok' | 'warn' | 'bad' | 'info' | undefined> = {
  active: 'ok', running: 'ok', complete: 'ok', completed: 'ok', closed: undefined, ended: undefined,
  starting: 'warn', ending: 'warn', failed: 'bad', aborted: 'bad', limit_reached: 'warn',
};
export function StatusBadge({ status }: { status?: string | null }) {
  const key = (status ?? '').replace(/^(EGRESS|INGRESS|ENDPOINT)_/i, '').toLowerCase();
  const live = key === 'active' || key === 'running';
  return <Badge tone={STATE_TONES[key]} dot pulse={live}>{key ? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—'}</Badge>;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <div className="k">{k}</div>
          <div className="v">{v ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm" aria-label={label} onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export const SkeletonRows = ({ rows = 5 }: { rows?: number }) => (
  <div style={{ padding: 14, display: 'grid', gap: 12 }}>
    {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ width: `${70 + ((i * 13) % 30)}%` }} />)}
  </div>
);

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div className="field">
    <label>{label}</label>
    {children}
    {hint && <span className="hint">{hint}</span>}
  </div>
);

export const RANGES: [number, string][] = [[1, 'Past hour'], [24, 'Past 24 hours'], [168, 'Past 7 days'], [720, 'Past 30 days']];

export const RangeSelect = ({ value, onChange }: { value: number; onChange: (h: number) => void }) => (
  <select className="select" style={{ width: 'auto' }} aria-label="Time range" value={value} onChange={(e) => onChange(Number(e.target.value))}>
    {RANGES.map(([h, l]) => <option key={h} value={h}>{l}</option>)}
  </select>
);

export const ServerPager = ({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (o: number) => void }) => (
  <div className="pager">
    <span>{total ? offset + 1 : 0}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
    <button className="btn secondary sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
    <button className="btn secondary sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>Next</button>
  </div>
);
