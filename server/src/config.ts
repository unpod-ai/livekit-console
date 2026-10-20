const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};

const livekitUrl = need('LIVEKIT_URL');
const telemetryToken = process.env.AGENT_TELEMETRY_TOKEN ?? '';
if (telemetryToken && telemetryToken.length < 32) throw new Error('AGENT_TELEMETRY_TOKEN must be at least 32 characters');
const telemetryRetentionDays = Number(process.env.AGENT_TELEMETRY_RETENTION_DAYS ?? 30);
if (!Number.isInteger(telemetryRetentionDays) || telemetryRetentionDays < 1 || telemetryRetentionDays > 365) {
  throw new Error('AGENT_TELEMETRY_RETENTION_DAYS must be an integer between 1 and 365');
}

export const config = {
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
  sipUri: process.env.SIP_URI ?? '',
  // GitHub repo whose clone/view traffic is recorded daily; the token needs push access to read traffic.
  githubRepo: process.env.GITHUB_REPO ?? 'unpod-ai/livekit-console',
  githubToken: process.env.GITHUB_TOKEN ?? '',
  // Base URLs of agent workers' built-in status servers (the LiveKit Agents framework serves them on :8081).
  workerUrls: (process.env.AGENT_WORKER_URLS ?? '').split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean),
};
