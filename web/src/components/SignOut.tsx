import { useState } from 'react';
import { api } from '../lib/api';
import { Alert } from './ui';

export function SignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <><button className="btn secondary" disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); window.location.assign('/login'); }
    catch { setError('Sign out could not be completed. Please retry.'); setBusy(false); }
  }}>{busy ? 'Signing out…' : 'Sign out'}</button>{error && <Alert kind="bad">{error}</Alert>}</>;
}
