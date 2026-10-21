import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { can, useMe } from '../lib/me';
import { Link, useSearchParams } from 'react-router-dom';
import { useTestRoom, type TestMessage } from '../lib/test-room';
import type { Comparison, PromptResult, Scenario, TestAccess, TestRun } from '../lib/agent-tests';
import type { DeploymentsData } from './Deployments';
import type { InventoryAgent } from '../components/AgentInventory';
import { ScenarioEditor, ScenarioList } from '../components/TestScenarios';
import { Alert, Badge, KV, PageHeader, Panel } from '../components/ui';

const enc = encodeURIComponent;
function RunSummary({ run }: { run: TestRun }) {
  return <Panel title={`Run ${run.id}`}><div className="panel-body phase6-form">
    <KV items={[[ 'Selected source agent', run.agentName ], ['Run state', run.state], ['Scenario revision', run.scenarioRevision ?? 'Ad hoc'], ['Room SID', run.roomSid ?? 'Not observed'], ['Cleanup', run.cleanupState], ['Requested deployment', run.requestedDeployment ? `${run.requestedDeployment.id} · ${run.requestedDeployment.version ?? 'Unknown version'}` : 'None']]} />
    <Alert kind={run.provenance.state === 'unknown' ? 'warn' : 'info'}>Actual worker provenance (self-reported, not cryptographically verified): {run.provenance.state === 'unknown' ? 'Unverified' : run.provenance.state}. Requested deployment/version is not proof of the worker that answered.</Alert>
    {run.provenance.actualWorkers.map((w, i) => <p key={i}>Native worker: {w.workerId} · Actual application version: {w.version ?? 'Unverified'} · SDK: {w.sdkVersion ?? 'Unknown'}</p>)}
    {run.results.map(r => <article className="phase6-card" key={r.promptIndex}><strong>Prompt {r.promptIndex + 1}</strong> <Badge>{r.status}</Badge> <Badge>{r.outcome ?? 'Not evaluated'}</Badge><p>Sent: {run.scenario?.prompts[r.promptIndex]?.text ?? 'Prompt content unavailable'}</p><p>Expected substring: {run.scenario?.prompts[r.promptIndex]?.expectedSubstring ?? 'None'} · Timeout: {run.scenario?.prompts[r.promptIndex]?.timeoutSeconds ?? 'Unknown'} s</p><p>{r.responseText ?? 'No response retained'}</p><p>Browser-observed delay: {r.responseDelayMs == null ? 'No data' : `${r.responseDelayMs} ms`}</p></article>)}
  </div></Panel>;
}

