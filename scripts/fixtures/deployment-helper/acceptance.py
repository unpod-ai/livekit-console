#!/usr/bin/env python3
"""Run on a disposable Docker host; creates ONLY randomly named owned fixtures.

python3 scripts/fixtures/deployment-helper/acceptance.py --base-image python:3.11-slim
Private config/state/evidence stay under /tmp/phase6-host-helper-*. No production
container is inspected, restarted, stopped, renamed, or otherwise mutated.
Cleanup SIGTERMs owned containers and removes only stopped ones; never force-rm.
"""
import argparse
import importlib.util
import json
import logging
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

logger = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent
HELPER = HERE.parents[1] / 'deployment-helper.py'


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def load():
    spec = importlib.util.spec_from_file_location('fixture_helper', HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def wait_for(function, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = function()
            if result:
                return result
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(.1)
    raise AssertionError('fixture condition timed out')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-image', default='python:3.11-slim')
    args = parser.parse_args()
    h = load()
    docker = h.Docker()
    root = Path(tempfile.mkdtemp(prefix='phase6-host-helper-'))
    suffix = secrets.token_hex(6)
    target_id = 'disposable'
    initial = 'phase6-fixture-' + suffix
    label = 'phase6.fixture=' + suffix
    image_tag = 'phase6-fixture:' + suffix
    candidate_tag = image_tag + '-candidate'
    token = secrets.token_urlsafe(40)
    ports = [free_port(), free_port()]
    helper_port = free_port()
    helper_process = None
    evidence = {'root': str(root), 'checks': [], 'cleanup': []}
    request_id = 0

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        evidence['checks'].append(name)
        logger.info('PASS %s', name)

    def http(url, method='GET', body=None, auth=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Content-Type': 'application/json'}
        if auth:
            headers['Authorization'] = 'Bearer ' + auth
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)

    base = f'http://127.0.0.1:{helper_port}/targets'

    def api(suffix='', method='GET', body=None):
        return http(base + suffix, method, body, token)

    def inventory():
        status, data = api()
        if status != 200:
            return None
        return data

    def start_helper():
        nonlocal helper_process
        environment = dict(os.environ, DEPLOYMENT_CONFIG=str(root / 'config.json'),
                           DEPLOYMENT_STATE_DIR=str(root / 'state'), DEPLOYMENT_PORT=str(helper_port), PYTHONDONTWRITEBYTECODE='1')
        with open(root / 'helper.log', 'ab') as output:
            os.chmod(root / 'helper.log', 0o600)
            helper_process = subprocess.Popen([sys.executable, str(HELPER)], env=environment, stdout=output, stderr=output)
        wait_for(inventory)

    def action(action, image=None):
        nonlocal request_id
        request_id += 1
        body = dict(action=action, confirm=target_id, requestId=f'fixture-{request_id}')
        if image:
            body['image'] = image
        status, operation = api('/disposable/actions', 'POST', body)
        check('action accepted: ' + action, status == 202)
        return operation, body

    def completed(operation):
        def lookup():
            found = next(o for o in inventory()['operations'] if o['id'] == operation['id'])
            return found if found['state'] not in ('queued', 'running') else None
        return wait_for(lookup)

    def secret(values):
        return api('/disposable/secrets', 'PUT', {'confirm': target_id, 'values': values})

    try:
        docker.run(['build', '--build-arg', 'BASE_IMAGE=' + args.base_image, '--tag', image_tag, str(HERE)], timeout=600)
        image_id = docker.image(image_tag)['Id']
        docker.run(['build', '--build-arg', 'BASE_IMAGE=' + args.base_image,
                    '--label', 'phase6.fixture.version=candidate', '--tag', candidate_tag, str(HERE)], timeout=600)
        candidate_image_id = docker.image(candidate_tag)['Id']
        check('candidate and prior image IDs differ', candidate_image_id != image_id)
        secret_file = root / 'worker.env'
        h.atomic_bytes(secret_file, b'AGENT_NAME=fixture\nFIXTURE_VERSION=one\nFIXTURE_SECRET=zxqw987unlabelled\n')
        target = dict(id=target_id, name='Disposable signal fixture', agentName='fixture', container=initial,
                      managed=True, actionsEnabled=True, allowedImages=[image_tag, candidate_tag], network='bridge', command=[], entrypoint=[],
                      ports=ports, containerPort=8081, secretsFile=str(secret_file),
                      allowedSecretKeys=['AGENT_NAME', 'FIXTURE_VERSION', 'FIXTURE_SECRET'],
                      healthTimeout=10, drainTimeout=2, pollInterval=.05,
                      build={'context': str(HERE), 'dockerfile': str(HERE / 'Dockerfile'), 'imageTagPrefix': 'phase6-build-' + suffix})
        readonly = dict(id='readonly', name='Read-only fixture', agentName='fixture', container=initial,
                        managed=False, actionsEnabled=False, allowedImages=[])
        config = {'token': token, 'targets': [target, readonly]}
        h.atomic_json(root / 'config.json', config)
        docker.run(['create', '--name', initial, '--label', label,
                    '--publish', f'127.0.0.1:{ports[0]}:8081', '--env-file', str(secret_file), image_id])
        docker.run(['start', initial])
        wait_for(lambda: docker.worker_health(ports[0], 'fixture'))
        start_helper()
        check('unauthorized denied', http(base)[0] == 401)
        check('invalid token denied', http(base, auth='invalid-token')[0] == 401)
        check('unknown target denied', api('/missing/secrets')[0] == 404)
        check('read-only write denied', api('/readonly/actions', 'POST', dict(action='drain', confirm='readonly', requestId='deny'))[0] == 409)
        check('mutable image rejected', api('/disposable/actions', 'POST', dict(action='deploy', image=image_tag, confirm=target_id, requestId='mutable'))[0] == 400)
        status, logs = api('/readonly/logs')
        check('bare runtime secret redacted', status == 200 and any('[redacted]' in line for line in logs['lines']) and 'zxqw987unlabelled' not in json.dumps(logs))
        initial_revision = api('/disposable/secrets')[1]['revision']
        secret({'FIXTURE_VERSION': 'two'})
        status, busy = http(f'http://127.0.0.1:{ports[0]}/busy?hold=1', 'POST', {})
        check('active fixture job held until explicit release', status == 200 and busy.get('held') is True)
        operation, duplicate_body = action('deploy', candidate_image_id)
        check('duplicate request stable', api('/disposable/actions', 'POST', duplicate_body)[1]['id'] == operation['id'])
        result = completed(operation)
        evidence['drainOperationState'] = result['state']
        check('active job yields timed_out', result['state'] == 'timed_out')
        pending_instances = inventory()['targets'][0]['instances']
        check('current and candidate retained', len([i for i in pending_instances if i['state'] == 'running']) == 2)
        check('old worker still running after SIGTERM', docker.inspect(initial)['State']['Running'])
        _, active = http(f'http://127.0.0.1:{ports[0]}/worker')
        check('held job received exactly one SIGTERM', active.get('held') is True and active.get('signals') == 1)
        interrupted, _ = action('reconcile')
        helper_process.terminate()
        helper_process.wait(timeout=5)
        persisted = json.loads((root / 'state/state.json').read_text())
        interrupted_state = next(o for o in persisted['operations'] if o['id'] == interrupted['id'])['state']
        check('helper interrupted real in-flight reconcile', interrupted_state in ('queued', 'running'))
        start_helper()
        restarted = next(o for o in inventory()['operations'] if o['id'] == interrupted['id'])
        check('restart marks interrupted operation unknown', restarted['state'] == 'unknown' and restarted['error'] == 'reconcile_required')
        status, released = http(f'http://127.0.0.1:{ports[0]}/release', 'POST', {})
        check('active job explicitly released', status == 200 and released.get('released') is True)
        wait_for(lambda: not docker.inspect(initial)['State']['Running'])
        reconciled, _ = action('reconcile')
        check('explicit reconcile promotes same candidate', completed(reconciled)['state'] == 'succeeded')
        current = inventory()['targets'][0]
        check('candidate selected immutable image and rotated secret revision', current['imageId'] == candidate_image_id and current['secretRevision'] != initial_revision)
        check('candidate runtime version two', http(f'http://127.0.0.1:{ports[1]}/worker')[1]['version'] == 'two')
        back, _ = action('rollback')
        check('rollback succeeds', completed(back)['state'] == 'succeeded')
        current = inventory()['targets'][0]
        check('rollback restores exact secret revision and image', current['secretRevision'] == initial_revision and current['imageId'] == image_id)
        check('rollback runtime version one', http(f'http://127.0.0.1:{ports[0]}/worker')[1]['version'] == 'one')
        old_id = current['instances'][0]['id']
        secret({'AGENT_NAME': 'wrong'})
        wrong, _ = action('deploy', candidate_image_id)
        check('wrong agent_name candidate fails', completed(wrong)['state'] == 'failed')
        check('failed candidate does not signal existing worker', docker.inspect(old_id)['State']['Running'] and http(f'http://127.0.0.1:{ports[0]}/worker')[1]['signals'] == 0)
        secret({'AGENT_NAME': 'fixture'})
        built, _ = action('build')
        check('trusted build succeeds', completed(built)['state'] == 'succeeded')
        check('successful build advertised', len(inventory()['targets'][0]['allowedImages']) == 3)
        drain, _ = action('drain')
        # Server shutdown may take up to .5s; reconcile is deliberately explicit.
        result = completed(drain)
        if result['state'] == 'timed_out':
            wait_for(lambda: not docker.inspect(old_id)['State']['Running'])
            drain, _ = action('reconcile')
            result = completed(drain)
        check('drain exits gracefully', result['state'] == 'succeeded')
        evidence['passed'] = True
    finally:
        # Release only this fixture's held job before graceful cleanup, even when
        # an assertion fails. A held worker is never force-terminated.
        initial_state = docker.inspect(initial)
        if initial_state and initial_state.get('State', {}).get('Running'):
            try:
                http(f'http://127.0.0.1:{ports[0]}/release', 'POST', {})
            except (OSError, urllib.error.URLError):
                pass
        if helper_process and helper_process.poll() is None:
            helper_process.terminate()
            helper_process.wait(timeout=5)
        # Select only this run's initial fixture label and this isolated helper's
        # persistent owner label. No production container is enumerated.
        labels = [label]
        state_path = root / 'state/state.json'
        if state_path.exists():
            owner = json.loads(state_path.read_text())['owner']
            labels.append('deployment-helper.owner=' + owner)
        names = set()
        for owned_label in labels:
            names.update(docker.run(['ps', '-a', '--filter', 'label=' + owned_label, '--format', '{{.ID}}']).splitlines())
        for name in names:
            inspected = docker.inspect(name)
            if inspected and inspected['State']['Running']:
                docker.run(['update', '--restart=no', name])
                docker.run(['kill', '--signal', 'SIGTERM', name])
            try:
                wait_for(lambda: (docker.inspect(name) or {}).get('State', {}).get('Running') is False, seconds=35)
                docker.run(['rm', name])
                evidence['cleanup'].append({'id': name, 'state': 'removed-stopped'})
            except AssertionError:
                evidence['cleanup'].append({'id': name, 'state': 'retained-running'})
        h.atomic_json(root / 'evidence.json', evidence)
        logger.info('Private fixture evidence: %s', root / 'evidence.json')
        # Leave images and private evidence for operator review; no image pruning.


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    main()
