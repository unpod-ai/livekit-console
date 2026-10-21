import { useState, type FormEvent } from 'react';
import { Waypoints } from 'lucide-react';
import { api } from '../lib/api';
import { ThemeControl } from '../components/ThemeControl';
import { Alert, Field, errText } from '../components/ui';

export function Login() {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
      window.location.assign('/');
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <div className="login-appearance"><ThemeControl /></div>
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: '0 0 18px' }}><span className="brand-mark"><Waypoints size={15} aria-hidden /></span>LiveKit Console</div>
        <h1 style={{ fontSize: 18, marginBottom: 4 }}>Sign in</h1>
        <p className="muted" style={{ margin: '0 0 18px' }}>Manage your self-hosted LiveKit server.</p>
        <Field label="Username"><input className="input" name="username" autoFocus autoComplete="username" required /></Field>
        <Field label="Password"><input className="input" name="password" type="password" autoComplete="current-password" required /></Field>
        {error && <Alert kind="bad">{error}</Alert>}
        <button className="btn" style={{ width: '100%', justifyContent: 'center', height: 36 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
