import { useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

const choices = [{ value: 'system', label: 'System', Icon: Monitor }, { value: 'light', label: 'Light', Icon: Sun }, { value: 'dark', label: 'Dark', Icon: Moon }] as const;
const subscribe = (notify: () => void) => { window.addEventListener('console-theme-change', notify); return () => window.removeEventListener('console-theme-change', notify); };
export function ThemeControl() {
  const value = useSyncExternalStore(subscribe, () => document.documentElement.dataset.themePreference ?? 'system');
  return <div className="theme-control" role="group" aria-label="Appearance">
    {choices.map(({ value: choice, label, Icon }) => <button key={choice} type="button" aria-label={`Use ${choice} theme`} title={`${label} appearance`} aria-pressed={value === choice} onClick={() => window.dispatchEvent(new CustomEvent('console-theme-set', { detail: choice }))}>
      <Icon size={16} aria-hidden="true" /><span className="sr-only">{label}</span>
    </button>)}
  </div>;
}
