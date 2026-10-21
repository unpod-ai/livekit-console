import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Right-side slide-over used for every create/edit form, like the Cloud dashboard. */
export function Drawer({ open, title, subtitle, onClose, children, footer, wide, compact }: { open: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    (ref.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select, textarea') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if(e.key==='Escape'){e.preventDefault();onClose();}
      if(e.key==='Tab'){
        const focusable=Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')??[]).filter(el=>el.getClientRects().length>0);
        const first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div ref={ref} className={`drawer ${wide ? 'wide' : ''} ${compact ? 'compact-dialog' : ''}`}  role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="btn ghost icon sm" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  );
}
