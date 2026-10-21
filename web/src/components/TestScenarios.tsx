import { useState } from 'react';
import { api } from '../lib/api';
import { useMutate } from '../lib/hooks';
import { useConfirm } from '../lib/confirm';
import type { Prompt, Scenario } from '../lib/agent-tests';
import { Alert, Panel } from './ui';

export function ScenarioEditor({ scenario, close }: { scenario?: Scenario; close: () => void }) {
  const [name, setName] = useState(scenario?.name ?? '');
  const [prompts, setPrompts] = useState<Prompt[]>(scenario?.prompts.map(p => ({ text: p.text, expectedSubstring: p.expectedSubstring ?? '', timeoutSeconds: p.timeoutSeconds })) ?? [{ text: '', expectedSubstring: '', timeoutSeconds: 30 }]);
  const save = useMutate(() => api(`/agent-tests/scenarios${scenario ? `/${encodeURIComponent(scenario.id)}` : ''}`, { method: scenario ? 'PATCH' : 'POST', body: { name: name.trim(), prompts: prompts.map(p => ({ text: p.text, timeoutSeconds: p.timeoutSeconds, ...(p.expectedSubstring?.trim() ? { expectedSubstring: p.expectedSubstring } : {}) })) } }), { invalidate: [['test-scenarios']], success: 'Scenario saved' });
  const valid = name.trim().length > 0 && name.length <= 120 && prompts.length >= 1 && prompts.length <= 20 && prompts.every(p => p.text.trim().length > 0 && p.text.length <= 4000 && (p.expectedSubstring?.length ?? 0) <= 1000 && Number.isInteger(p.timeoutSeconds) && p.timeoutSeconds >= 10 && p.timeoutSeconds <= 120);
  function update(index: number, value: Partial<Prompt>) { setPrompts(prompts.map((p, i) => i === index ? { ...p, ...value } : p)); }
  return <Panel title={scenario ? `Edit scenario · revision ${scenario.revision}` : 'Create scenario'}><form className="panel-body phase6-form" onSubmit={async e => { e.preventDefault(); if (valid) { await save.mutateAsync().then(close).catch(() => {}); } }}>
    <label>Scenario name<input className="input" maxLength={120} value={name} onChange={e => setName(e.target.value)} required /></label>
    <p>Prompts run in order and require a real assistant response. Response delays are browser-observed. Saving edits creates a new scenario revision.</p>
    {prompts.map((prompt, i) => <fieldset key={i} className="phase6-prompt"><legend>Prompt {i + 1}</legend>
      <label>Prompt text {i + 1}<textarea aria-label={`Prompt text ${i + 1}`} className="textarea" rows={3} maxLength={4000} required value={prompt.text} onChange={e => update(i, { text: e.target.value })} /></label>
      <label>Expected substring {i + 1} (optional)<input className="input" maxLength={1000} value={prompt.expectedSubstring ?? ''} onChange={e => update(i, { expectedSubstring: e.target.value })} /></label>
      <label>Timeout {i + 1} (seconds)<input className="input" type="number" min={10} max={120} step={1} required value={prompt.timeoutSeconds} onChange={e => update(i, { timeoutSeconds: Number(e.target.value) })} /></label>
      <button type="button" className="btn secondary" disabled={prompts.length === 1} onClick={() => setPrompts(prompts.filter((_, n) => n !== i))}>Remove prompt {i + 1}</button>
    </fieldset>)}
    <div className="phase6-actions"><button type="button" className="btn secondary" disabled={prompts.length === 20} onClick={() => setPrompts([...prompts, { text: '', expectedSubstring: '', timeoutSeconds: 30 }])}>Add prompt</button><button className="btn" disabled={!valid || save.isPending}>Save scenario</button><button type="button" className="btn secondary" disabled={save.isPending} onClick={close}>Cancel editing</button></div>
    {save.error && <Alert kind="bad">{save.error.message}</Alert>}
  </form></Panel>;
}

export function ScenarioList({ scenarios, select, edit, selected }: { scenarios: Scenario[]; select: (s: Scenario) => void; edit: (s: Scenario) => void; selected: string }) {
  const confirm = useConfirm();
  const remove = useMutate((id: string) => api(`/agent-tests/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' }), { invalidate: [['test-scenarios']], success: 'Scenario deleted' });
  return <Panel title="Persisted scenarios"><div className="panel-body phase6-cards">{scenarios.length ? scenarios.map(s => <article className="phase6-card" key={s.id}><h3>{s.name}</h3><p>Revision {s.revision} · {s.prompts.length} prompts</p><div className="phase6-actions"><button className="btn secondary" aria-pressed={selected === s.id} onClick={() => select(s)}>{selected === s.id ? 'Selected scenario' : 'Select scenario'}</button><button className="btn secondary" onClick={() => edit(s)}>Edit {s.name}</button><button className="btn secondary" disabled={remove.isPending} onClick={async () => { if (await confirm({ title: 'Delete scenario?', message: 'Existing run snapshots retain their scenario revision.', confirmLabel: 'Delete scenario', danger: true })) remove.mutate(s.id); }}>Delete {s.name}</button></div></article>) : <p>No scenarios saved.</p>}</div></Panel>;
}
