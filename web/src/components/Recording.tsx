import { Link } from '../lib/router';
import { PlayCircle } from 'lucide-react';
import { baseName, type EgressFile } from '../lib/egress';
import { can, useMe } from '../lib/me';

/** Recording metadata and authenticated console playback. */
export function Recording({ file, sessionSid, egressId, index = 0 }: { file?: EgressFile; sessionSid?: string; egressId?: string; index?: number }) {
  const allowed = can(useMe().data, 'recordings');
  if (!allowed) return <span className="muted">Recording access required</span>;
  if (!file) return <span className="muted">—</span>;
  const target = file.name || 'Recording';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span className="mono" title={target}>{baseName(file.name || file.location)}</span>
      {sessionSid && egressId && /\.(ogg|opus|mp3|wav|mp4|m4a|webm)$/i.test(file.name) && <Link className="btn ghost icon sm" aria-label="Play recording in console" title="Open authorized session playback" to={`/sessions/${encodeURIComponent(sessionSid)}?${new URLSearchParams({tab:'insights',recording:`${egressId}/${index}`})}`} onClick={e=>e.stopPropagation()}><PlayCircle size={14}/></Link>}
    </span>
  );
}
