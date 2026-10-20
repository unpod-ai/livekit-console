#!/usr/bin/env python3
"""Read-only host diagnostics collector (Python stdlib only).

DIAGNOSTICS_CONTAINERS='{"server":"livekit","sip":"sip","egress":"egress"}'
AGENT_TELEMETRY_TOKEN=... python3 scripts/collect-diagnostics.py
Optional DIAGNOSTICS_METRIC_URLS uses the same service keys and HTTP(S) URLs.
Private atomic state stores projected records and Docker timestamp/offset cursors.
Saturated log chunks resume inclusively; no --tail truncation is used.
"""
import argparse
import datetime
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import re
import selectors
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

logger = logging.getLogger(__name__)
ROUTE = '/api/telemetry/diagnostics'
MAX_BYTES = 256 * 1024
MAX_LINE = 64 * 1024
SERVICES = {'server', 'sip', 'egress'}
SERVICE_METRICS = {'livekit_room_total', 'livekit_participant_total', 'livekit_track_published_total',
                   'livekit_track_subscribed_total', 'livekit_packet_bytes', 'livekit_packet_total',
                   'livekit_sip_calls_active', 'livekit_sip_cpu_load', 'livekit_sip_node_available',
                   'livekit_egress_available', 'livekit_egress_active'}
TIMESTAMP = re.compile(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) (.*)$', re.DOTALL)
PRIVATE = re.compile(r'(?i)(authorization|password|credential|secret|bearer|token|sip:|https?://|@|\b\d{1,3}(?:\.\d{1,3}){3}\b|\+?\d[\d ()-]{6,}\d|[0-9a-f]{0,4}:[0-9a-f:]*:)')


def encode(value):
    return json.dumps(value, allow_nan=False, separators=(',', ':'), sort_keys=True).encode()


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and 0 <= value <= 2**53 - 1


def safe_text(value, maximum=256):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        return None
    if re.search(r'[\x00-\x1f]', value) or PRIVATE.search(value):
        return None
    return value


def safe_identifier(value):
    """Durable private correlation references may contain numeric IDs or @host."""
    if isinstance(value, str) and value and len(value) <= 256 and not re.search(r'\s|[\x00-\x1f\x7f]', value):
        return value
    return None


def timestamp_ms(value):
    # Docker RFC3339Nano: keep all nine digits in the cursor/ID, truncate only at.
    value = re.sub(r'(\.\d{6})\d+', r'\1', value)
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    return int(parsed.timestamp() * 1000)


def project_sip(line, instance_id, ordinal=0):
    match = TIMESTAMP.match(line.rstrip('\n'))
    if not match:
        return None
    timestamp, payload = match.groups()
    zap_message = None
    try:
        at = timestamp_ms(timestamp)
        if payload.startswith('{'):
            fields = json.loads(payload)
        else:
            # LiveKit development zap format ends in a structured JSON object.
            prefix, structured = payload.rsplit('\t', 1)
            fields = json.loads(structured)
            if len(prefix.split('\t')) >= 5:
                zap_message = prefix.rsplit('\t', 1)[-1]
    except (ValueError, TypeError):
        return None
    if not isinstance(fields, dict):
        return None
    call_id = safe_identifier(fields.get('callID'))
    if not call_id:
        return None
    record = dict(id=hashlib.sha256(encode([instance_id, timestamp, ordinal, payload])).hexdigest(),
                  at=at, kind='sip', service='sip', instanceId=instance_id, callId=call_id)
    for source, target in [('sipCallID', 'sipCallId'), ('providerCallID', 'providerCallId'),
                           ('roomID', 'roomSid'), ('room', 'roomName'), ('participantID', 'participantSid'),
                           ('participant', 'participantIdentity'), ('sipTrunk', 'trunkId'), ('sipRule', 'ruleId')]:
        value = (safe_text if target in ('roomName', 'participantIdentity') else safe_identifier)(fields.get(source))
        if value:
            record[target] = value
    if fields.get('direction') in ('inbound', 'outbound'):
        record['direction'] = fields['direction']
    # Outcomes are stages, not an interpretation of a SIP challenge/status code.
    stage = next((safe_text(fields.get(key)) for key in ('setupOutcome', 'stage', 'result') if safe_text(fields.get(key))), None)
    if stage:
        record['stage'] = stage
    message = safe_text(fields.get('msg'), 500) or safe_text(fields.get('message'), 500) or safe_text(zap_message, 500)
    # Keep the separate native result when setupOutcome supplied the stage.
    result = safe_text(fields.get('result'))
    if result and result != stage:
        combined = '; '.join(part for part in (message, 'result: ' + result) if part)
        message = combined if len(combined) <= 500 else message
    if message:
        record['message'] = message
    reason = safe_text(fields.get('reason'), 500) or safe_text(fields.get('reason-cause'), 500) or safe_text(fields.get('error'), 500)
    if reason:
        record['reason'] = reason
    status = fields.get('status')
    if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 699:
        record['code'] = status
    return record


