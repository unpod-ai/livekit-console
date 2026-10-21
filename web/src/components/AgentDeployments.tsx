import { useApi } from '../lib/hooks';
import { useMe, can } from '../lib/me';
import { Link } from 'react-router-dom';
import type { DeploymentsData } from '../pages/Deployments';
import { Alert, Panel } from './ui';

export function AgentDeployments({ agentName, aliases = [] }: { agentName: string; aliases?: string[] }) {
  const me = useMe();
  const targets = useApi<DeploymentsData>(['deployments'], '/deployments/targets', { enabled: me.data?.role === 'admin', live: false });
  if (me.data?.role !== 'admin') return null;
  const matching = targets.data?.targets.filter(t => t.agentName === agentName || aliases.includes(t.agentName)) ?? [];
  return <Panel title="Deployment targets"><div className="panel-body phase6-form">
    {targets.error && <Alert kind="bad">Host inventory unavailable: {targets.error.message}</Alert>}
    {matching.length ? matching.map(t => <Link key={t.id} to={`/deployments?target=${encodeURIComponent(t.id)}`}>{t.name} · {t.version ?? 'Unknown version'} · {t.health ?? 'Unknown health'}</Link>) : <p>No host deployment target matched source agent name {agentName}.</p>}
    {can(me.data, 'transcripts') && <Link className="btn secondary" to={`/agent-testing?agentName=${encodeURIComponent(agentName)}`}>Test agent</Link>}
  </div></Panel>;
}
