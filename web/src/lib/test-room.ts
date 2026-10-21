import { useEffect, useRef, useState } from 'react';
import { ParticipantKind, Room, RoomEvent, Track } from 'livekit-client';

export type TestMessage = { id: string; text: string; identity: string; source: 'lk.chat' | 'lk.transcription' | 'native'; at: number; final: boolean; assistant: boolean };
export type RoomAccess = { runId: string; token: string; wsUrl: string };

/** Credentials stay in memory. Cleanup retains the owned room URL even after navigation. */
export function useTestRoom(onFinal: (message: TestMessage) => void) {
  const roomRef = useRef<Room | null>(null);
  const endUrl = useRef<string | null>(null);
  const callback = useRef(onFinal);
  callback.current = onFinal;
  const generation = useRef(0);
  const [connection, setConnection] = useState('disconnected');
  const [messages, setMessages] = useState<TestMessage[]>([]);
  const [participants, setParticipants] = useState<{ identity: string; agent: boolean; state: string }[]>([]);
  const [mic, setMic] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [error, setError] = useState('');
  const recentFinals = useRef(new Map<string, { source: string; at: number }>());
  const finalSegments = useRef(new Set<string>());
  const audio = useRef(new Set<HTMLMediaElement>());
  function detach() { audio.current.forEach(el => el.remove()); audio.current.clear(); }
  function disconnect() { generation.current++; const room = roomRef.current; roomRef.current = null; room?.removeAllListeners(); void room?.disconnect(); detach(); setMic(false); setParticipants([]); setAudioBlocked(false); setConnection('disconnected'); }
  async function end() {
    disconnect();
    const url = endUrl.current;
    if (!url) return;
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error('Room disconnected; owned-room cleanup failed. Retry End test.');
    const result = await res.json();
    if (result.run?.cleanupState !== 'complete') throw new Error('Room disconnected; server cleanup is incomplete. Retry End test.');
    endUrl.current = null;
  }
  useEffect(() => {
    const abandon = () => { const url = endUrl.current; if (url) void fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {}); };
    const pagehide = () => { void roomRef.current?.disconnect(); detach(); abandon(); };
    window.addEventListener('pagehide', pagehide);
    return () => { window.removeEventListener('pagehide', pagehide); generation.current++; roomRef.current?.removeAllListeners(); void roomRef.current?.disconnect(); detach(); abandon(); };
  }, []);
  async function connect(access: RoomAccess, reset: boolean) {
    disconnect();
    const current = generation.current;
    setError(''); setParticipants([]);
    if (reset) { setMessages([]); recentFinals.current.clear(); finalSegments.current.clear(); }
    endUrl.current = `/api/agent-tests/runs/${encodeURIComponent(access.runId)}/end`;
    const room = new Room();
    roomRef.current = room;
    const fresh = () => current === generation.current && roomRef.current === room;
    const update = () => { if (fresh()) setParticipants([...room.remoteParticipants.values()].map(p => ({ identity: p.identity, agent: p.kind === ParticipantKind.AGENT, state: p.attributes['lk.agent.state'] ?? 'Unknown' }))); };
    function receive(message: TestMessage) {
      if (!fresh() || room.state !== 'connected' || !message.text) return;
      if (message.final) {
        const textKey = `${message.identity}:${message.text}`;
        const recent = recentFinals.current.get(textKey);
        if (finalSegments.current.has(message.id) || (recent && recent.source !== message.source && message.at - recent.at < 5000)) return;
        finalSegments.current.add(message.id);
        recentFinals.current.set(textKey, { source: message.source, at: message.at });
        if (finalSegments.current.size > 400) finalSegments.current.delete(finalSegments.current.values().next().value!);
        if (recentFinals.current.size > 400) recentFinals.current.delete(recentFinals.current.keys().next().value!);
      }
      setMessages(previous => [...previous.filter(m => m.id !== message.id), message].slice(-200));
      if (message.final && message.assistant) callback.current(message);
    }
    for (const topic of ['lk.chat', 'lk.transcription'] as const) {
      room.registerTextStreamHandler(topic, async (reader, sender) => {
        try {
          const text = await reader.readAll();
          const participant = room.remoteParticipants.get(sender.identity);
          receive({ id: `${sender.identity}:${reader.info.attributes?.['lk.segment_id'] ?? reader.info.id}`, text: text.slice(0, 16000), identity: sender.identity, source: topic, at: Date.now(), final: reader.info.attributes?.['lk.transcription_final'] !== 'false', assistant: participant?.kind === ParticipantKind.AGENT });
        } catch { if (fresh()) setError('Incoming text stream failed. No complete response was recorded.'); }
      });
    }
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      for (const s of segments) receive({ id: `${participant?.identity}:${s.id}`, text: s.text.slice(0, 16000), identity: participant?.identity ?? 'Unknown participant', source: 'native', at: Date.now(), final: s.final, assistant: !!participant && room.remoteParticipants.get(participant.identity)?.kind === ParticipantKind.AGENT });
    });
    room.on(RoomEvent.ConnectionStateChanged, state => { if (fresh()) { setConnection(state); if (state === 'disconnected') { setMic(false); setParticipants([]); void room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); detach(); } } });
    room.on(RoomEvent.ParticipantConnected, update).on(RoomEvent.ParticipantDisconnected, update).on(RoomEvent.ParticipantAttributesChanged, update);
    room.on(RoomEvent.TrackSubscribed, track => { if (fresh() && track.kind === Track.Kind.Audio) { const el = track.attach(); el.autoplay = true; audio.current.add(el); document.body.appendChild(el); void el.play().catch(() => { if (fresh()) setAudioBlocked(true); }); } });
    room.on(RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(el => { audio.current.delete(el); el.remove(); }); });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (fresh()) setAudioBlocked(!room.canPlaybackAudio); });
    try { setConnection('connecting'); await room.connect(access.wsUrl, access.token); if (!fresh()) { void room.disconnect(); return; } update(); setConnection(String(room.state)); }
    catch (e) { if (fresh()) { setConnection('disconnected'); setError(e instanceof Error ? e.message : 'Connection failed'); } throw e; }
  }
  async function send(text: string) {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') throw new Error('Connect the test room before sending text.');
    const at = Date.now();
    await room.localParticipant.sendText(text, { topic: 'lk.chat' });
    if (roomRef.current !== room) return at;
    setMessages(previous => [...previous, { id: crypto.randomUUID(), text, identity: room.localParticipant.identity, source: 'lk.chat' as const, at, final: true, assistant: false }].slice(-200));
    return at;
  }
  async function toggleMic() { const room = roomRef.current; if (!room || room.state !== 'connected') return; await room.localParticipant.setMicrophoneEnabled(!mic); if (roomRef.current !== room || room.state !== 'connected') { await room.localParticipant.setMicrophoneEnabled(false); return; } setMic(room.localParticipant.isMicrophoneEnabled); }
  async function playAudio() { await roomRef.current?.startAudio(); setAudioBlocked(roomRef.current?.canPlaybackAudio === false); }
  return { connect, disconnect, end, send, toggleMic, playAudio, mic, audioBlocked, messages, participants, connection, error };
}
