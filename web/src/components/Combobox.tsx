import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

type Option = { value: string; label: string; disabled?: boolean };
/** Short lists keep native semantics; long lists gain an explicitly labelled search. */
export function Combobox({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 280, maxHeight: 360 });
  const button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const id = useId(), searchId = useId();
  const filtered = options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()));
  const close = (restore = false) => { setOpen(false); setQuery(''); if (restore) button.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => { if(matchMedia('(max-width:820px)').matches){close();return;} const r = button.current!.getBoundingClientRect(), width = Math.min(Math.max(280, r.width), innerWidth - 16), below = innerHeight - r.bottom - 16, above = r.top - 16, down = below >= 180 || below >= above;
      const maxHeight = Math.min(360, Math.max(100, down ? below : above));
      setPosition({ left: Math.max(8, Math.min(r.left, innerWidth - width - 8)), top: down ? r.bottom + 6 : Math.max(8, r.top - maxHeight - 6), width, maxHeight }); };
    place(); input.current?.focus(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => { if (!open) return; const away = (e: PointerEvent) => { if (!popup.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(); }; const focusAway = (e: FocusEvent) => { if (!popup.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(); }; document.addEventListener('pointerdown', away); document.addEventListener('focusin', focusAway); return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('focusin', focusAway); }; }, [open]);
  useEffect(() => { if (disabled) close(); }, [disabled]);
  const native = <select className="select" aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select>;
  if (options.length <= 8) return native;
  const choose = (index: number) => { const o = filtered[index]; if (o && !o.disabled) { onChange(o.value); close(true); } };
  return <span className="combobox-field">
    <span className="combobox-native">{native}</span>
    <button ref={button} className="select combobox-trigger" type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { setOpen(!open); setActive(0); }} onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); setActive(0); } }}><span>{options.find(o => o.value === value)?.label ?? 'Select an option'}</span><ChevronDown size={15} aria-hidden /></button>
    {open && createPortal(<div ref={popup} className="choice-popup combobox-popup" style={position} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      if (e.key === 'Tab') close(true);
    }}>
      <label className="combobox-search" htmlFor={searchId}><Search size={15} aria-hidden /><span className="sr-only">Search {label.toLowerCase()}</span><input ref={input} id={searchId} role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-expanded="true" aria-controls={id} aria-autocomplete="list" aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined} value={query} placeholder="Search…" onChange={e => { setQuery(e.target.value); setActive(0); }} onKeyDown={e => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))); setActive(next); document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' }); }
        if (e.key === 'Enter') { e.preventDefault(); choose(active); }
      }} /></label>
      <div id={id} role="listbox" aria-label={label} className="combobox-options">{filtered.length ? filtered.map((o, i) => <div key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === value} aria-disabled={o.disabled} className={`menu-item ${i === active ? 'highlighted' : ''}`} onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(i)}><span className="choice-check">{o.value === value && <Check size={15} aria-hidden />}</span>{o.label}</div>) : <p className="inline-note" role="status">No matching options</p>}</div>
    </div>, document.body)}
  </span>;
}