def memory_bytes(value):
    match = re.fullmatch(r'\s*([\d.]+)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)\s*', value)
    if not match:
        return None
    number, unit = match.groups()
    exponent = {'B': 0, 'kB': 1, 'KB': 1, 'MB': 2, 'GB': 3, 'TB': 4, 'KiB': 1, 'MiB': 2, 'GiB': 3, 'TiB': 4}[unit]
    result = float(number) * (1024 if 'iB' in unit else 1000) ** exponent
    return int(result) if finite(result) else None


def project_service(service, instance_id, inspected, stats, at):
    state = inspected.get('State', {})
    running = state.get('Running')
    status = 'running' if running is True else 'stopped' if running is False else 'unknown'
    if running and state.get('Health', {}).get('Status') == 'unhealthy':
        status = 'unhealthy'
    metrics = {}
    try:
        cpu = float(stats.get('CPUPerc', '').rstrip('%'))
        if finite(cpu):
            metrics['cpuPct'] = cpu
    except (ValueError, TypeError):
        pass
    memory = memory_bytes(stats.get('MemUsage', '').split('/', 1)[0])
    if memory is not None:
        metrics['memoryBytes'] = memory
    try:
        pids = int(stats.get('PIDs', ''))
        if finite(pids):
            metrics['pids'] = pids
    except (ValueError, TypeError):
        pass
    return dict(id=uuid.uuid4().hex, at=at, kind='service', service=service, instanceId=instance_id, state=status, metrics=metrics)


def parse_prometheus(text):
    metrics = {}
    for line in text.splitlines():
        match = re.fullmatch(r'([a-zA-Z_:][\w:]*)(?:\{[^\n]*\})?\s+([^\s]+)(?:\s+\d+)?\s*', line)
        if not match or match[1] not in SERVICE_METRICS:
            continue
        try:
            value = float(match[2])
        except ValueError:
            continue
        total = metrics.get(match[1], 0) + value
        if finite(value) and finite(total):
            metrics[match[1]] = total
    return metrics


def batches(records):
    batch = []
    for record in records:
        if len(encode({'schemaVersion': 1, 'records': [record]})) > MAX_BYTES:
            raise ValueError('diagnostic record exceeds wire limit')
        candidate = batch + [record]
        if len(candidate) > 100 or len(encode({'schemaVersion': 1, 'records': candidate})) > MAX_BYTES:
            yield encode({'schemaVersion': 1, 'records': batch})
            batch = []
        batch.append(record)
    if batch:
        yield encode({'schemaVersion': 1, 'records': batch})


class Spool:
    def __init__(self, directory, capacity=5000):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.directory / 'diagnostics.json'
        self.capacity = capacity
        self.records, self.cursors = [], {}
        self.dropped, self.saturated = 0, 0
        self.pending_count = 0
        if self.path.exists():
            if self.path.stat().st_size > 32 * 1024 * 1024:
                raise ValueError('state exceeds 32 MiB limit')
            state = json.loads(self.path.read_bytes())
            self.records, self.cursors = state['records'], state['cursors']
            self.dropped, self.saturated = state['dropped'], state['saturated']
            self.pending_count = state.get('pendingCount', 0)
        self.size = sum(len(encode(record)) for record in self.records)

    def append(self, record):
        size = len(encode(record))
        if len(self.records) >= self.capacity or self.size + size > 16 * 1024 * 1024 or size > MAX_BYTES - 64:
            self.dropped += 1
            logger.warning('Diagnostic spool dropped record; total=%s', self.dropped)
            return False
        self.records.append(record)
        self.size += size
        return True

    def save(self):
        fd, filename = tempfile.mkstemp(prefix='.diagnostics-', dir=self.directory)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(encode(dict(records=self.records, cursors=self.cursors, dropped=self.dropped, saturated=self.saturated, pendingCount=self.pending_count)))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(filename, self.path)
            directory_fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(filename):
                os.unlink(filename)

    def flush(self, send):
        # Freeze the head batch implicitly: appended records never alter its content.
        while self.records:
            if not self.pending_count:
                body = next(batches(self.records))
                self.pending_count = len(json.loads(body)['records'])
                self.save()
            body = encode({'schemaVersion': 1, 'records': self.records[:self.pending_count]})
            if not send(body):
                return False
            count = len(json.loads(body)['records'])
            self.records = self.records[count:]
            self.pending_count = 0
            self.size = sum(len(encode(record)) for record in self.records)
            self.save()
        return True


