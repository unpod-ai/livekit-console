import { createContext, useContext, useState, type ReactNode } from 'react';

export const REFRESH_OPTIONS: [number, string][] = [[0, 'Auto-refresh off'], [5000, 'Every 5s'], [10000, 'Every 10s'], [30000, 'Every 30s'], [60000, 'Every 1m']];
const Ctx = createContext<{ interval: number; setInterval: (n: number) => void }>({ interval: 0, setInterval: () => {} });

/** Global auto-refresh setting, shared by every live table and chart (like the Cloud dashboard's selector). */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [interval, set] = useState(() => {
    const saved = Number(localStorage.getItem('lkc.refresh') ?? 10000);
    return REFRESH_OPTIONS.some(([v]) => v === saved) ? saved : 10000;
  });
  const setInterval = (n: number) => {
    localStorage.setItem('lkc.refresh', String(n));
    set(n);
  };
  return <Ctx.Provider value={{ interval, setInterval }}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);
