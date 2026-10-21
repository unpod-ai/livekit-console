import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from './router';
import { api } from './api';
import { projectHref, isLegacyDefault } from './project';
import { Alert } from '../components/ui';
import { selectedProject, setLegacyDefault, type Project } from './project';
const Projects = createContext<Project[]>([]);
export const useProjects = () => useContext(Projects);
export function ProjectGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  return location.pathname === '/login' ? <>{children}</> : <LoadProjects>{children}</LoadProjects>;
}
function LoadProjects({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ projects?: Project[]; error?: string; login?: boolean }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLegacyDefault(false);
    setState({});
    (async () => {
      const res = await fetch('/api/projects', { credentials: 'same-origin', signal: abort.signal });
      if (res.status === 401) { setState({ login: true }); return; }
      const data = await res.json().catch(() => null);
      if (res.status === 404 || (res.ok && !Array.isArray(data))) {
        if (selectedProject() !== 'default') throw new Error('This project is unavailable. Select another project or contact an administrator.');
        setLegacyDefault(true); setState({ projects: [] }); return;
      }
      if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to these projects.' : 'Projects could not be loaded. Please retry.');
      setState({ projects: data });
    })().catch(e => { if (!abort.signal.aborted) setState({ error: e instanceof Error ? e.message : 'Projects could not be loaded.' }); });
    return () => abort.abort();
  }, [attempt]);
  if (state.login) return <Navigate to="/login" replace />;
  if (state.error) return <div className="page"><Alert kind="bad">{state.error}</Alert><button className="btn secondary" onClick={() => setAttempt(a => a + 1)}>Retry</button><SignOut /></div>;
  if (!state.projects) return <div className="page"><Alert>Loading projects…</Alert></div>;
  const selected = state.projects.find(p => p.id === selectedProject());
  const unavailable = state.projects.length > 0 && !selected;
  // Empty configured lists mean no memberships, not permission to use the legacy API.
  if (unavailable || (!state.projects.length && !selected && !isLegacyDefault())) return <div className="page"><Alert kind="bad">You do not have access to this project.</Alert><ProjectSelector projects={state.projects} /><SignOut /></div>;
  return <Projects.Provider value={state.projects}>{children}</Projects.Provider>;
}
export function ProjectSelector({ projects }: { projects?: Project[] }) {
  const available = useProjects();
  const rows = projects ?? available;
  if (!rows.length) return null;
  return <label className="project-selector">Project<select className="select" aria-label="Project" value={rows.some(p => p.id === selectedProject()) ? selectedProject() : ''} onChange={e => {
    const next = new URL(window.location.href);
    next.search = new URLSearchParams({ project: e.target.value }).toString();
    // A document navigation also terminates pending exports, media and mutations.
    window.location.assign(next.href);
  }}><option disabled value="">Choose a project</option>{rows.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
}

export function SignOut() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <><button className="btn secondary" disabled={busy} onClick={async () => {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); window.location.assign(projectHref('/login')); }
    catch { setError('Sign out could not be completed. Please retry.'); setBusy(false); }
  }}>{busy ? 'Signing out…' : 'Sign out'}</button>{error && <Alert kind="bad">{error}</Alert>}</>;
}
