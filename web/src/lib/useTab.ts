import { useSearchParams } from 'react-router-dom';

/** Tab state kept in the URL (?tab=…) so detail pages can be linked and survive a reload. */
export function useTab<T extends string>(dflt: T, valid: readonly T[]): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as T | null;
  const tab = raw && valid.includes(raw) ? raw : dflt;
  return [tab, (t) => setParams(t === dflt ? {} : { tab: t }, { replace: true })];
}
