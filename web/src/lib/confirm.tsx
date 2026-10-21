import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Opts = { title: string; message?: string; confirmLabel?: string; danger?: boolean };
const Ctx = createContext<(o: Opts) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(Opts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: Opts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const btn = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    const opener=document.activeElement as HTMLElement|null;
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if(e.key==='Escape'){e.preventDefault();done(false);}
      if(e.key==='Tab'){const buttons=Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus();}}
    };
    window.addEventListener('keydown', onKey);
    return () => {window.removeEventListener('keydown', onKey);if(opener?.getClientRects().length)opener.focus();};
  }, [state]);
  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <>
          <div className="overlay" onClick={() => done(false)} />
          <div ref={dialog} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h3 id="confirm-title">{state.title}</h3>
            {state.message && <p>{state.message}</p>}
            <div className="row">
              <button ref={btn} className="btn secondary" onClick={() => done(false)}>Cancel</button>
              <button className={`btn ${state.danger ? 'solid-danger' : ''}`} onClick={() => done(true)}>{state.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
