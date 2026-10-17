import { createContext, useContext, useState, type ReactNode } from 'react';

export const RANGE_OPTIONS: [number, string][] = [[1, 'Past hour'], [6, 'Past 6 hours'], [24, 'Past 24 hours'], [168, 'Past 7 days'], [720, 'Past 30 days']];
const Ctx = createContext<{ hours: number; setHours: (h: number) => void }>({ hours: 24, setHours: () => {} });

/** The time range chosen in the page header; every page that shows history reads it from here, like Cloud. */
export function RangeProvider({ children }: { children: ReactNode }) {
  const [hours, set] = useState(() => {
    const saved = Number(localStorage.getItem('lkc.range'));
    return RANGE_OPTIONS.some(([h]) => h === saved) ? saved : 24;
  });
  const setHours = (h: number) => {
    localStorage.setItem('lkc.range', String(h));
    set(h);
  };
  return <Ctx.Provider value={{ hours, setHours }}>{children}</Ctx.Provider>;
}

export const useRange = () => useContext(Ctx);
export const rangeLabel = (hours: number) => RANGE_OPTIONS.find(([h]) => h === hours)?.[1] ?? `Past ${hours}h`;
