// Test-only SDK boundary used by phase6-browser.mjs. Never imported by production code.
export const ParticipantKind = { AGENT: 4 };
export const Track = { Kind: { Audio: 'audio' } };
export const RoomEvent = Object.fromEntries(['TranscriptionReceived', 'ConnectionStateChanged', 'ParticipantConnected', 'ParticipantDisconnected', 'ParticipantAttributesChanged', 'TrackSubscribed', 'TrackUnsubscribed', 'AudioPlaybackStatusChanged'].map(key => [key, key]));
const browser = window as any;
browser.phase6RTC = { connects: [], sent: [], mic: [], disconnects: 0, audioStarts: 0, mode: 'stream' };
export class Room {
  handlers = new Map<string, Function[]>();
  streams = new Map<string, Function>();
  state = 'disconnected';
  canPlaybackAudio = false;
  remoteParticipants = new Map<string, any>();
  localParticipant = {
    identity: 'console-test-browser', isMicrophoneEnabled: false,
    sendText: async (text: string, opts: any) => {
      browser.phase6RTC.sent.push({ text, ...opts });
      const mode = browser.phase6RTC.mode;
      if (mode === 'timeout') return;
      if (mode === 'failed') throw new Error('Mock send failed');
      if (mode === 'disconnect') { setTimeout(() => { this.state = 'disconnected'; this.emit(RoomEvent.ConnectionStateChanged, this.state); }, 10); return; }
      setTimeout(async () => {
        if (this.state !== 'connected') return;
        const identity = mode === 'echo' ? this.localParticipant.identity : mode === 'unknown' ? 'unknown-sender' : mode === 'user' ? 'actual-user' : 'actual-agent';
        const segment = crypto.randomUUID();
        if (mode === 'native') this.emit(RoomEvent.TranscriptionReceived, [{ id: segment, text: 'hello native answer', final: true }], this.remoteParticipants.get(identity));
        else await this.streams.get('lk.transcription')?.({ info: { id: segment, attributes: { 'lk.segment_id': segment, 'lk.transcription_final': 'true' } }, readAll: async () => mode === 'duplicate' ? (text.includes('again') ? 'hello second answer' : 'hello first answer') : 'hello observed answer' }, { identity });
        if (mode === 'duplicate' && !text.includes('again')) setTimeout(() => this.emit(RoomEvent.TranscriptionReceived, [{ id: crypto.randomUUID(), text: 'hello first answer', final: true }], this.remoteParticipants.get(identity)), 35);
      }, mode === 'duplicate' && text.includes('again') ? 120 : 15);
    },
    setMicrophoneEnabled: async (enabled: boolean) => { browser.phase6RTC.mic.push(enabled); this.localParticipant.isMicrophoneEnabled = enabled; },
  };
  constructor() { browser.phase6Room = this; }
  registerTextStreamHandler(topic: string, handler: Function) { this.streams.set(topic, handler); }
  on(event: string, handler: Function) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); return this; }
  emit(event: string, ...args: any[]) { this.handlers.get(event)?.forEach(fn => fn(...args)); }
  removeAllListeners() { this.handlers.clear(); }
  async connect(wsUrl: string, token: string) {
    browser.phase6RTC.connects.push({ wsUrl, token });
    if (browser.phase6RTC.mode === 'connect-failure') throw new Error('Mock RTC connection failed');
    this.remoteParticipants.set('actual-user', { identity: 'actual-user', kind: 0, attributes: {} });
    this.remoteParticipants.set('actual-agent', { identity: 'actual-agent', kind: ParticipantKind.AGENT, attributes: { 'lk.agent.state': 'listening' } });
    this.state = 'connected'; this.emit(RoomEvent.ConnectionStateChanged, this.state);
    this.emit(RoomEvent.AudioPlaybackStatusChanged);
  }
  async disconnect() { browser.phase6RTC.disconnects++; this.state = 'disconnected'; this.localParticipant.isMicrophoneEnabled = false; }
  async startAudio() { browser.phase6RTC.audioStarts++; this.canPlaybackAudio = true; this.emit(RoomEvent.AudioPlaybackStatusChanged); }
}
