import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type DropdownItem = { id: string | number; label: string; disabled?: boolean; danger?: boolean };

/** A value menu with keyboard selection and a viewport-bounded popup. */
export function Dropdown({ label, icon, items, value, onSelect, title, action = false }: { label: ReactNode; icon?: ReactNode; items: DropdownItem[]; value: string | number; onSelect: (id: string | number) => void; title?: string; action?: boolean }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 200, maxHeight: 320 });
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', at: 0 });
  const id = useId();
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(200, box.width), window.innerWidth - 16);
      const below = window.innerHeight - box.bottom - 16, above = box.top - 16;
      const height = Math.min(320, Math.max(80, below >= 160 || below >= above ? below : above));
      setPosition({ left: Math.max(8, Math.min(box.right - width, window.innerWidth - width - 8)), top: below >= 160 || below >= above ? box.bottom + 6 : Math.max(8, box.top - Math.min(height, items.length * 38 + 12) - 6), width, maxHeight: height });
    };
    place();
    const options = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    (Array.from(options ?? []).find(el => el.getAttribute('aria-checked') === 'true') ?? options?.[0])?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) close(); };
    const focusAway = (e: FocusEvent) => { if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) close(); };
    document.addEventListener('pointerdown', away); document.addEventListener('focusin', focusAway);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('focusin', focusAway); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="btn secondary dropdown-trigger" aria-haspopup="menu" aria-controls={open ? id : undefined} aria-expanded={open} title={title} onClick={() => setOpen(!open)} onKeyDown={e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); setOpen(true); } }}>
      {icon}<span>{label}</span><ChevronDown size={14} aria-hidden />
    </button>
    {open && createPortal(<div ref={menu} id={id} className="menu choice-popup" role="menu" aria-label={title} style={position} onKeyDown={e => {
      const options = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      let next: number | undefined;
      if (e.key === 'ArrowDown') next = (index + 1) % options.length;
      if (e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = options.length - 1;
      if (next !== undefined) { e.preventDefault(); options[next]?.focus(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      if (e.key === 'Tab') { close(true); }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && e.key !== ' ') {
        const now = Date.now(); search.current = { text: (now - search.current.at > 700 ? '' : search.current.text) + e.key.toLowerCase(), at: now };
        options.find(el => el.textContent?.trim().toLowerCase().startsWith(search.current.text))?.focus();
      }
    }}>
      {items.map(it => <button key={it.id} type="button" role={action?'menuitem':'menuitemradio'} tabIndex={-1} disabled={it.disabled} aria-checked={action?undefined:it.id === value} className={`menu-item ${it.danger?'danger':''}`} onClick={() => { onSelect(it.id); close(true); }}>
        {!action&&<span className="choice-check">{it.id === value && <Check size={15} aria-hidden />}</span>}{it.label}
      </button>)}
    </div>, document.body)}
  </>;
}
