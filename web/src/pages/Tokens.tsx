import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useMutate } from '../lib/hooks';
import { Alert, CopyButton, Field, PageHeader, Panel } from '../components/ui';

export function Tokens() {
  const [result, setResult] = useState<{ token: string; wsUrl: string }>();
  const gen = useMutate((b: Record<string, unknown>) => api<{ token: string; wsUrl: string }>('/token', { method: 'POST', body: b }), { success: 'Token generated' });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    gen.mutate({ room: f.get('room'), identity: f.get('identity'), name: f.get('name'), ttlSeconds: Number(f.get('ttl')), canPublish: f.get('canPublish') === 'on', canSubscribe: f.get('canSubscribe') === 'on' }, { onSuccess: setResult });
  };
  return (
    <>
      <PageHeader crumbs={[{ label: 'Tools' }, { label: 'Token generator' }]} title="Token generator" sub="Mint a join token to test a room from any LiveKit client" refresh={false} />
      <Panel title="Join token">
        <form className="panel-body" onSubmit={submit}>
          <div className="grid-3">
            <Field label="Room"><input className="input" name="room" required /></Field>
            <Field label="Identity"><input className="input" name="identity" required /></Field>
            <Field label="Display name"><input className="input" name="name" /></Field>
          </div>
          <div className="grid-3">
            <Field label="TTL (seconds)"><input className="input" name="ttl" type="number" defaultValue={3600} min={60} /></Field>
            <Field label="Publish"><label className="check"><input name="canPublish" type="checkbox" defaultChecked /> Can publish</label></Field>
            <Field label="Subscribe"><label className="check"><input name="canSubscribe" type="checkbox" defaultChecked /> Can subscribe</label></Field>
          </div>
          <button className="btn" disabled={gen.isPending}>Generate token</button>
        </form>
        {result && (
          <div className="panel-body" style={{ borderTop: '1px solid var(--border)' }}>
            <Field label="Server URL"><div className="secret"><span>{result.wsUrl}</span><CopyButton text={result.wsUrl} /></div></Field>
            <Field label="Token"><div className="secret"><span>{result.token}</span><CopyButton text={result.token} /></div></Field>
            <Alert kind="warn">Anyone with this token can join the room until it expires.</Alert>
          </div>
        )}
      </Panel>
    </>
  );
}