class CommandStream:
    """Bound each subprocess by wall time, line size, and retained output.

    Docker logs are consumed incrementally. On saturation the caller retains its
    last complete-line cursor; truncated/oversize lines are explicit drops.
    """
    def __init__(self, args, timeout=10):
        self.args, self.timeout = args, timeout
        self.saturated, self.dropped, self.ok = False, 0, False

    def lines(self):
        process = subprocess.Popen(self.args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + self.timeout
        buffer = b''
        discarding = False
        dropped_timestamp = None
        try:
            while time.monotonic() < deadline:
                ready = selector.select(min(0.1, max(0, deadline - time.monotonic())))
                if not ready:
                    continue
                chunk = os.read(process.stdout.fileno(), 8192)
                if not chunk:
                    self.ok = process.wait(timeout=1) == 0
                    if buffer and not discarding:
                        yield buffer.decode('utf-8', errors='replace')
                    return
                for part in chunk.splitlines(keepends=True):
                    if not discarding:
                        buffer += part
                        if len(buffer) > MAX_LINE:
                            self.dropped += 1
                            match = TIMESTAMP.match(buffer[:128].decode('utf-8', errors='replace'))
                            dropped_timestamp = match[1] if match else None
                            discarding, buffer = True, b''
                    if part.endswith(b'\n'):
                        if not discarding:
                            yield buffer.decode('utf-8', errors='replace').rstrip('\n')
                        elif dropped_timestamp:
                            # Advance past a known omitted line, without retaining its payload.
                            yield dropped_timestamp + ' {}'
                        buffer, discarding, dropped_timestamp = b'', False, None
            self.saturated = True
        finally:
            selector.close()
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()


def docker_json(args):
    stream = CommandStream(['docker'] + args)
    output, size = [], 0
    for line in stream.lines():
        size += len(line)
        if size > 1024 * 1024:
            raise ValueError('Docker response exceeds limit')
        output.append(line)
    if not stream.ok or stream.dropped:
        raise ValueError('Docker command unavailable')
    return json.loads('\n'.join(output))


class HostCollector:
    def __init__(self, containers, spool, metric_urls=None, *, interval=15, lookback_seconds=3600):
        self.containers, self.spool = containers, spool
        self.metric_urls, self.interval = metric_urls or {}, interval
        self.lookback_seconds = lookback_seconds

    def ingest_logs(self, instance_id, lines, *, saturated=False):
        previous = self.spool.cursors.get(instance_id, {})
        since = previous.get('timestamp', '')
        offset, seen = previous.get('offset', 0), 0
        timestamp, ordinal = None, 0
        for line in lines:
            match = TIMESTAMP.match(line)
            if not match:
                continue
            current = match[1]
            if current < since:
                continue
            if current == since:
                seen += 1
                if seen <= offset:
                    continue
            if timestamp == current:
                ordinal += 1
            else:
                timestamp, ordinal = current, (seen if current == since else 1)
            record = project_sip(line, instance_id, ordinal)
            if record:
                self.spool.append(record)
            self.spool.cursors[instance_id] = {'timestamp': current, 'offset': ordinal}
        if saturated:
            self.spool.saturated += 1
            logger.warning('SIP logs saturated; resuming cursor; total=%s', self.spool.saturated)
        self.spool.save()

    def poll(self):
        for service, instance_id in self.containers.items():
            inspected, stats = {}, {}
            try:
                inspected = docker_json(['inspect', '--format', '{{json .}}', instance_id])
                stats = docker_json(['stats', '--no-stream', '--format', '{{json .}}', instance_id])
            except (OSError, ValueError, subprocess.SubprocessError):
                logger.warning('Docker snapshot unavailable for %s', service)
            record = project_service(service, instance_id, inspected, stats, int(time.time() * 1000))
            if service in self.metric_urls:
                try:
                    request = urllib.request.Request(self.metric_urls[service], headers={'Accept': 'text/plain'})
                    with urllib.request.urlopen(request, timeout=5) as response:
                        body = response.read(1024 * 1024 + 1)
                    if len(body) > 1024 * 1024:
                        raise ValueError('metrics exceed limit')
                    record['metrics'].update(parse_prometheus(body.decode('utf-8')))
                except (OSError, ValueError, urllib.error.URLError):
                    logger.warning('Metrics unavailable for %s', service)
            self.spool.append(record)
            if service == 'sip':
                cursor = self.spool.cursors.get(instance_id)
                since = cursor['timestamp'] if cursor else str(time.time() - self.lookback_seconds)
                stream = CommandStream(['docker', 'logs', '--timestamps', '--since', since, '--until', str(time.time()), instance_id])
                try:
                    self.ingest_logs(instance_id, stream.lines())
                    if stream.saturated or not stream.ok:
                        self.spool.saturated += 1
                        logger.warning('SIP log read incomplete; cursor retained')
                    self.spool.dropped += stream.dropped
                except (OSError, subprocess.SubprocessError):
                    logger.warning('SIP log read unavailable')
        self.spool.save()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_sender(url, token):
    opener = urllib.request.build_opener(NoRedirect())
    def send(body):
        request = urllib.request.Request(url.rstrip('/') + ROUTE, data=body,
                                         headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST')
        try:
            with opener.open(request, timeout=10) as response:
                return 200 <= response.status < 300
        except (OSError, urllib.error.URLError):
            logger.warning('Diagnostics upload failed; retaining spool')
            return False
    return send


def configuration(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('DIAGNOSTICS_URL', 'http://127.0.0.1:8090'))
    parser.add_argument('--containers', default=os.environ.get('DIAGNOSTICS_CONTAINERS', '{}'))
    parser.add_argument('--metric-urls', default=os.environ.get('DIAGNOSTICS_METRIC_URLS', '{}'))
    parser.add_argument('--interval', type=float, default=os.environ.get('DIAGNOSTICS_INTERVAL', '15'))
    parser.add_argument('--state-dir', default=os.environ.get('DIAGNOSTICS_STATE_DIR', '.diagnostics-state'))
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--log-lookback-seconds', dest='lookback_seconds', type=float, default=os.environ.get('DIAGNOSTICS_LOG_LOOKBACK_SECONDS', '3600'))
    args = parser.parse_args(argv)
    try:
        args.containers = json.loads(args.containers)
        args.metric_urls = json.loads(args.metric_urls)
        if not isinstance(args.containers, dict) or not args.containers or not set(args.containers) <= SERVICES:
            raise ValueError('configure fixed server/sip/egress containers')
        if any(not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,149}', name) for name in args.containers.values()):
            raise ValueError('invalid container name')
        if not isinstance(args.metric_urls, dict) or not set(args.metric_urls) <= args.containers.keys():
            raise ValueError('metric URLs require configured services')
        if not math.isfinite(args.interval) or args.interval <= 0:
            raise ValueError('interval must be positive')
        if not math.isfinite(args.lookback_seconds) or not 0 <= args.lookback_seconds <= 30 * 86400:
            raise ValueError('log lookback must be between 0 and 2592000 seconds')
        if not os.environ.get('AGENT_TELEMETRY_TOKEN'):
            raise ValueError('AGENT_TELEMETRY_TOKEN required')
    except (ValueError, TypeError) as error:
        parser.error(str(error))
    return args


def main(argv=None):
    args = configuration(argv)
    spool = Spool(args.state_dir)
    collector = HostCollector(args.containers, spool, args.metric_urls, interval=args.interval, lookback_seconds=args.lookback_seconds)
    send = http_sender(args.url, os.environ['AGENT_TELEMETRY_TOKEN'])
    while True:
        spool.flush(send)
        collector.poll()
        spool.flush(send)
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    main()
