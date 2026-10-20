import { Link } from 'react-router-dom';
import { ExternalLink, PlayCircle } from 'lucide-react';
import { baseName, isUrl, type EgressFile } from '../lib/egress';
import { CopyButton } from './ui';

/** One recording: file name, plus copy/open for its location. Local paths can't be opened from a browser. */
export function Recording({ file, sessionSid, egressId, index = 0 }: { file?: EgressFile; sessionSid?: string; egressId?: string; index?: number }) {
  if (!file) return <span className="muted">—</span>;
  const target = file.location || file.name;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span className="mono" title={target}>{baseName(file.name || file.location)}</span>
      <CopyButton text={target} label="Copy recording location" />
      {sessionSid && egressId && /\.(ogg|opus|mp3|wav|mp4|m4a|webm)$/i.test(file.name) && <Link className="btn ghost icon sm" aria-label="Play recording in console" title="Open authorized session playback" to={`/sessions/${encodeURIComponent(sessionSid)}?${new URLSearchParams({tab:'insights',recording:`${egressId}/${index}`})}`} onClick={e=>e.stopPropagation()}><PlayCircle size={14}/></Link>}
      {isUrl(file.location) && (
        <a className="btn ghost icon sm" href={file.location} target="_blank" rel="noopener noreferrer" aria-label="Open recording" title="Open (private buckets will deny access without a signed URL)" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}
