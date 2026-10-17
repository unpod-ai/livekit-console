import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type DropdownItem = { id: string | number; label: string };

/** Button + menu. Unlike a native <select>, the whole button is the click target and it looks the same everywhere. */
export function Dropdown({ label, icon, items, value, onSelect, title }: { label: ReactNode; icon?: ReactNode; items: DropdownItem[]; value: string | number; onSelect: (id: string | number) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="pos-rel">
      <button type="button" className="btn secondary" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>
        {icon}{label}<ChevronDown size={13} aria-hidden style={{ opacity: 0.7 }} />
      </button>
      {open && (
        <div className="menu" role="menu" style={{ right: 0, left: 'auto', top: 36, minWidth: 190 }}>
          {items.map((it) => (
            <button key={it.id} type="button" role="menuitemradio" aria-checked={it.id === value} className="menu-item" onClick={() => { onSelect(it.id); setOpen(false); }}>
              <span style={{ width: 14, display: 'inline-flex' }}>{it.id === value && <Check size={13} aria-hidden />}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
