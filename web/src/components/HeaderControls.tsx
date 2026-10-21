import { useEffect, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Clock, RefreshCw } from 'lucide-react';
import { REFRESH_OPTIONS, useLive } from '../lib/live';
import { RANGE_OPTIONS, rangeLabel, useRange } from '../lib/range';
import { relTime } from '../lib/format';
import { Dropdown } from './Dropdown';
import { ThemeControl } from './ThemeControl';

/** Top-right page controls, like Cloud's: time range, manual refresh, auto-refresh interval, and when data last updated. */
export function HeaderControls({ range, refresh }: { range?: boolean; refresh?: boolean }) {
  const qc = useQueryClient();
  const fetching = useIsFetching() > 0;
  const { interval, setInterval } = useLive();
  const { hours, setHours } = useRange();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const updatedAt = Math.max(0, ...qc.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt));

  return (
    <>
      <ThemeControl />
      {refresh && updatedAt > 0 && <span className="muted" style={{ fontSize: 12 }} aria-live="off">Updated {relTime(updatedAt)}</span>}
      {range && (
        <Dropdown title="Time range" icon={<Clock size={14} aria-hidden />} label={rangeLabel(hours)} value={hours} onSelect={(h) => setHours(Number(h))} items={RANGE_OPTIONS.map(([id, label]) => ({ id, label }))} />
      )}
      {refresh && (
        <>
          <button type="button" className="btn secondary icon" aria-label="Refresh now" title="Refresh now" onClick={() => qc.invalidateQueries()}>
            <RefreshCw size={14} className={fetching ? 'spin' : ''} aria-hidden />
          </button>
          <Dropdown title="Auto-refresh" label={REFRESH_OPTIONS.find(([v]) => v === interval)?.[1] ?? 'Auto-refresh'} value={interval} onSelect={(v) => setInterval(Number(v))} items={REFRESH_OPTIONS.map(([id, label]) => ({ id, label }))} />
        </>
      )}
    </>
  );
}
