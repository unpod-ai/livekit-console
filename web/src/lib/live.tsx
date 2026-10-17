import { createContext, useContext, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const OPTIONS: [number, string][] = [[0, 'Auto-refresh off'], [5000, 'Every 5s'], [10000, 'Every 10s'], [30000, 'Every 30s']];
const Ctx = createContext<{ interval: number; setInterval: (n: number) => void }>({ interval: 0, setInterval: () => {} });

/** Global auto-refresh setting, shared by every live table and chart (like the Cloud dashboard's selector). */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [interval, set] = useState(() => Number(localStorage.getItem('lkc.refresh') ?? 10000));
  const setInterval = (n: number) => {
    localStorage.setItem('lkc.refresh', String(n));
    set(n);
  };
  return <Ctx.Provider value={{ interval, setInterval }}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);

export function RefreshSelect() {
  const { interval, setInterval } = useLive();
  return (
    <label className="btn secondary" style={{ gap: 6, padding: '0 8px' }}>
      <RefreshCw size={14} aria-hidden />
      <select className="sr-only-select" aria-label="Auto-refresh" value={interval} onChange={(e) => setInterval(Number(e.target.value))}
        style={{ background: 'transparent', color: 'inherit', border: 0, font: 'inherit', cursor: 'pointer' }}>
        {OPTIONS.map(([v, l]) => <option key={v} value={v} style={{ background: '#162033' }}>{l}</option>)}
      </select>
    </label>
  );
}
