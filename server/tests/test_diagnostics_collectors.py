import asyncio
import io
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HostTests(unittest.TestCase):
    def setUp(self):
        self.host = load('diagnostics_host', 'scripts/collect-diagnostics.py')

    def test_native_sip_projection_is_stable_and_private(self):
        fields = dict(callID='CA_test', sipCallID='provider-id', direction='inbound',
                      sipTrunk='ST_test', sipRule='SDR_test', room='test', roomID='RM_test',
                      participant='agent', participantID='PA_test', status=486, result='failed',
                      reason='busy', setupOutcome='rejected', **{'reason-cause': 'busy'},
                      headers={'Authorization': 'secret'}, fromNumber='+14155551212', ip='10.0.0.1')
        prefix = '2026-10-21T10:00:00.123456789Z '
        for payload in (json.dumps(fields), '2026-10-21T10:00:00Z\tINFO\tsip\tcall.go:42\tcall ended\t' + json.dumps(fields)):
            record = self.host.project_sip(prefix + payload, 'sip-1')
            self.assertEqual(record['at'], 1792576800123)
            self.assertEqual(record['trunkId'], 'ST_test')
            self.assertEqual(record['participantSid'], 'PA_test')
            self.assertEqual(record['stage'], 'rejected')
            self.assertEqual(record['code'], 486)
            self.assertEqual(record, self.host.project_sip(prefix + payload, 'sip-1'))
            self.assertEqual(len(record['id']), 64)
            self.assertFalse(any(value in json.dumps(record) for value in ('secret', '+14155551212', '10.0.0.1', 'headers')))
        self.assertIsNone(self.host.project_sip(prefix + '{"message":"arbitrary"}', 'sip-1'))
        unsafe = dict(fields, reason='Authorization: Bearer secret at sip:a@10.0.0.1', participant='+14155551212')
        projected = self.host.project_sip(prefix + json.dumps(unsafe), 'sip-1')
        self.assertEqual(projected['reason'], 'busy')
        self.assertNotIn('participantIdentity', projected)

    def test_pre_room_error_and_json_or_zap_messages_are_projected(self):
        fields = dict(callID='CA_attempt', error='no matching rule', setupOutcome='rejected', result='failed')
        timestamp = '2026-10-21T10:00:00Z '
        payloads = [
            json.dumps(dict(fields, msg='dispatch rule lookup failed')),
            json.dumps(dict(fields, message='dispatch rule lookup failed')),
            '2026-10-21T10:00:00Z\tWARN\tsip\tcall.go:42\tdispatch rule lookup failed\t' + json.dumps(fields),
        ]
        for payload in payloads:
            with self.subTest(payload=payload):
                record = self.host.project_sip(timestamp + payload, 'sip-1')
                self.assertEqual(record['reason'], 'no matching rule')
                self.assertEqual(record['message'], 'dispatch rule lookup failed; result: failed')
                self.assertEqual(record['stage'], 'rejected')
                self.assertNotIn('roomSid', record)
        record = self.host.project_sip(timestamp + json.dumps(dict(fields, reason='busy')), 'sip-1')
        self.assertEqual(record['reason'], 'busy')

    def test_sensitive_log_text_is_omitted_and_pre_room_events_stay_neutral(self):
        timestamp = '2026-10-21T10:00:00Z '
        for text in ('Authorization: Bearer private', 'peer 10.0.0.1', 'caller +14155551212', 'x' * 501):
            fields = dict(callID='CA_attempt', msg=text, error=text)
            for payload in (json.dumps(fields), '2026-10-21T10:00:00Z\tWARN\tsip\tcall.go:42\t' + text + '\t' + json.dumps(fields)):
                record = self.host.project_sip(timestamp + payload, 'sip-1')
                self.assertNotIn('message', record)
                self.assertNotIn('reason', record)
        record = self.host.project_sip(timestamp + json.dumps(dict(callID='CA_attempt', msg='call group created')), 'sip-1')
        self.assertEqual(record['message'], 'call group created')
        self.assertNotIn('stage', record)
        self.assertNotIn('code', record)
        self.assertNotIn('reason', record)

    def test_service_snapshot_and_aggregate_allowlist(self):
        inspect = {'State': {'Running': True, 'Health': {'Status': 'unhealthy'}}}
        stats = {'CPUPerc': '125.5%', 'MemUsage': '12.5MiB / 1GiB', 'PIDs': '9'}
        record = self.host.project_service('sip', 'sip-1', inspect, stats, 1000)
        self.assertEqual(record['state'], 'unhealthy')
        self.assertEqual(record['metrics'], {'cpuPct': 125.5, 'memoryBytes': 13107200, 'pids': 9})
        metrics = self.host.parse_prometheus('livekit_packet_total{direction="in"} 3\nlivekit_packet_total{direction="out"} 4\nsecret{token="private"} 12\nlivekit_room_total NaN\nlivekit_sip_cpu_load -1\n')
        self.assertEqual(metrics, {'livekit_packet_total': 7})
        self.assertEqual(self.host.project_service('server', 'missing', {}, {}, 1000)['state'], 'unknown')

    def test_spool_atomic_private_bounded_and_retry_identical(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = self.host.Spool(directory, capacity=2)
            one = {'id': 'a', 'kind': 'sip', 'at': 1000, 'callId': 'CA_a'}
            self.assertTrue(spool.append(one))
            self.assertTrue(spool.append(dict(one, id='b')))
            self.assertFalse(spool.append(dict(one, id='c')))
            spool.cursors['sip-1'] = {'timestamp': '2026-10-21T10:00:00.000000000Z', 'offset': 1}
            spool.save()
            self.assertEqual(stat.S_IMODE(spool.path.stat().st_mode), 0o600)
            restored = self.host.Spool(directory, capacity=2)
            self.assertEqual(restored.dropped, 1)
            self.assertEqual(restored.cursors, spool.cursors)
            bodies = []
            def send(body):
                bodies.append(body)
                return len(bodies) > 1
            self.assertFalse(restored.flush(send))
            self.assertTrue(restored.flush(send))
            self.assertEqual(bodies[0], bodies[1])
            self.assertEqual(json.loads(bodies[0])['schemaVersion'], 1)
            self.assertEqual(self.host.Spool(directory).records, [])

    def test_batches_respect_both_wire_limits(self):
        records = [dict(id=str(i), message='x' * 4000) for i in range(110)]
        batches = list(self.host.batches(records))
        self.assertEqual(sum(len(json.loads(b)['records']) for b in batches), 110)
        for body in batches:
            self.assertLessEqual(len(body), 256 * 1024)
            self.assertLessEqual(len(json.loads(body)['records']), 100)

    def test_cursor_resumes_saturated_chunk_and_duplicate_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = self.host.Spool(directory)
            collector = self.host.HostCollector({'sip': 'sip-1'}, spool)
            lines = ['2026-10-21T10:00:00.000000000Z ' + json.dumps({'callID': 'CA_' + str(i)}) for i in range(3)]
            collector.ingest_logs('sip-1', lines[:2], saturated=True)
            first_ids = [r['id'] for r in spool.records]
            collector.ingest_logs('sip-1', lines, saturated=False)
            self.assertEqual(len(spool.records), 3)
            self.assertEqual([r['id'] for r in spool.records[:2]], first_ids)
            self.assertEqual(spool.saturated, 1)
            self.assertEqual(spool.cursors['sip-1']['offset'], 3)

    def test_failed_partial_batch_stays_frozen_when_new_records_arrive(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = self.host.Spool(directory)
            spool.append({'id': 'first'})
            sent = []
            def reject(body):
                sent.append(body)
                return False
            spool.flush(reject)
            spool.append({'id': 'later'})
            spool.save()
            restored = self.host.Spool(directory)
            restored.flush(reject)
            self.assertEqual(sent[0], sent[1])

    def test_non_response_sip_status_is_omitted_without_inventing_failure(self):
        for code in (0, 6, 407, 486):
            line = '2026-10-21T10:00:00Z ' + json.dumps(dict(callID='CA_test', status=code, result='success', setupOutcome='answered'))
            record = self.host.project_sip(line, 'sip-1')
            self.assertEqual(record['stage'], 'answered')
            self.assertEqual(record['message'], 'result: success')
            self.assertEqual(record.get('code'), code if code >= 100 else None)

    def test_stream_bounds_output_and_reports_oversize_lines(self):
        import sys
        stream = self.host.CommandStream([sys.executable, '-c', "print('x'*70000); print('end')"])
        self.assertEqual(list(stream.lines()), ['end'])
        self.assertEqual(stream.dropped, 1)
        self.assertTrue(stream.ok)

    def test_initial_log_lookback_and_persisted_cursor(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = self.host.Spool(directory)
            commands = []
            host = self.host
            class Stream:
                def __init__(self, args):
                    commands.append(args)
                    self.ok, self.saturated, self.dropped = True, False, 0
                def lines(self):
                    return iter([])
            collector = host.HostCollector({'sip': 'sip-1'}, spool, lookback_seconds=7 * 86400)
            with patch.object(host, 'CommandStream', Stream), patch.object(host, 'docker_json', return_value={}), patch.object(host.time, 'time', return_value=1800000000):
                collector.poll()
                self.assertEqual(commands[-1][commands[-1].index('--since') + 1], str(1800000000 - 7 * 86400))
                spool.cursors['sip-1'] = {'timestamp': '2026-10-21T10:00:00.000000000Z', 'offset': 1}
                collector.poll()
                self.assertEqual(commands[-1][commands[-1].index('--since') + 1], spool.cursors['sip-1']['timestamp'])

    def test_configuration_lookback_validation_and_fixed_instances(self):
        with patch.dict(os.environ, {'AGENT_TELEMETRY_TOKEN': 'private'}, clear=True):
            args = self.host.configuration(['--containers', '{"sip":"sip-1"}'])
            self.assertEqual(args.lookback_seconds, 3600)
            for value in ('-1', '2592001', 'nan'):
                with self.assertRaises(SystemExit), patch('sys.stderr', new_callable=io.StringIO):
                    self.host.configuration(['--containers', '{"sip":"sip-1"}', '--log-lookback-seconds', value])

    def test_oversize_log_advances_cursor_with_explicit_drop(self):
        import sys
        timestamp = '2026-10-21T10:00:00.000000000Z'
        stream = self.host.CommandStream([sys.executable, '-c', "print('" + timestamp + " ' + 'x'*70000)"])
        with tempfile.TemporaryDirectory() as directory:
            spool = self.host.Spool(directory)
            collector = self.host.HostCollector({'sip': 'sip-1'}, spool)
            collector.ingest_logs('sip-1', stream.lines())
            self.assertEqual(spool.cursors['sip-1'], {'timestamp': timestamp, 'offset': 1})
            self.assertEqual(spool.records, [])
            self.assertEqual(stream.dropped, 1)

    def test_http_upload_auth_route_and_redirect_rejection(self):
        class Response:
            status = 202
            def __enter__(self): return self
            def __exit__(self, *args): return None
        requests = []
        def open_request(request, timeout):
            requests.append(request)
            return Response()
        with patch.object(self.host.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = open_request
            send = self.host.http_sender('http://127.0.0.1:8090/', 'private')
            self.assertTrue(send(b'{}'))
            self.assertEqual(requests[0].full_url, 'http://127.0.0.1:8090/api/telemetry/diagnostics')
            self.assertEqual(requests[0].get_header('Authorization'), 'Bearer private')
            self.assertIsNone(build.call_args.args[0].redirect_request(None, None, 302, '', {}, 'http://other/'))
            build.return_value.open.side_effect = OSError('unavailable')
            with self.assertLogs(self.host.logger, level='WARNING') as logs:
                self.assertFalse(send(b'{}'))
            self.assertNotIn('private', str(logs.output))

    def test_durable_sip_ids_preserve_provider_host_and_numeric_references(self):
        fields = dict(callID='123456789012345', sipCallID='token@10.0.0.1', providerCallID='1234567890@provider.example', roomID='RM_1234567890', participantID='PA_1234567890', sipTrunk='ST_1234567890', sipRule='SDR_1234567890')
        record = self.host.project_sip('2026-10-21T10:00:00Z ' + json.dumps(fields), 'sip-1')
        self.assertIsNotNone(record)
        self.assertEqual(record['callId'], fields['callID'])
        self.assertEqual(record['sipCallId'], fields['sipCallID'])
        self.assertEqual(record['providerCallId'], fields['providerCallID'])
        self.assertEqual(record['roomSid'], fields['roomID'])


class FakeRoom:
    def __init__(self, local, remote):
        self.local_participant = local
        self.remote_participants = {remote.sid: remote}
        self.handlers = {}

    @property
    async def sid(self):
        return 'RM_test'

    def on(self, name, callback):
        self.handlers[name] = callback

    def off(self, name, callback):
        self.handlers.pop(name, None)


class FakeTrack:
    def __init__(self, stats):
        self.stats = stats

    async def get_stats(self):
        return self.stats


def inbound(bytes_received=1000, received=100, lost=2, stats_id='in', frames=None):
    data = types.SimpleNamespace(bytes_received=bytes_received)
    if frames is not None:
        data.frames_decoded = frames
    body = types.SimpleNamespace(rtc=types.SimpleNamespace(id=stats_id), stream=types.SimpleNamespace(kind='video' if frames is not None else 'audio'),
                                 received=types.SimpleNamespace(packets_received=received, packets_lost=lost, jitter=0.015), inbound=data)
    return types.SimpleNamespace(WhichOneof=lambda _: 'inbound_rtp', inbound_rtp=body)


class QualityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.helper = load('connection_quality', 'examples/connection_quality.py')
        self.track = FakeTrack([inbound()])
        self.remote = types.SimpleNamespace(sid='PA_remote', track_publications={'TR_exact': types.SimpleNamespace(sid='TR_exact', track=self.track)})
        self.local = types.SimpleNamespace(sid='PA_local', track_publications={})
        self.room = FakeRoom(self.local, self.remote)
        self.sent = []

    async def send(self, path, body):
        self.assertEqual(path, '/api/telemetry/diagnostics')
        self.sent.append(body)
        return True

    async def test_opt_in_and_native_units_deltas_exact_ownership(self):
        with patch.dict(os.environ, {'AGENT_QUALITY_ENABLED': 'false'}):
            self.assertIsNone(self.helper.attach_quality(self.room, self.send))
        collector = self.helper.QualityCollector(self.room, self.send, reporter_id='worker', background=False)
        await collector.sample(now=10)
        await collector.flush()
        first = json.loads(self.sent[-1])['records'][0]
        self.assertEqual((first['roomSid'], first['participantSid'], first['trackSid'], first['direction']), ('RM_test', 'PA_remote', 'TR_exact', 'inbound'))
        self.assertEqual(first['metrics']['jitterMs'], 15)
        self.assertEqual(first['statsId'], 'in')
        self.assertNotIn('bitrateBps', first['metrics'])
        self.assertNotIn('fps', first['metrics'])
        self.track.stats = [inbound(3000, 190, 12)]
        await collector.sample(now=15)
        await collector.flush()
        metrics = json.loads(self.sent[-1])['records'][0]['metrics']
        self.assertEqual(metrics['bitrateBps'], 3200)
        self.assertEqual(metrics['packetLossPct'], 10)
        self.assertEqual(metrics['packetsReceived'], 190)
        self.track.stats = [inbound(10, 1, 0)]
        await collector.sample(now=20)
        await collector.flush()
        metrics = json.loads(self.sent[-1])['records'][0]['metrics']
        self.assertNotIn('bitrateBps', metrics)
        self.assertNotIn('packetLossPct', metrics)
        await collector.close()
        self.assertEqual(self.room.handlers, {})

    async def test_stats_id_change_and_track_replacement_do_not_reuse_counters(self):
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        await collector.sample(now=10)
        self.track.stats = [inbound(9000, 900, 20, stats_id='new')]
        await collector.sample(now=15)
        self.track = FakeTrack([inbound(19000, 1900, 30, stats_id='new')])
        self.remote.track_publications['TR_exact'].track = self.track
        await collector.sample(now=20)
        await collector.flush()
        records = json.loads(self.sent[-1])['records']
        self.assertTrue(all('bitrateBps' not in r['metrics'] for r in records))
        await collector.close()

    async def test_local_outbound_and_correlated_remote_rtt(self):
        out = types.SimpleNamespace(rtc=types.SimpleNamespace(id='out'), stream=types.SimpleNamespace(kind='audio'), sent=types.SimpleNamespace(bytes_sent=1000), outbound=types.SimpleNamespace())
        feedback = types.SimpleNamespace(rtc=types.SimpleNamespace(id='feedback'), received=types.SimpleNamespace(packets_received=90, packets_lost=10, jitter=0.02), remote_inbound=types.SimpleNamespace(local_id='out', round_trip_time=0.12))
        self.local.track_publications['TR_local'] = types.SimpleNamespace(sid='TR_local', track=FakeTrack([
            types.SimpleNamespace(WhichOneof=lambda _: 'outbound_rtp', outbound_rtp=out),
            types.SimpleNamespace(WhichOneof=lambda _: 'remote_inbound_rtp', remote_inbound_rtp=feedback)]))
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        await collector.sample(now=10)
        await collector.flush()
        record = next(r for r in json.loads(self.sent[-1])['records'] if r['trackSid'] == 'TR_local')
        self.assertEqual(record['direction'], 'outbound')
        self.assertEqual(record['participantSid'], 'PA_local')
        self.assertEqual(record['metrics']['rttMs'], 120)
        await collector.close()

    async def test_lifecycle_retry_and_bounded_queue(self):
        bodies = []
        async def fail_once(path, body):
            bodies.append(body)
            return len(bodies) > 1
        collector = self.helper.QualityCollector(self.room, fail_once, capacity=2, background=False)
        self.room.handlers['reconnecting']()
        self.room.handlers['reconnected']()
        self.room.handlers['connection_quality_changed'](self.remote, 2)
        self.assertEqual(collector.dropped, 1)
        self.assertFalse(await collector.flush())
        self.assertTrue(await collector.flush())
        self.assertEqual(bodies[0], bodies[1])
        events = json.loads(bodies[-1])['records']
        self.assertEqual([r['event'] for r in events], ['reconnecting', 'reconnected'])
        self.assertIsNone(events[0]['trackSid'])
        self.assertEqual(events[-1]['metrics']['reconnects'], 1)
        await collector.close()

    async def test_video_fps_from_measured_frame_delta(self):
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        self.track.stats = [inbound(frames=10)]
        await collector.sample(now=10)
        self.track.stats = [inbound(frames=110)]
        await collector.sample(now=15)
        await collector.flush()
        records = json.loads(self.sent[-1])['records']
        self.assertNotIn('fps', records[0]['metrics'])
        self.assertEqual(records[1]['metrics']['fps'], 20)
        await collector.close()

    async def test_protobuf_absence_and_audio_default_fps_are_gaps(self):
        try:
            from livekit.rtc._proto import stats_pb2
        except ImportError:
            self.skipTest('optional native SDK unavailable')
        stat = stats_pb2.RtcStats()
        stat.inbound_rtp.rtc.id = 'native'
        stat.inbound_rtp.stream.kind = 'audio'
        stat.inbound_rtp.inbound.frames_per_second = 0
        self.track.stats = [stat]
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        await collector.sample(now=10)
        await collector.flush()
        self.assertEqual(json.loads(self.sent[-1])['records'][0]['metrics'], {})
        await collector.close()

    async def test_native_quality_enum_is_indicator_only(self):
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        for value in (0, 1, 2, 3):
            self.room.handlers['connection_quality_changed'](self.remote, value)
        await collector.flush()
        records = json.loads(self.sent[-1])['records']
        self.assertEqual([r['quality'] for r in records], ['poor', 'good', 'excellent', 'lost'])
        self.assertTrue(all('packetLossPct' not in r['metrics'] for r in records))
        await collector.close()

    async def test_unknown_participant_quality_is_not_attributed_to_local(self):
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        self.room.handlers['connection_quality_changed'](None, 2)
        await collector.flush()
        self.assertEqual(self.sent, [])
        await collector.close()

    async def test_track_failure_does_not_block_other_tracks_and_close_cancels(self):
        async def unavailable():
            raise RuntimeError('removed track')
        self.remote.track_publications['TR_gone'] = types.SimpleNamespace(sid='TR_gone', track=types.SimpleNamespace(get_stats=unavailable))
        with patch.dict(os.environ, {'AGENT_QUALITY_ENABLED': 'true'}):
            collector = self.helper.attach_quality(self.room, self.send, interval=0.01)
        await asyncio.sleep(0.04)
        self.assertTrue(await asyncio.wait_for(collector.close(), 0.3))
        self.assertTrue(collector.task.done())
        self.assertTrue(self.sent)
        self.assertTrue(all(r['trackSid'] == 'TR_exact' for b in self.sent for r in json.loads(b)['records']))
        self.assertEqual(self.room.handlers, {})

    async def test_loss_and_bandwidth_are_independent_per_stats_series(self):
        collector = self.helper.QualityCollector(self.room, self.send, background=False)
        self.track.stats = [inbound(1000, 100, 0, stats_id='a'), inbound(2000, 100, 0, stats_id='b')]
        await collector.sample(now=10)
        self.track.stats = [inbound(2000, 190, 10, stats_id='a'), inbound(12000, 200, 0, stats_id='b')]
        await collector.sample(now=15)
        await collector.flush()
        records = json.loads(self.sent[-1])['records'][-2:]
        self.assertEqual([r['statsId'] for r in records], ['a', 'b'])
        self.assertEqual([r['metrics']['bitrateBps'] for r in records], [1600, 16000])
        self.assertEqual([r['metrics']['packetLossPct'] for r in records], [10, 0])
        await collector.close()


if __name__ == '__main__':
    unittest.main()
