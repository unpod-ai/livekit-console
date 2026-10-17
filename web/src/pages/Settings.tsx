import { type Json } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useTab } from '../lib/useTab';
import { fmtBytes, fromMs, relTime } from '../lib/format';
import { Alert, CopyButton, KV, PageHeader, Panel, Tabs } from '../components/ui';

export function Settings() {
  const [tab, setTab] = useTab('general', ['general', 'webhooks', 'keys'] as const);
  const cfg = useApi<{ wsUrl: string }>(['config'], '/config', { live: false });
  const col = useApi<Json>(['collector'], '/history/collector');
  const c = col.data;
  const hook = `${location.origin}/webhook`;
  return (
    <>
      <PageHeader crumbs={[{ label: 'Settings' }]} title="Settings" refresh={false} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'general', label: 'General' }, { id: 'webhooks', label: 'Webhooks & history' }, { id: 'keys', label: 'API keys' }]} />
      {tab === 'general' && (
        <>
          <Panel title="Project"><KV items={[['Console URL', <span className="mono">{location.origin}</span>], ['LiveKit server URL', <span className="mono">{cfg.data?.wsUrl ?? '…'}</span>]]} /></Panel>
          <Panel title="History database"><KV items={[['Sessions', c?.sessions ?? '…'], ['Participants', c?.participants ?? '…'], ['Events', c?.events ?? '…'], ['Egress records', c?.egress ?? '…'], ['First event', c ? fromMs(c.firstEventAt) : '…'], ['Last event', c ? `${fromMs(c.lastEventAt)} (${relTime(c.lastEventAt)})` : '…'], ['Database size', c ? fmtBytes(c.dbBytes) : '…']]} /></Panel>
        </>
      )}
      {tab === 'webhooks' && (
        <>
          <Panel title="Webhook endpoint" actions={<CopyButton text={hook} />}><div className="panel-body"><div className="secret"><span>{hook}</span></div></div></Panel>
          <Alert kind="info">LiveKit must be able to reach the console to deliver webhooks. When both run on the same VM, point it at the local address, for example <span className="mono">http://127.0.0.1:8090/webhook</span>. <span className="mono">./deploy.sh webhook</span> adds this for you.</Alert>
          <Panel title="livekit.yaml"><pre className="mono" style={{ margin: 0, padding: 14 }}>{`webhook:
  api_key: <the key name from your keys: section>
  urls:
    - http://127.0.0.1:8090/webhook`}</pre></Panel>
          <Alert>{c?.events ? `Receiving webhooks: ${c.events.toLocaleString()} events stored, last ${relTime(c.lastEventAt)}.` : 'No webhook events have been received yet.'}</Alert>
        </>
      )}
      {tab === 'keys' && <Alert>API keys for a self-hosted server live in its <span className="mono">livekit.yaml</span> (<span className="mono">keys:</span>) and are not manageable over the API. This console uses one key, set in its own <span className="mono">.env</span>; rotate it by changing both and redeploying.</Alert>}
    </>
  );
}
