"""Opt-in native RTC observations; send(route, bytes) is an async bool transport.

attach_quality(room, send, reporter_id=None, *, interval=5.0) returns a
QualityCollector or None. Call await collector.close() on job shutdown.
No transport credentials are read or attached by this helper.
"""
import asyncio
import inspect
import json
import logging
import math
import os
import time
import uuid

logger = logging.getLogger(__name__)
ROUTE = '/api/telemetry/diagnostics'
MAX_BYTES = 256 * 1024


def number(obj, field):
    """Respect proto2 presence: absent scalar defaults are not measurements."""
    if obj is None:
        return None
    if hasattr(obj, 'HasField'):
        try:
            if not obj.HasField(field):
                return None
        except ValueError:
            return None
    value = getattr(obj, field, None)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 2**53 - 1:
        return value
    return None


class QualityCollector:
    def __init__(self, room, send, reporter_id=None, *, interval=5.0, capacity=1000, background=True):
        if not math.isfinite(interval) or interval <= 0 or capacity < 1:
            raise ValueError('interval and capacity must be positive')
        self.room, self.send = room, send
        self.reporter_id = reporter_id or 'rtc:' + uuid.uuid4().hex
        self.interval, self.capacity = interval, capacity
        self.queue, self.previous, self.listeners = [], {}, []
        self.pending = None
        self.dropped, self.reconnects = 0, 0
        self.closed, self.closing = False, False
        self.lock, self.close_lock = asyncio.Lock(), asyncio.Lock()
        self.room_sid = None
        self._listen('reconnecting', lambda: self._event('reconnecting'))
        self._listen('reconnected', lambda: self._event('reconnected'))
        self._listen('disconnected', lambda reason=None: self._event('disconnected', reason=reason))
        self._listen('connection_quality_changed', self._quality)
        self.task = asyncio.create_task(self._run()) if background else None

    def _listen(self, name, callback):
        self.room.on(name, callback)
        self.listeners.append((name, callback))

    def _event(self, event, *, participant=None, quality=None, reason=None):
        if event == 'reconnecting':
            self.reconnects += 1
            self.previous.clear()
        participant = participant or self.room.local_participant
        record = self._record(participant.sid, None, 'connection', {'reconnects': self.reconnects}, event)
        if quality is not None:
            record['quality'] = quality
        # Native disconnect enums only; never serialize arbitrary exception text.
        if isinstance(reason, int):
            record['reason'] = 'disconnect:' + str(reason)
        self._enqueue(record)

    def _quality(self, participant, quality):
        if participant is None:
            return
        # livekit.rtc._proto.room_pb2.ConnectionQuality (installed 1.1.3).
        name = {0: 'poor', 1: 'good', 2: 'excellent', 3: 'lost'}.get(quality, 'unknown')
        self._event('sample', participant=participant, quality=name)

    def _record(self, participant_sid, track_sid, direction, metrics, event='sample'):
        return dict(id=uuid.uuid4().hex, at=int(time.time() * 1000), kind='quality',
                    roomSid=self.room_sid, participantSid=participant_sid, trackSid=track_sid,
                    reporterId=self.reporter_id, direction=direction, metrics=metrics, event=event)

    def _enqueue(self, record):
        if self.closed:
            return
        if len(self.queue) >= self.capacity:
            self.dropped += 1
            logger.warning('Quality collection dropped record; total=%s', self.dropped)
            return
        self.queue.append(record)

    async def _sid(self):
        sid = self.room.sid
        if inspect.isawaitable(sid):
            sid = await asyncio.wait_for(sid, 5)
        if not isinstance(sid, str) or not sid.startswith('RM_'):
            raise ValueError('room SID unavailable')
        self.room_sid = sid
        return sid

    def _metrics(self, stat, feedback, key, now, video):
        direction = key[-1]
        data = stat.inbound if direction == 'inbound' else stat.outbound
        received = stat.received if direction == 'inbound' else getattr(feedback, 'received', None)
        byte_count = number(stat.inbound, 'bytes_received') if direction == 'inbound' else number(stat.sent, 'bytes_sent')
        counters = {'bytes': byte_count, 'received': number(received, 'packets_received'),
                    'lost': number(received, 'packets_lost'),
                    'frames': number(data, 'frames_decoded' if direction == 'inbound' else 'frames_sent') if video else None}
        # Feedback has an independent stats identity and may restart independently.
        feedback_id = getattr(getattr(feedback, 'rtc', None), 'id', None)
        previous = self.previous.get(key)
        self.previous[key] = (now, counters, feedback_id)
        metrics = {}
        for field, source in [('packetsReceived', 'received'), ('packetsLost', 'lost')]:
            if counters[source] is not None:
                metrics[field] = counters[source]
        jitter = number(received, 'jitter')
        if jitter is not None:
            metrics['jitterMs'] = jitter * 1000
        rtt = number(getattr(feedback, 'remote_inbound', None), 'round_trip_time')
        if rtt is not None:
            metrics['rttMs'] = rtt * 1000
        fps = number(data, 'frames_per_second') if video else None
        if fps is not None:
            metrics['fps'] = fps
        if previous is None or now <= previous[0]:
            return metrics
        elapsed = now - previous[0]
        old = previous[1]
        delta = {k: value - old[k] for k, value in counters.items()
                 if value is not None and old[k] is not None and value >= old[k]}
        # Any local stream counter reset makes interval rates unknown for this sample.
        reset = any(value is not None and old[k] is not None and value < old[k] for k, value in counters.items())
        if reset:
            return metrics
        if 'bytes' in delta:
            metrics['bitrateBps'] = delta['bytes'] * 8 / elapsed
        if feedback_id == previous[2] and 'lost' in delta and 'received' in delta and delta['lost'] + delta['received'] > 0:
            metrics['packetLossPct'] = 100 * delta['lost'] / (delta['lost'] + delta['received'])
        if video and fps is None and 'frames' in delta:
            metrics['fps'] = delta['frames'] / elapsed
        return metrics

    async def sample(self, *, now=None):
        if self.closed:
            return
        await self._sid()
        participants = [(self.room.local_participant, 'outbound')]
        participants.extend((p, 'inbound') for p in self.room.remote_participants.values())
        active = set()
        for participant, direction in participants:
            for publication in list(participant.track_publications.values()):
                track = publication.track
                if track is None or not participant.sid.startswith('PA_') or not publication.sid.startswith('TR_'):
                    continue
                try:
                    stats = await asyncio.wait_for(track.get_stats(), 3)
                except Exception:
                    # A removed track must not prevent the other observations.
                    continue
                sampled_at = time.monotonic() if now is None else now
                feedback = {s.remote_inbound_rtp.remote_inbound.local_id: s.remote_inbound_rtp
                            for s in stats if s.WhichOneof('stats') == 'remote_inbound_rtp'}
                for item in stats:
                    kind = item.WhichOneof('stats')
                    if kind != direction + '_rtp':
                        continue
                    stat = getattr(item, kind)
                    key = (self.room_sid, participant.sid, publication.sid, track, stat.rtc.id, direction)
                    active.add(key)
                    metrics = self._metrics(stat, feedback.get(stat.rtc.id), key, sampled_at, stat.stream.kind == 'video')
                    record = self._record(participant.sid, publication.sid, direction, metrics)
                    record['statsId'] = stat.rtc.id
                    self._enqueue(record)
        self.previous = {key: value for key, value in self.previous.items() if key in active}

    async def flush(self):
        async with self.lock:
            if not self.queue:
                return True
            if self.pending is None:
                sid = await self._sid()
                records = []
                for record in self.queue[:100]:
                    record = dict(record, roomSid=record['roomSid'] or sid)
                    body = json.dumps({'schemaVersion': 1, 'records': records + [record]}, allow_nan=False, separators=(',', ':')).encode()
                    if len(body) > MAX_BYTES:
                        break
                    records.append(record)
                if not records:
                    self.queue.pop(0)
                    self.dropped += 1
                    return False
                self.pending = (json.dumps({'schemaVersion': 1, 'records': records}, allow_nan=False, separators=(',', ':')).encode(), len(records))
            try:
                sent = await asyncio.wait_for(self.send(ROUTE, self.pending[0]), 7)
            except Exception:
                sent = False
            if not sent:
                return False
            del self.queue[:self.pending[1]]
            self.pending = None
            return True

    async def _run(self):
        while not self.closing:
            try:
                await self.sample()
                await self.flush()
            except Exception:
                logger.warning('Quality sample unavailable')
            if not self.closing:
                await asyncio.sleep(self.interval)

    async def close(self):
        async with self.close_lock:
            if self.closed:
                return not self.queue
            self.closing = True
            if self.task:
                self.task.cancel()
                await asyncio.gather(self.task, return_exceptions=True)
            for name, callback in self.listeners:
                self.room.off(name, callback)
            self.listeners.clear()
            self.closed = True
            self.previous.clear()
            try:
                while self.queue:
                    if not await self.flush():
                        return False
                return True
            except Exception:
                return False


def attach_quality(room, send, reporter_id=None, *, interval=5.0):
    """Enable with AGENT_QUALITY_ENABLED=true; interval is measured in seconds."""
    if os.environ.get('AGENT_QUALITY_ENABLED', '').lower() not in ('true', '1'):
        return None
    return QualityCollector(room, send, reporter_id, interval=interval)
