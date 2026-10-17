const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};

const livekitUrl = need('LIVEKIT_URL');

export const config = {
  port: Number(process.env.PORT ?? 8080),
  wsUrl: livekitUrl.replace(/^http/, 'ws'),
  httpUrl: livekitUrl.replace(/^ws/, 'http'),
  apiKey: need('LIVEKIT_API_KEY'),
  apiSecret: need('LIVEKIT_API_SECRET'),
  adminUser: need('ADMIN_USER'),
  adminPassword: need('ADMIN_PASSWORD'),
  sessionSecret: need('SESSION_SECRET'),
  sipUri: process.env.SIP_URI ?? '',
  // Base URLs of agent workers' built-in status servers (the LiveKit Agents framework serves them on :8081).
  workerUrls: (process.env.AGENT_WORKER_URLS ?? '').split(',').map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean),
};
