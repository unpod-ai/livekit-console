#!/usr/bin/env python3
"""Restricted loopback deployment controller. Python standard library only.

Operator JSON lives outside source/build contexts, mode 0600. The server token
is a service credential; the console separately enforces admin/content grants. No
request can supply Docker arguments, paths, ports, or build contexts.
"""
import copy
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
from pathlib import Path
import re
import selectors
import secrets
import stat
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 256 * 1024
ACTIVE = {'queued', 'running'}
BLOCKING = ACTIVE | {'unknown', 'timed_out'}
IDENTIFIER = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$')
ENV_KEY = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
IMAGE_ID = re.compile(r'^sha256:[0-9a-f]{64}$')
LOG_PRIVATE = re.compile(r'(?i)(authorization|bearer|password|secret|token|api[_-]?key|credential|-----BEGIN .*PRIVATE KEY|https?://[^\s/]+:[^\s@]+@)')
logger = logging.getLogger(__name__)


class APIError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def now() -> int:
    return time.time_ns() // 1_000_000


def atomic_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix='.write-', dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def atomic_json(path: Path, value: dict) -> None:
    atomic_bytes(path, json.dumps(value, allow_nan=False, separators=(',', ':')).encode())


def private_file(path: Path) -> None:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600:
        raise ValueError('private files must be regular files with mode 0600')
    if info.st_size > 16 * 1024 * 1024:
        raise ValueError('private file exceeds limit')


def read_env(path: Path) -> dict:
    if not path.exists():
        return {}
    private_file(path)
    result = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not ENV_KEY.fullmatch(key):
            raise ValueError('secret file must contain plain KEY=value lines')
        result[key] = value
    return result


