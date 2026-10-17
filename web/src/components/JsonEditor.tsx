import { useState } from 'react';
import { Alert } from './ui';

export const parseJson = (text: string): { value?: any; error?: string } => {
  try {
    return { value: JSON.parse(text) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
};

export function JsonEditor({ value, onChange, rows = 18 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  const [err, setErr] = useState<string>();
  return (
    <div>
      <textarea
        className="textarea code"
        rows={rows}
        spellCheck={false}
        value={value}
        aria-label="JSON"
        onChange={(e) => {
          onChange(e.target.value);
          setErr(parseJson(e.target.value).error);
        }}
      />
      {err && <Alert kind="bad">{err}</Alert>}
      <div style={{ marginTop: 8 }}>
        <button type="button" className="btn secondary sm" onClick={() => { const p = parseJson(value); if (p.error) setErr(p.error); else onChange(JSON.stringify(p.value, null, 2)); }}>
          Format
        </button>
      </div>
    </div>
  );
}