function TestingWorkspace() {
  const me = useMe();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const agents = useApi<InventoryAgent[]>(['inventory-agents'], '/inventory/agents');
  const deployments = useApi<DeploymentsData>(['deployments'], '/deployments/targets', { live: false });
  const scenarios = useApi<{ rows: Scenario[] }>(['test-scenarios'], '/agent-tests/scenarios', { live: false });
  const runs = useApi<{ rows: TestRun[] }>(['test-runs'], '/agent-tests/runs');
  const [agentName, setAgentName] = useState(params.get('agentName') ?? '');
  const [deploymentId, setDeploymentId] = useState(params.get('deploymentId') ?? '');
  const [scenarioId, setScenarioId] = useState('');
  const [editor, setEditor] = useState<Scenario | 'new' | null>(null);
  const [run, setRun] = useState<TestRun | null>(null);
  const [historyId, setHistoryId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [comparisonIds, setComparisonIds] = useState<[string, string] | null>(null);
  const waiter = useRef<{ sentAt: number; resolve: (message: TestMessage | 'timeout' | 'disconnected' | 'failed') => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const seen = useRef(new Set<string>());
  const mounted = useRef(true);
  const cancel = useRef(false);
  const scenarioFinished = useRef<Promise<void> | null>(null);
  const finishScenario = useRef<(() => void) | null>(null);
  const room = useTestRoom(message => {
    const key = `${message.identity}:${message.id}:${message.text}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    if (waiter.current && message.at >= waiter.current.sentAt) { const pending = waiter.current; waiter.current = null; clearTimeout(pending.timer); pending.resolve(message); }
  });
  function settle(status: 'disconnected' | 'failed') { if (waiter.current) { const pending = waiter.current; waiter.current = null; clearTimeout(pending.timer); pending.resolve(status); } }
  useEffect(() => { if (room.connection === 'disconnected') settle('disconnected'); }, [room.connection]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel.current = true; settle('disconnected'); }; }, []);
  const detail = useApi<{ run: TestRun }>(['test-run', historyId], `/agent-tests/runs/${enc(historyId)}`, { enabled: !!historyId });
  const comparison = useApi<Comparison>(['test-compare', comparisonIds], `/agent-tests/compare?left=${enc(comparisonIds?.[0] ?? '')}&right=${enc(comparisonIds?.[1] ?? '')}`, { enabled: !!comparisonIds && can(me.data, 'logs'), live: false });
  const scenarioRows = scenarios.data?.rows ?? [];
  const selectedScenario = scenarioRows.find(s => s.id === scenarioId);
  const matchingTargets = deployments.data?.targets.filter(t => t.agentName === agentName) ?? [];
  const selectedTarget = matchingTargets.find(t => t.id === deploymentId);
  const active = run?.state === 'active';
  const connected = room.connection === 'connected';
  const terminalRuns = (runs.data?.rows ?? []).filter(r => !['active', 'creating', 'starting', 'ending'].includes(r.state));
  const names = [...new Set([...(agents.data ?? []).flatMap(a => [a.name, ...a.aliases]), ...(deployments.data?.targets.map(t => t.agentName) ?? []), ...(params.get('agentName') ? [params.get('agentName')!] : [])])].filter(Boolean);
  async function safely(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Test action failed'); } finally { if (mounted.current) setBusy(false); } }
  async function refresh() { await qc.invalidateQueries({ queryKey: ['test-runs'] }); await qc.invalidateQueries({ queryKey: ['test-run'] }); }
  async function end() { cancel.current = true; settle('disconnected'); await scenarioFinished.current; await room.end(); if (run) { const saved = await api<{ run: TestRun }>(`/agent-tests/runs/${enc(run.id)}`); setRun(saved.run); } await refresh(); }
  async function start() {
    if (!agentName || (deploymentId && !selectedTarget)) throw new Error('Select a source agent and its matching deployment.');
    const runBase = '/api/agent-tests/runs';
    const access = await api<TestAccess>('/agent-tests/runs', { method: 'POST', body: { agentName, ...(scenarioId ? { scenarioId } : {}), ...(deploymentId ? { deploymentId } : {}) } });
    if (!mounted.current) { void fetch(`${runBase}/${enc(access.run.id)}/end`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {}); return; }
    setRun(access.run); setHistoryId(access.run.id); seen.current.clear(); cancel.current = false;
    try { await room.connect({ runId: access.run.id, token: access.token, wsUrl: access.wsUrl }, true); }
    catch (e) { await room.end().catch(() => {}); const saved = await api<{ run: TestRun }>(`/agent-tests/runs/${enc(access.run.id)}`); if (mounted.current) setRun(saved.run); await refresh(); throw e; }
    await refresh();
  }
  async function runScenario() {
    if (!run?.scenario || !connected || running) return;
    setRunning(true); setError(''); cancel.current = false;
    scenarioFinished.current = new Promise(resolve => { finishScenario.current = resolve; });
    try {
      for (let index = run.results.length; index < run.scenario.prompts.length; index++) {
        if (cancel.current) break;
        const prompt = run.scenario.prompts[index];
        const sentAt = Date.now();
        const response = new Promise<TestMessage | 'timeout' | 'disconnected' | 'failed'>(resolve => { waiter.current = { sentAt, resolve, timer: setTimeout(() => { waiter.current = null; resolve('timeout'); }, prompt.timeoutSeconds * 1000) }; });
        try { await room.send(prompt.text); } catch { settle('failed'); }
        const result = await response;
        const record: PromptResult = typeof result === 'string' ? { promptIndex: index, status: result, sentAt, source: 'lk.chat' } : { promptIndex: index, status: 'received', responseText: result.text, sentAt, receivedAt: result.at, source: result.source === 'native' ? 'transcription' : result.source };
        if (!mounted.current) break;
        const saved = await api<{ run: TestRun }>(`/agent-tests/runs/${enc(run.id)}/results`, { method: 'POST', body: { results: [record] } });
        setRun(saved.run);
        if (record.status !== 'received') break;
      }
      if (mounted.current && !cancel.current) { await room.end(); const saved = await api<{ run: TestRun }>(`/agent-tests/runs/${enc(run.id)}`); setRun(saved.run); await refresh(); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Scenario failed'); }
    finally { finishScenario.current?.(); finishScenario.current = null; scenarioFinished.current = null; if (mounted.current) setRunning(false); }
  }
  return <div className="phase6-page">
    <PageHeader title="Agent testing" sub="Dedicated owned rooms, browser-observed responses, and persisted scenarios" />
    <Alert>Starting a test creates a dedicated room and dispatches the selected source agent. Responses appear only when observed. Prompt association is browser-reported; RTC transcripts do not prove which prompt caused a response. Microphone capture requires Enable microphone.</Alert>
    <Panel title="Test session"><div className="panel-body phase6-form">
      <label>Source agent<select aria-label="Source agent" className="select" value={agentName} disabled={active || busy || running} onChange={e => { setAgentName(e.target.value); setDeploymentId(''); }}><option value="">Select source agent</option>{names.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {agents.error && <Alert kind="bad">Agent inventory unavailable: {agents.error.message}</Alert>}
      <label>Requested deployment snapshot<select aria-label="Requested deployment snapshot" className="select" value={selectedTarget?.id ?? ''} disabled={active || busy || running} onChange={e => setDeploymentId(e.target.value)}><option value="">No requested deployment</option>{matchingTargets.map(t => <option key={t.id} value={t.id}>{t.name} · {t.version ?? 'Unknown version'}</option>)}</select></label>
      {deployments.error && <Alert>Deployment snapshots unavailable. An ad hoc source-agent test remains available.</Alert>}
      <label>Scenario<select aria-label="Scenario" className="select" value={scenarioId} disabled={active || busy || running} onChange={e => setScenarioId(e.target.value)}><option value="">Ad hoc conversation</option>{scenarioRows.map(s => <option key={s.id} value={s.id}>{s.name} · revision {s.revision}</option>)}</select></label>
      <div className="phase6-actions"><button className="btn" disabled={busy || running || active || !agentName || (!!scenarioId && !selectedScenario)} onClick={() => void safely(start)}>Start test</button><button className="btn secondary" disabled={busy || !run || running || !active} onClick={() => void safely(async () => { const access = await api<TestAccess>(`/agent-tests/runs/${enc(run!.id)}/reconnect`, { method: 'POST', body: {} }); if (!mounted.current) return; await room.connect({ runId: run!.id, token: access.token, wsUrl: access.wsUrl }, false); await refresh(); })}>Reconnect</button><button className="btn secondary" disabled={!run || busy} onClick={() => void safely(end)}>End test</button></div>
      <div role="status">Connection: {room.connection} · Selected agent: {run?.agentName ?? (agentName || 'None')}</div>
      {room.participants.length ? room.participants.map(p => <p key={p.identity}>{p.agent ? 'Observed agent participant' : 'Observed participant'}: {p.identity} · Native agent state: {p.state}</p>) : <p>No remote participant observed. A dispatched agent has not yet been observed.</p>}
      <div className="phase6-actions"><button className="btn secondary" disabled={!connected || busy} onClick={() => void safely(room.toggleMic)}>{room.mic ? 'Disable microphone' : 'Enable microphone'}</button>{room.audioBlocked && <button className="btn" onClick={() => void safely(room.playAudio)}>Enable audio playback</button>}<span>Microphone: {room.mic ? 'On' : 'Off'}</span></div>
      {active && run?.scenario && <button className="btn" disabled={!connected || running || busy} onClick={() => void runScenario()}>{running ? 'Running prompts…' : 'Run scenario prompts'}</button>}
      {run?.roomSid && can(me.data, 'logs') && <Link to={`/sessions/${enc(run.roomSid)}?tab=insights`}>Open retained correlated telemetry · {run.roomSid}</Link>}
      {!can(me.data, 'logs') && <p>Logs and transcripts grants are both required for mixed telemetry and comparisons.</p>}
    </div></Panel>
    {(error || room.error) && <Alert kind="bad">{error || room.error}</Alert>}
    <Panel title="Observed conversation"><div className="panel-body phase6-form"><div className="phase6-transcript" aria-live="polite">{room.messages.length ? room.messages.map(m => <article key={m.id}><Badge>{m.assistant ? 'Observed agent' : 'Participant'}</Badge> <span className="muted">{m.identity} · {m.source} · {m.final ? 'Final' : 'Interim'}</span><p>{m.text}</p></article>) : <p>No text observed. Connection or dispatch does not establish an answer.</p>}</div>
      <form className="phase6-form" onSubmit={e => { e.preventDefault(); if (text.trim()) void safely(async () => { await room.send(text.trim()); setText(''); }); }}><label>Message<textarea className="textarea" maxLength={4000} value={text} disabled={running} onChange={e => setText(e.target.value)} /></label><button className="btn" disabled={!connected || busy || running || !text.trim()}>Send text</button></form>
    </div></Panel>
    {run && <RunSummary run={detail.data?.run.id === run.id ? detail.data.run : run} />}
    <div className="phase6-actions"><button className="btn secondary" onClick={() => setEditor('new')}>Create scenario</button></div>
    {scenarios.error && <Alert kind="bad">{scenarios.error.message}</Alert>}
    {editor && <ScenarioEditor key={editor === 'new' ? 'new' : editor.id} scenario={editor === 'new' ? undefined : editor} close={() => setEditor(null)} />}
    <ScenarioList scenarios={scenarioRows} selected={scenarioId} select={s => { if (!active) setScenarioId(s.id); }} edit={setEditor} />
    <Panel title="Retained runs"><div className="panel-body phase6-form"><label>Inspect run<select aria-label="Inspect run" className="select" value={historyId} onChange={e => setHistoryId(e.target.value)}><option value="">Select run</option>{runs.data?.rows.map(r => <option key={r.id} value={r.id}>{r.agentName} · {r.state} · {r.id}</option>)}</select></label>{runs.error && <Alert kind="bad">{runs.error.message}</Alert>}{detail.error && <Alert kind="bad">{detail.error.message}</Alert>}</div></Panel>
    {detail.data && detail.data.run.id !== run?.id && <RunSummary run={detail.data.run} />}
    {can(me.data, 'logs') && <Panel title="Compare completed runs"><div className="panel-body phase6-form">{(['Left', 'Right'] as const).map((label, i) => <label key={label}>{label} run<select aria-label={`${label} run`} className="select" value={i ? right : left} onChange={e => i ? setRight(e.target.value) : setLeft(e.target.value)}><option value="">Select completed run</option>{terminalRuns.map(r => <option key={r.id} value={r.id}>{r.agentName} · {r.id}</option>)}</select></label>)}<button className="btn secondary" disabled={!left || !right || left === right} onClick={() => setComparisonIds([left, right])}>Compare runs</button>{comparison.error && <Alert kind="bad">{comparison.error.message}</Alert>}{comparison.data && <>
      <Alert kind={comparison.data.compatibility.sameScenarioRevision ? 'info' : 'warn'}>{comparison.data.compatibility.expectationsComparable ? 'Same scenario revision: expectations are compatible.' : 'Incompatible or unavailable expectations: revisions differ or expectations were redacted.'} {comparison.data.compatibility.versionRegressionComparable ? 'Server reports comparable version provenance.' : 'Unverified version provenance: this comparison cannot establish a measured version regression.'}</Alert>
      <div className="phase6-cards">{[comparison.data.left, comparison.data.right].map((side, i) => <div key={i}><RunSummary run={side} />{side.telemetry && <><p>Unavailable server metrics: {side.telemetry.missingMetrics.join(', ') || 'None reported missing'}</p>{side.telemetry.metrics.map(m => <p key={m.metric}>{m.metric}: {m.count ? `p50 ${m.p50Ms ?? 'No data'} ms · p95 ${m.p95Ms ?? 'No data'} ms · ${m.count} samples` : 'No data'}</p>)}<p>Model costs: not measured.</p></>}</div>)}</div>
    </>}</div></Panel>}
  </div>;
}

export function AgentTesting() {
  const me = useMe();
  if (me.data?.role !== 'admin' || !can(me.data, 'transcripts')) return <><PageHeader title="Agent testing" /><Alert>Administrator and transcripts access are required for agent tests.</Alert></>;
  return <TestingWorkspace />;
}