class Docker:
    """Bounded argv execution; subprocess output is never an API error message."""
    def run(self, args: list, timeout: float = 30) -> str:
        process = subprocess.Popen(['docker', *args], stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                   shell=False, close_fds=True)
        output = bytearray()
        truncated = False
        deadline = time.monotonic() + timeout
        selector = selectors.DefaultSelector()
        try:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() >= deadline:
                    raise APIError(503, 'Docker command timed out; reconciliation may be required')
                for key, _ in selector.select(min(.1, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fileobj.fileno(), 16384)
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        # Continue consuming output, retaining only a bounded tail.
                        output.extend(chunk)
                        if len(output) > MAX_BYTES:
                            truncated = True
                            del output[:-MAX_BYTES]
            if process.wait(timeout=max(.01, deadline - time.monotonic())):
                raise APIError(503, 'Docker command failed')
            if truncated:
                # Discard a partial first line, which may contain a secret suffix.
                output = bytearray(b'[output truncated]\n') + output.partition(b'\n')[2]
            return output.decode('utf-8', errors='replace')
        except (subprocess.TimeoutExpired, OSError) as error:
            raise APIError(503, 'Docker unavailable') from error
        finally:
            selector.close()
            if process.poll() is None:
                # Terminate the client only, never a worker process/container.
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
            process.stdout.close()

    def inspect(self, name: str) -> dict | None:
        try:
            return json.loads(self.run(['container', 'inspect', name]))[0]
        except APIError:
            return None

    def image(self, reference: str) -> dict | None:
        try:
            return json.loads(self.run(['image', 'inspect', reference]))[0]
        except APIError:
            return None

    def worker_health(self, port: int, agent: str) -> bool:
        # No redirects: loopback health must not turn into a credential/SSRF proxy.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(f'http://127.0.0.1:{port}/', timeout=2) as response:
                if response.status != 200:
                    return False
                response.read(4096)
            with opener.open(f'http://127.0.0.1:{port}/worker', timeout=2) as response:
                payload = response.read(16385)
                if response.status != 200 or len(payload) > 16384:
                    return False
                worker = json.loads(payload)
                return isinstance(worker, dict) and worker.get('agent_name') == agent
        except (OSError, ValueError, urllib.error.URLError):
            return False

    def build(self, target: dict, tag: str) -> tuple:
        build = target['build']
        with tempfile.TemporaryDirectory(prefix='deployment-build-') as directory:
            iid = Path(directory) / 'image-id'
            logs = self.run(['build', '--iidfile', str(iid), '--tag', tag,
                             '--file', build['dockerfile'], build['context']],
                            timeout=max(1, min(float(build.get('timeout', 600)), 3600)))
            image = iid.read_text().strip()
        if not IMAGE_ID.fullmatch(image):
            raise APIError(503, 'Build did not produce an immutable image')
        lines = logs.splitlines()
        truncated = len(lines) > 200 or '[output truncated]' in lines
        return image, (['[output truncated]'] if truncated else []) + lines[-199:]


class Helper:
    def __init__(self, config: dict, state_dir: Path, docker: Docker | None = None):
        self.config = config
        self.docker = docker or Docker()
        self.directory = Path(state_dir)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        self.state_path = self.directory / 'state.json'
        self.lock = threading.RLock()
        token = config.get('token')
        if not isinstance(token, str) or len(token) < 32:
            raise ValueError('server token must contain at least 32 characters')
        self.targets = config.get('targets', [])
        ids = set()
        for target in self.targets:
            if not IDENTIFIER.fullmatch(target['id']) or target['id'] in ids:
                raise ValueError('invalid target configuration')
            ids.add(target['id'])
            if target.get('managed') and target.get('actionsEnabled'):
                ports = target.get('ports', [])
                if len(ports) != 2 or len(set(ports)) != 2 or any(type(p) is not int or not 1024 <= p <= 65535 for p in ports):
                    raise ValueError('two distinct fixed health ports required')
                if any(not ENV_KEY.fullmatch(key) for key in target.get('allowedSecretKeys', [])):
                    raise ValueError('invalid secret key allowlist')
                for field in ('command', 'entrypoint'):
                    if field in target and (not isinstance(target[field], list) or any(not isinstance(a, str) or '\x00' in a for a in target[field])):
                        raise ValueError('command and entrypoint must be argument arrays')
        if self.state_path.exists():
            private_file(self.state_path)
            self.state = json.loads(self.state_path.read_text())
        else:
            self.state = {'owner': secrets.token_hex(16), 'targets': {}, 'operations': []}
        for operation in self.state['operations']:
            if operation['state'] in ACTIVE:
                operation.update(state='unknown', error='reconcile_required', updatedAt=now())
        self.save()

    def save(self) -> None:
        # Unresolved operations are never evicted; one per target is possible.
        completed = [o for o in self.state['operations'] if o['state'] not in BLOCKING]
        keep = {o['id'] for o in completed[-20:]}
        self.state['operations'] = [o for o in self.state['operations'] if o['state'] in BLOCKING or o['id'] in keep]
        atomic_json(self.state_path, self.state)

    def revision_path(self, key: str, revision: str) -> Path:
        if not IDENTIFIER.fullmatch(revision):
            raise APIError(503, 'Invalid secret revision')
        return self.directory / 'secrets' / hashlib.sha256(key.encode()).hexdigest() / (revision + '.env')

    def write_revision(self, key: str, values: dict) -> str:
        revision = secrets.token_hex(16)
        data = ''.join(f'{k}={v}\n' for k, v in sorted(values.items())).encode()
        atomic_bytes(self.revision_path(key, revision), data)
        return revision

    def record(self, target: dict) -> dict:
        key = target['id']
        if key not in self.state['targets']:
            revision = None
            if target.get('managed') and target.get('actionsEnabled'):
                values = read_env(Path(target['secretsFile'])) if target.get('secretsFile') else {}
                revision = self.write_revision(key, values)
            template = {k: copy.deepcopy(target[k]) for k in ('command', 'entrypoint', 'network', 'containerPort', 'ports') if k in target}
            self.state['targets'][key] = dict(current={'id': target.get('container'), 'imageId': None,
                'secretRevision': revision, 'port': target.get('ports', [None])[0], 'template': template},
                latestSecretRevision=revision, previous=None, pending=None, retained=[], builds=[])
            self.save()
        return self.state['targets'][key]

    def authorized(self, authorization: str) -> None:
        supplied = authorization.removeprefix('Bearer ') if authorization.startswith('Bearer ') else ''
        if not secrets.compare_digest(self.config['token'].encode(), supplied.encode()):
            raise APIError(401, 'Unauthorized')

    def allowed_images(self, target: dict, record: dict) -> list:
        result = []
        for allowed in target.get('allowedImages', []):
            reference = allowed if isinstance(allowed, str) else allowed['reference']
            image = self.docker.image(reference)
            result.append({'reference': reference, 'imageId': image.get('Id') if image else None})
        for build in record['builds']:
            image = self.docker.image(build['imageId'])
            result.append({'reference': build['reference'], 'imageId': image.get('Id') if image else None})
        return result

    def instance(self, snapshot: dict, role: str) -> dict:
        inspected = self.docker.inspect(snapshot['id']) if snapshot.get('id') else None
        state = inspected.get('State', {}) if inspected else {}
        return dict(id=(inspected or {}).get('Id', snapshot.get('id')), image=(inspected or {}).get('Config', {}).get('Image'),
                    imageId=(inspected or {}).get('Image', snapshot.get('imageId')),
                    state=state.get('Status', 'unknown'), health=state.get('Health', {}).get('Status', 'unknown'),
                    role=role, createdAt=(inspected or {}).get('Created'))

    def inventory(self, target: dict) -> dict:
        record = self.record(target)
        current = self.instance(record['current'], 'current')
        instances = [current] if current['id'] else []
        pending = record['pending']
        if pending:
            if instances and pending.get('signalAttempted'):
                instances[0]['role'] = 'draining'
            if not pending['drainOnly']:
                instances.append(self.instance(pending['candidate'], 'candidate'))
        instances.extend(self.instance(s, 'retained') for s in record['retained'][-10:])
        image = self.docker.image(current['imageId']) if current.get('imageId') else None
        result = {k: target.get(k) for k in ('id', 'name', 'agentName', 'environment', 'host', 'region')}
        result.update(image=current['image'], imageId=current['imageId'],
                      version=((image or {}).get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision'),
                      replicas=sum(i['state'] == 'running' for i in instances), state=current['state'], health=current['health'],
                      observedAt=now(), managed=target.get('managed', False), actionsEnabled=bool(target.get('managed') and target.get('actionsEnabled')),
                      instances=instances, secretRevision=record['current']['secretRevision'] if target.get('managed') else None,
                      allowedImages=self.allowed_images(target, record), registration='unknown')
        return result

    def writable(self, target: dict, reconcile: bool = False) -> None:
        if not target.get('managed') or not target.get('actionsEnabled'):
            raise APIError(409, 'Target is read-only')
        if any(o['targetId'] == target['id'] and o['state'] in (ACTIVE if reconcile else BLOCKING) for o in self.state['operations']):
            raise APIError(409, 'Target has an unresolved operation')

    def secret_metadata(self, target: dict) -> dict:
        record = self.record(target)
        revision = record['latestSecretRevision'] if target.get('managed') else None
        path = self.revision_path(target['id'], revision) if revision else Path(target['secretsFile']) if target.get('secretsFile') else None
        values = read_env(path) if path else {}
        return dict(revision=revision, keys=sorted(values), allowedKeys=target.get('allowedSecretKeys', []))

    def redacted_lines(self, target: dict, lines: list) -> list:
        values = [self.config['token']]
        if target.get('secretsFile'):
            values.extend(read_env(Path(target['secretsFile'])).values())
        directory = self.directory / 'secrets' / hashlib.sha256(target['id'].encode()).hexdigest()
        if directory.exists():
            for path in directory.glob('*.env'):
                values.extend(read_env(path).values())
        # Inspect credentials only for redaction, never for secret-key metadata.
        record = self.record(target)
        snapshots = [record['current'], *record['retained']]
        if record['pending'] and not record['pending']['drainOnly']:
            snapshots.append(record['pending']['candidate'])
        for snapshot in snapshots:
            inspected = self.docker.inspect(snapshot['id']) if snapshot.get('id') else None
            if snapshot.get('id') and not inspected:
                # Fail closed: unknown runtime credentials cannot be safely redacted.
                raise APIError(503, 'Runtime redaction metadata unavailable')
            for entry in (inspected or {}).get('Config', {}).get('Env', []) or []:
                key, separator, value = entry.partition('=')
                if separator and LOG_PRIVATE.search(key):
                    values.append(value)
        result = []
        used_bytes = 0
        for line in lines:
            used_bytes += len(line.encode('utf-8', errors='replace')) + 4
            if used_bytes > MAX_BYTES // 4:
                result.append('[output truncated]')
                break
            if LOG_PRIVATE.search(line):
                result.append('[redacted]')
                continue
            for value in sorted(set(values), key=len, reverse=True):
                if value:
                    line = line.replace(value, '[redacted]')
            result.append(re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', line)[:2048])
        return result

    @staticmethod
    def public_operation(operation: dict) -> dict:
        return {k: copy.deepcopy(v) for k, v in operation.items() if k not in ('requestId', 'fingerprint', 'logs')}

    def request(self, method: str, path: str, authorization: str, body: dict | None) -> tuple:
        try:
            with self.lock:
                parsed = urllib.parse.urlsplit(path)
                parts = parsed.path.split('/')
                if len(parts) < 2 or parts[1] != 'targets':
                    raise APIError(404, 'Not found')
                self.authorized(authorization)
                if len(parts) == 2 and method == 'GET':
                    return 200, dict(configured=True, targets=[self.inventory(t) for t in self.targets],
                                     operations=[self.public_operation(o) for o in self.state['operations']])
                if len(parts) != 4:
                    raise APIError(404, 'Not found')
                target = next((t for t in self.targets if t['id'] == parts[2]), None)
                if target is None:
                    raise APIError(404, 'Target not found')
                endpoint = parts[3]
                if method in ('POST', 'PUT'):
                    if not isinstance(body, dict):
                        raise APIError(400, 'JSON object required')
                    if not target.get('managed') or not target.get('actionsEnabled'):
                        raise APIError(409, 'Target is read-only')
                    if body.get('confirm') != target['id']:
                        raise APIError(400, 'Target confirmation required')
                record = self.record(target)
                if endpoint == 'secrets' and method == 'GET':
                    return 200, self.secret_metadata(target)
                if endpoint == 'secrets' and method == 'PUT':
                    self.writable(target)
                    values = body.get('values')
                    if set(body) != {'values', 'confirm'} or not isinstance(values, dict) or not values or len(values) > 100:
                        raise APIError(400, 'Invalid secret update')
                    for key, value in values.items():
                        if key not in target.get('allowedSecretKeys', []) or not isinstance(value, str) or len(value) > 16384 or re.search(r'[\x00-\x1f\x7f]', value):
                            raise APIError(400, 'Secret key or value is not allowed')
                    selected = read_env(self.revision_path(target['id'], record['latestSecretRevision']))
                    selected.update(values)
                    record['latestSecretRevision'] = self.write_revision(target['id'], selected)
                    self.save()
                    return 200, self.secret_metadata(target)
                if endpoint == 'logs' and method == 'GET':
                    query = urllib.parse.parse_qs(parsed.query)
                    kind = query.get('kind', ['runtime'])[0]
                    try:
                        count = int(query.get('lines', ['100'])[0])
                    except ValueError:
                        raise APIError(400, 'Invalid line count') from None
                    if kind not in ('runtime', 'build') or not 1 <= count <= 500:
                        raise APIError(400, 'Invalid log query')
                    if kind == 'runtime':
                        name = record['current']['id']
                        lines = self.docker.run(['logs', '--tail', str(count + 1), name]).splitlines() if name else []
                    else:
                        builds = [o for o in self.state['operations'] if o['targetId'] == target['id'] and o['action'] == 'build']
                        lines = builds[-1].get('logs', []) if builds else []
                    safe_lines = self.redacted_lines(target, lines[-count:])
                    return 200, dict(lines=safe_lines, truncated=len(lines) > count or '[output truncated]' in lines or '[output truncated]' in safe_lines or any(len(line) > 2048 for line in lines))
                if endpoint == 'actions' and method == 'POST':
                    return self.submit(target, body)
                raise APIError(404, 'Not found')
        except APIError as error:
            return error.status, {'error': str(error)}
        except (OSError, ValueError, KeyError, TypeError):
            return 503, {'error': 'Deployment helper unavailable'}

    def submit(self, target: dict, body: dict) -> tuple:
        action = body.get('action')
        request_id = body.get('requestId')
        if set(body) - {'action', 'image', 'confirm', 'requestId'} or action not in ('build', 'deploy', 'drain', 'rollback', 'reconcile') or not isinstance(request_id, str) or not IDENTIFIER.fullmatch(request_id):
            raise APIError(400, 'Invalid action request')
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        previous = next((o for o in self.state['operations'] if o['targetId'] == target['id'] and o['requestId'] == request_id), None)
        if previous:
            if previous['fingerprint'] != fingerprint:
                raise APIError(409, 'Idempotency key already used for another request')
            return 202, self.public_operation(previous)
        self.writable(target, reconcile=action == 'reconcile')
        record = self.record(target)
        image = body.get('image')
        if action == 'deploy':
            allowed = {entry['imageId'] for entry in self.allowed_images(target, record)} - {None}
            if not isinstance(image, str) or not IMAGE_ID.fullmatch(image) or image not in allowed or not self.docker.image(image):
                raise APIError(400, 'Select an allowed immutable image ID')
        elif image is not None:
            raise APIError(400, 'Image is only accepted for deploy')
        if action == 'build' and not target.get('build'):
            raise APIError(409, 'Build is not configured')
        if action == 'rollback' and not (record['previous'] and record['previous'].get('imageId')):
            raise APIError(409, 'No successful rollback snapshot')
        operation = dict(id=secrets.token_hex(16), targetId=target['id'], requestId=request_id,
                         fingerprint=fingerprint, action=action, state='queued', startedAt=now(), updatedAt=now(), steps=[])
        self.state['operations'].append(operation)
        self.save()
        threading.Thread(target=self.execute, args=(target, operation, image), daemon=True).start()
        return 202, self.public_operation(operation)

    def progress(self, operation: dict, state: str, message: str) -> None:
        with self.lock:
            operation.update(state=state, updatedAt=now())
            operation['steps'] = (operation['steps'] + [dict(at=now(), state=state, message=message)])[-32:]
            self.save()

    def wait_health(self, target: dict, candidate: dict) -> bool:
        deadline = time.monotonic() + min(float(target.get('healthTimeout', 60)), 300)
        while time.monotonic() < deadline:
            inspected = self.docker.inspect(candidate['id'])
            state = (inspected or {}).get('State', {})
            if inspected and inspected.get('Image') != candidate['imageId']:
                return False
            if state.get('Running') and state.get('Health', {}).get('Status') != 'unhealthy' and self.docker.worker_health(candidate['port'], target['agentName']):
                return True
            time.sleep(max(.005, min(float(target.get('pollInterval', 1)), 5)))
        return False

    def drain(self, target: dict, operation: dict, record: dict) -> bool:
        pending = record['pending']
        old = record['current']['id']
        inspected = self.docker.inspect(old) if old else None
        if old and inspected is None:
            raise APIError(503, 'Current worker state unavailable; reconcile required')
        if inspected and inspected.get('State', {}).get('Running') and not pending.get('signalAttempted'):
            self.docker.run(['update', '--restart=no', old])
            with self.lock:
                # Persist intention before issuing the signal: restart never replays it.
                pending['signalAttempted'] = True
                self.save()
            self.docker.run(['kill', '--signal', 'SIGTERM', old])
        self.progress(operation, 'running', 'Observing graceful drain; no forced deadline termination')
        deadline = time.monotonic() + min(float(target.get('drainTimeout', 300)), 3600)
        while time.monotonic() < deadline:
            inspected = self.docker.inspect(old) if old else {'State': {'Running': False}}
            if inspected and inspected.get('State', {}).get('Running') is False:
                return True
            time.sleep(max(.005, min(float(target.get('pollInterval', 1)), 5)))
        return False

    def execute(self, target: dict, operation: dict, image: str | None) -> None:
        try:
            self.progress(operation, 'running', 'Operation started')
            record = self.record(target)
            action = operation['action']
            if action == 'build':
                prefix = target['build'].get('imageTagPrefix', target['build'].get('tagPrefix'))
                if not prefix or not re.fullmatch(r'[a-zA-Z0-9_./:-]+', prefix):
                    raise APIError(503, 'Build image prefix is not configured')
                tag = prefix + ':' + operation['id']
                built, logs = self.docker.build(target, tag)
                if not self.docker.image(built):
                    raise APIError(503, 'Built image unavailable')
                with self.lock:
                    record['builds'] = (record['builds'] + [{'reference': tag, 'imageId': built}])[-20:]
                    operation['logs'] = self.redacted_lines(target, logs[-200:])
                    self.save()
                self.progress(operation, 'succeeded', 'Immutable image built')
                return
            if action == 'reconcile':
                if not record['pending']:
                    # No command was recorded far enough to resume safely.
                    unresolved = [o for o in self.state['operations'] if o is not operation and o['targetId'] == target['id'] and o['state'] in BLOCKING]
                    if unresolved:
                        raise APIError(503, 'No rollout snapshot; operator reconciliation required')
                    self.progress(operation, 'succeeded', 'Actual inventory observed; no pending rollout')
                    return
            else:
                with self.lock:
                    current = record['current']
                    inspected = self.docker.inspect(current['id']) if current['id'] else None
                    if current['id'] and not inspected:
                        raise APIError(503, 'Current worker state unavailable')
                    if inspected:
                        current['imageId'] = inspected['Image']
                    if action == 'rollback':
                        candidate = copy.deepcopy(record['previous'])
                        if not self.docker.image(candidate['imageId']):
                            raise APIError(503, 'Rollback image unavailable')
                    else:
                        candidate = copy.deepcopy(current)
                        candidate.update(imageId=image, secretRevision=record['latestSecretRevision'])
                    candidate.update(id='dh-' + operation['id'], port=next(p for p in target['ports'] if p != current['port']))
                    record['pending'] = dict(candidate=candidate, signalAttempted=False, drainOnly=action == 'drain', created=False, started=False)
                    self.save()
            pending = record['pending']
            candidate = pending['candidate']
            if not pending['drainOnly']:
                template = candidate['template']
                inspected = self.docker.inspect(candidate['id'])
                if not inspected:
                    if action == 'reconcile':
                        raise APIError(503, 'Candidate absent; operator reconciliation required')
                    args = ['create', '--name', candidate['id'], '--restart', 'unless-stopped',
                            '--label', 'deployment-helper.owner=' + self.state['owner'], '--label', 'deployment-helper.target=' + target['id'],
                            '--label', 'deployment-helper.operation=' + operation['id'],
                            '--publish', f"127.0.0.1:{candidate['port']}:{template.get('containerPort', 8081)}"]
                    if template.get('network'):
                        args += ['--network', template['network']]
                    if candidate['secretRevision']:
                        path = self.revision_path(target['id'], candidate['secretRevision'])
                        private_file(path)
                        args += ['--env-file', str(path)]
                    entrypoint = template.get('entrypoint', [])
                    if entrypoint:
                        args += ['--entrypoint', entrypoint[0]]
                    args += [candidate['imageId'], *entrypoint[1:], *template.get('command', [])]
                    self.docker.run(args)
                    with self.lock:
                        pending['created'] = True
                        self.save()
                if not pending['started']:
                    if action == 'reconcile' and not (inspected or {}).get('State', {}).get('Running'):
                        raise APIError(503, 'Candidate not running; operator reconciliation required')
                    if action != 'reconcile':
                        self.docker.run(['start', candidate['id']])
                    with self.lock:
                        pending['started'] = True
                        self.save()
                self.progress(operation, 'running', 'Checking candidate health and matching agent_name; registration unknown')
                if not self.wait_health(target, candidate):
                    if not pending['signalAttempted'] and action != 'reconcile':
                        # Candidate may be alive: retain it and request graceful exit.
                        self.docker.run(['update', '--restart=no', candidate['id']])
                        self.docker.run(['kill', '--signal', 'SIGTERM', candidate['id']])
                        with self.lock:
                            record['retained'] = (record['retained'] + [candidate])[-20:]
                            record['pending'] = None
                            self.save()
                    raise APIError(503, 'Candidate health or agent_name check failed')
            if not self.drain(target, operation, record):
                self.progress(operation, 'timed_out', 'Drain timed out; worker retained, explicit reconcile required')
                return
            if not pending['drainOnly'] and not self.wait_health(target, candidate):
                raise APIError(503, 'Candidate became unhealthy during drain; reconcile required')
            with self.lock:
                if not pending['drainOnly']:
                    record['previous'] = copy.deepcopy(record['current'])
                    record['retained'] = (record['retained'] + [copy.deepcopy(record['current'])])[-20:]
                    record['current'] = copy.deepcopy(candidate)
                record['pending'] = None
                for prior in self.state['operations']:
                    if prior is not operation and prior['targetId'] == target['id'] and prior['state'] in {'unknown', 'timed_out'}:
                        prior.update(state='failed', error='reconciled', updatedAt=now())
                self.save()
            self.progress(operation, 'succeeded', 'Graceful drain complete' if pending['drainOnly'] else 'Health-checked candidate promoted; registration unknown')
        except (APIError, OSError, ValueError, KeyError, TypeError) as error:
            with self.lock:
                pending = self.record(target)['pending']
                uncertain = pending is not None or (isinstance(error, APIError) and 'timed out' in str(error))
                operation['error'] = 'reconcile_required' if uncertain else 'Operation failed; inspect safe inventory/logs'
            self.progress(operation, 'unknown' if uncertain else 'failed', operation['error'])


def make_server(helper: Helper, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:
            # Never log paths, headers, values, or request bodies.
            return

        def handle_request(self) -> None:
            self.connection.settimeout(5)
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 <= length <= MAX_BYTES or self.headers.get('Transfer-Encoding'):
                    raise APIError(400, 'Invalid request size')
                body = json.loads(self.rfile.read(length)) if length else None
                status, payload = helper.request(self.command, self.path, self.headers.get('Authorization', ''), body)
            except (ValueError, UnicodeError, OSError, APIError):
                status, payload = 400, {'error': 'Invalid request'}
            data = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except OSError:
                pass

        do_GET = handle_request
        do_POST = handle_request
        do_PUT = handle_request

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


def main() -> None:
    config_path = Path(os.environ.get('DEPLOYMENT_CONFIG', '/etc/livekit-deployment-helper/config.json')).resolve()
    state_dir = Path(os.environ.get('DEPLOYMENT_STATE_DIR', '/var/lib/livekit-deployment-helper')).resolve()
    source = Path(__file__).resolve().parents[1]
    if config_path.is_relative_to(source) or state_dir.is_relative_to(source):
        raise ValueError('config and state must be outside source deployment tree')
    private_file(config_path)
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Exactly one controller may own this state directory, across helper processes.
    with open(state_dir / 'controller.lock', 'a', encoding='utf-8') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        helper = Helper(json.loads(config_path.read_text()), state_dir)
        for target in helper.targets:
            for path in [target.get('secretsFile')]:
                if path and Path(path).resolve().is_relative_to(source):
                    raise ValueError('secret files must be outside source deployment tree')
            build = target.get('build')
            if build:
                context = Path(build['context']).resolve()
                if config_path.is_relative_to(context) or state_dir.is_relative_to(context) or (target.get('secretsFile') and Path(target['secretsFile']).resolve().is_relative_to(context)):
                    raise ValueError('private config/state/secrets must be outside build contexts')
        make_server(helper, int(os.environ.get('DEPLOYMENT_PORT', '8095'))).serve_forever()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    try:
        main()
    except (OSError, ValueError, KeyError):
        logger.error('Helper startup failed; check private operator configuration')
        raise SystemExit(1)
