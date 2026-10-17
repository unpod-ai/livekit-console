import { ExternalLink } from 'lucide-react';
import { baseName, isUrl, type EgressFile } from '../lib/egress';
import { CopyButton } from './ui';

/** One recording: file name, plus copy/open for its location. Local paths can't be opened from a browser. */
export function Recording({ file }: { file?: EgressFile }) {
  if (!file) return <span className="muted">—</span>;
  const target = file.location || file.name;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span className="mono" title={target}>{baseName(file.name || file.location)}</span>
      <CopyButton text={target} label="Copy recording location" />
      {isUrl(file.location) && (
        <a className="btn ghost icon sm" href={file.location} target="_blank" rel="noopener noreferrer" aria-label="Open recording" title="Open (private buckets will deny access without a signed URL)" onClick={(e) => e.stopPropagation()}>
          <ExternalLink size={13} />
        </a>
      )}
    </span>
  );
}
