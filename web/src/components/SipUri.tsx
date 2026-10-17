import { useApi } from '../lib/hooks';
import { CopyButton, Kpi } from './ui';

/** The public SIP address carriers should send calls to. A self-hosted server can't infer it, so it's read from SIP_URI. */
export function SipUriKpi() {
  const cfg = useApi<{ sipUri: string | null }>(['config'], '/config', { live: false });
  const uri = cfg.data?.sipUri;
  return (
    <Kpi label="SIP URI" help="Where your carrier sends inbound calls"
      value={uri ? <span className="mono" style={{ fontSize: 14 }}>{uri} <CopyButton text={uri} label="Copy SIP URI" /></span> : <span className="muted" style={{ fontSize: 14 }}>Not configured</span>}
      foot={uri ? undefined : 'Set SIP_URI in the console .env'} />
  );
}

/** `lk-<caller-number>` renders the placeholder as a chip, like the Cloud dashboard. */
export function RoomPattern({ text }: { text: string }) {
  return (
    <span className="mono">
      {text.split(/(<[^>]+>)/).filter(Boolean).map((part, i) => (part.startsWith('<') ? <code key={i} className="chip">{part}</code> : <span key={i}>{part}</span>))}
    </span>
  );
}
