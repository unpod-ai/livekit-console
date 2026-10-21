const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};

const livekitUrl = need('LIVEKIT_URL');
const telemetryToken = process.env.AGENT_TELEMETRY_TOKEN ?? '';
if (telemetryToken && telemetryToken.length < 32) throw new Error('AGENT_TELEMETRY_TOKEN must be at least 32 characters');
const telemetryRetentionDays = Number(process.env.AGENT_TELEMETRY_RETENTION_DAYS ?? 30);
const telemetryRedaction = process.env.AGENT_TELEMETRY_REDACTION ?? 'standard';
if (!['off', 'standard', 'strict'].includes(telemetryRedaction)) throw new Error('Invalid AGENT_TELEMETRY_REDACTION');
const telemetryRedactTerms = (process.env.AGENT_TELEMETRY_REDACT_TERMS ?? '').split(',').map(v => v.trim()).filter(Boolean);
if (telemetryRedactTerms.length > 50 || telemetryRedactTerms.some(v => v.length > 200)) throw new Error('Redaction supports at most 50 terms of 200 characters');
if (!Number.isInteger(telemetryRetentionDays) || telemetryRetentionDays < 1 || telemetryRetentionDays > 365) {
  throw new Error('AGENT_TELEMETRY_RETENTION_DAYS must be an integer between 1 and 365');
}
const recordingPrefix = (process.env.RECORDING_S3_PREFIX ?? '').replace(/\/?$/, '/').replace(/^\/$/, '');
if (recordingPrefix.startsWith('/') || /[\\%\x00-\x1f]/.test(recordingPrefix) || recordingPrefix.split('/').some(p=>p==='.'||p==='..')) throw new Error('RECORDING_S3_PREFIX must be a relative object prefix without encoded paths');
if (process.env.RECORDING_S3_ENDPOINT) {
  const endpoint = new URL(process.env.RECORDING_S3_ENDPOINT);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('RECORDING_S3_ENDPOINT must be a trusted HTTP(S) storage base URL without credentials or query parameters');
}
const recordingDays = Number(process.env.RECORDING_ACCESS_DAYS ?? 30);
if (!Number.isInteger(recordingDays) || recordingDays < 1 || recordingDays > 3650) throw new Error('RECORDING_ACCESS_DAYS must be an integer from 1 to 3650');

const diagnosticsRetentionDays=Number(process.env.DIAGNOSTICS_RETENTION_DAYS??30);
if(!Number.isInteger(diagnosticsRetentionDays)||diagnosticsRetentionDays<1||diagnosticsRetentionDays>365)throw new Error('DIAGNOSTICS_RETENTION_DAYS must be an integer from 1 to 365');

const workerRollupRetentionDays = Number(process.env.WORKER_ROLLUP_RETENTION_DAYS ?? 365);
if (!Number.isInteger(workerRollupRetentionDays) || workerRollupRetentionDays < 14 || workerRollupRetentionDays > 3650) throw new Error('WORKER_ROLLUP_RETENTION_DAYS must be an integer from 14 to 3650');
export type WorkerMetadata = Partial<Record<'instanceKey' | 'image' | 'version' | 'environment' | 'region' | 'host', string>>;
const metadataRaw = process.env.AGENT_WORKER_METADATA ?? '{}';
if (metadataRaw.length > 65536) throw new Error('AGENT_WORKER_METADATA is too large');
const workerMetadata: Record<string, WorkerMetadata> = JSON.parse(metadataRaw);
if (!workerMetadata || typeof workerMetadata !== 'object' || Array.isArray(workerMetadata) || Object.keys(workerMetadata).length > 100) throw new Error('AGENT_WORKER_METADATA must map at most 100 URLs to metadata');
for (const [url, values] of Object.entries(workerMetadata)) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || !values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid worker metadata');
  for (const [key, value] of Object.entries(values)) if (!['instanceKey', 'image', 'version', 'environment', 'region', 'host'].includes(key) || typeof value !== 'string' || value.length > 512 || /[\x00-\x1f]/.test(value)) throw new Error('Invalid worker metadata field');
}

const retention = (key: string, fallback: number | null): number | null => {
  if (process.env[key] === undefined) return fallback;
  const value = Number(process.env[key]);
  if (!Number.isInteger(value) || value < 1 || value > 3650) throw new Error(`${key} must be an integer from 1 to 3650`);
  return value;
};
const recordingAccessKey = process.env.RECORDING_AWS_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? '';
const recordingSecretKey = process.env.RECORDING_AWS_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? '';
if (!!recordingAccessKey !== !!recordingSecretKey) throw new Error('Recording AWS credentials require both access and secret keys');
export const config = {
  liveRetentionDays: retention('AGENT_LIVE_RETENTION_DAYS', telemetryRetentionDays)!,
  logRetentionDays: retention('AGENT_LOG_RETENTION_DAYS', telemetryRetentionDays)!,
  historyRetentionDays: retention('HISTORY_RETENTION_DAYS', null),
  trafficRetentionDays: retention('TRAFFIC_RETENTION_DAYS', null),
  recordingAllowDefaultCredentials: process.env.RECORDING_ALLOW_DEFAULT_CREDENTIALS === 'true',
  recordingCredentials: recordingAccessKey && recordingSecretKey ? { accessKeyId: recordingAccessKey, secretAccessKey: recordingSecretKey, ...(process.env.RECORDING_AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN ? {sessionToken: process.env.RECORDING_AWS_SESSION_TOKEN ?? process.env.AWS_SESSION_TOKEN} : {}) } : undefined,
  workerRollupRetentionDays,
  workerMetadata,
  diagnosticsEnabled:process.env.DIAGNOSTICS_ENABLED==='true',
  diagnosticsRetentionDays,
  port: Number(process.env.PORT ?? 8080),
  wsUrl: livekitUrl.replace(/^http/, 'ws'),
  httpUrl: livekitUrl.replace(/^ws/, 'http'),
  apiKey: need('LIVEKIT_API_KEY'),
  apiSecret: need('LIVEKIT_API_SECRET'),
  adminUser: need('ADMIN_USER'),
  adminPassword: need('ADMIN_PASSWORD'),
  sessionSecret: need('SESSION_SECRET'),
  telemetryToken,
  telemetryRetentionDays,
  agentLogsEnabled: process.env.AGENT_LOGS_ENABLED === 'true',
  telemetryEventsEnabled: process.env.AGENT_TELEMETRY_EVENTS_ENABLED === 'true',
  telemetryRedaction: telemetryRedaction as 'off' | 'standard' | 'strict',
  telemetryRedactTerms,
  recordingStorage: {
    bucket: process.env.RECORDING_S3_BUCKET ?? '',
    prefix: recordingPrefix,
    retentionDays: recordingDays,
  },
  recordingRegion: process.env.RECORDING_S3_REGION ?? 'us-east-1',
  recordingEndpoint: process.env.RECORDING_S3_ENDPOINT || undefined,
  recordingPathStyle: process.env.RECORDING_S3_FORCE_PATH_STYLE === 'true',
  sipUri: process.env.SIP_URI ?? '',
  // GitHub repo whose clone/view traffic is recorded daily; the token needs push access to read traffic.
  githubRepo: process.env.GITHUB_REPO ?? 'unpod-ai/livekit-console',
  githubToken: process.env.GITHUB_TOKEN ?? '',
  // Base URLs of agent workers' built-in status servers (the LiveKit Agents framework serves them on :8081).
  workerUrls: (process.env.AGENT_WORKER_URLS ?? '').split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean),
};
