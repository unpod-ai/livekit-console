import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import { selectedProject } from '../lib/project';
import { DataTable } from './DataTable';
import { Alert, Panel } from './ui';

type Membership = { userId: number | string; username: string; role: 'admin' | 'viewer'; transcripts: boolean; recordings: boolean; logs: boolean };
type User = { id: number | string; username: string; role: string };
const empty = { role: 'viewer' as const, transcripts: false, recordings: false, logs: false };
export function ProjectMembers() {
  const path = `/projects/${encodeURIComponent(selectedProject())}/members`;
  const list = useApi<Membership[]>(['project-members'], path, { live: false });
  const users = useApi<User[]>(['users'], '/users', { live: false });
  const [editing, setEditing] = useState<Membership | null>(null);
  const [userId, setUserId] = useState('');
  const confirm = useConfirm();
  const save = useMutate((row: Membership) => api(`${path}/${encodeURIComponent(row.userId)}`, { method: 'PUT', body: { role: row.role, transcripts: row.transcripts, recordings: row.recordings, logs: row.logs } }), { invalidate: [['project-members']], success: 'Project access updated' });
  const remove = useMutate((id: Membership['userId']) => api(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }), { invalidate: [['project-members']], success: 'Project access removed' });
  return <>
    <Alert>Project administrators manage operations. Content permissions are granted separately. Global administrators already have full access to every project.</Alert>
    <Panel title="Project access">
      <DataTable rows={list.data} loading={list.isLoading} error={list.error} rowKey={r => String(r.userId)} cols={[
        { key: 'user', header: 'Member', cell: r => r.username, text: r => r.username },
        { key: 'role', header: 'Project role', cell: r => r.role === 'admin' ? 'Administrator' : 'Viewer' },
        ...(['transcripts', 'recordings', 'logs'] as const).map(key => ({ key, header: { transcripts: 'Transcripts', recordings: 'Recordings', logs: 'Logs' }[key], cell: (r: Membership) => r[key] ? 'Allowed' : 'Not granted' })),
      ]} rowActions={r => <><button className="btn secondary sm" disabled={save.isPending || remove.isPending} onClick={() => setEditing({ ...r })}>Edit access</button><button className="btn danger sm" disabled={remove.isPending} onClick={async () => {
        if (await confirm({ title: 'Remove project access?', message: `${r.username} will lose access to this project on their next request.`, danger: true, confirmLabel: 'Remove access' })) remove.mutate(r.userId);
      }}>Remove</button></>} />
      <div className="panel-body operations-form">
        {users.error && <Alert kind="bad">The user directory could not be loaded.</Alert>}
        <label>Team member<select className="select" aria-label="Team member to grant project access" value={userId} onChange={e => setUserId(e.target.value)}><option value="">Choose a team member</option>{users.data?.filter(u => u.role !== 'admin' && !list.data?.some(m => String(m.userId) === String(u.id))).map(u => <option key={u.id} value={u.id}>{u.username}</option>)}</select></label>
        <button className="btn secondary" disabled={!userId || !list.data || save.isPending} onClick={() => { const user = users.data?.find(u => String(u.id) === userId); if (user) setEditing({ userId: user.id, username: user.username, ...empty }); }}>Grant project access</button>
      </div>
    </Panel>
    {editing && <Panel title={`Access for ${editing.username}`}><form className="panel-body operations-form" onSubmit={e => { e.preventDefault(); save.mutate(editing, { onSuccess: () => { setEditing(null); setUserId(''); } }); }}>
      <label>Project role<select className="select" value={editing.role} onChange={e => setEditing({ ...editing, role: e.target.value as Membership['role'] })}><option value="viewer">Viewer</option><option value="admin">Administrator</option></select></label>
      {(['transcripts', 'recordings', 'logs'] as const).map(key => <label className="check" key={key}><input type="checkbox" checked={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.checked })} />{key === 'transcripts' ? 'Transcripts and agent analytics' : key === 'recordings' ? 'Recording playback' : 'Structured logs'}</label>)}
      {save.error && <Alert kind="bad">{save.error.message}</Alert>}
      <div className="table-tools"><button className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save access'}</button><button type="button" className="btn secondary" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></Panel>}
  </>;
}
