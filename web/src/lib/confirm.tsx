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
  useEffect(() => {
    if (!state) return;
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <Ctx.Provider value={confirm}>
      {children}
      {state && (
        <>
          <div className="overlay" onClick={() => done(false)} />
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h3 id="confirm-title">{state.title}</h3>
            {state.message && <p>{state.message}</p>}
            <div className="row">
              <button className="btn secondary" onClick={() => done(false)}>Cancel</button>
              <button ref={btn} className={`btn ${state.danger ? 'solid-danger' : ''}`} onClick={() => done(true)}>{state.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </>
      )}
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
