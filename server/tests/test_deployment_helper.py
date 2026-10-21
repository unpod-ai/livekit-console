"""Host-helper contract tests; no Docker daemon or production mutation."""
import importlib.util
import json
import os
import sys
import subprocess
import socket
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

MODULE = Path(__file__).resolve().parents[2] / 'scripts/deployment-helper.py'


def load_helper():
    spec = importlib.util.spec_from_file_location('deployment_helper', MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeDocker:
    def __init__(self):
        self.containers = {'old': {'Id': 'old', 'Image': 'sha256:0000000000000000000000000000000000000000000000000000000000000000', 'Config': {'Image': 'worker:old', 'Env': ['SECRET=never-expose'], 'Labels': {}}, 'State': {'Running': True, 'Status': 'running'}, 'Created': 'today'}}
        self.calls = []
        self.healthy = True
        self.exit_on_term = True
        self.gate = None

    def inspect(self, name):
        return self.containers.get(name)

    def image(self, reference):
        return {'Id': {'worker:old': 'sha256:0000000000000000000000000000000000000000000000000000000000000000', 'worker:new': 'sha256:1111111111111111111111111111111111111111111111111111111111111111'}.get(reference, reference), 'Config': {'Labels': {'org.opencontainers.image.revision': 'rev'}}}

    def run(self, args, timeout=30):
        self.calls.append(args)
        if args[0] == 'create':
            name = args[args.index('--name') + 1]
            image = next(x for x in args if x.startswith('sha256:'))
            self.containers[name] = {'Id': name, 'Image': image, 'Config': {'Image': image}, 'State': {'Running': False, 'Status': 'created'}}
            return name
        if args[0] == 'start':
            self.containers[args[-1]]['State'] = {'Running': True, 'Status': 'running'}
        if args[0] == 'kill' and self.exit_on_term:
            self.containers[args[-1]]['State'] = {'Running': False, 'Status': 'exited'}
        if args[0] == 'logs':
            return 'safe\nSECRET=never-expose\nBearer abcdef\n'
        return ''

    def worker_health(self, port, agent):
        if self.gate:
            self.gate.wait(2)
        return self.healthy

    def build(self, target, tag):
        return 'sha256:2222222222222222222222222222222222222222222222222222222222222222', ['build complete']


class HelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.h = load_helper()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.secret = self.root / 'worker.env'
        self.secret.write_text('SECRET=never-expose\nAGENT_NAME=fixture\n')
        self.secret.chmod(0o600)
        self.target = dict(id='test', name='Test', agentName='fixture', container='old', managed=True, actionsEnabled=True, allowedImages=['worker:old', 'worker:new'], allowedSecretKeys=['SECRET', 'AGENT_NAME'], secretsFile=str(self.secret), ports=[18083, 18084], containerPort=8081, command=['python', 'worker.py'], entrypoint=[], network='bridge', healthTimeout=.04, drainTimeout=.04, pollInterval=.005)
        self.config = {'token': 'a' * 40, 'targets': [self.target]}
        self.docker = FakeDocker()
        self.service = self.h.Helper(self.config, self.root / 'state', self.docker)

    def request(self, method='GET', suffix='', body=None, token=None):
        return self.service.request(method, f'/targets{suffix}', 'Bearer ' + (token or 'a' * 40), body)

    def action(self, action='deploy', request='one', **extra):
        return self.request('POST', '/test/actions', dict(action=action, confirm='test', requestId=request, **extra))

    def wait(self, operation):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            current = next(o for o in self.request()[1]['operations'] if o['id'] == operation['id'])
            if current['state'] not in ('queued', 'running'):
                return current
            time.sleep(.005)
        self.fail('operation did not finish')

    def test_single_server_token_target_and_safe_inventory(self):
        self.assertEqual(self.request(token='wrong')[0], 401)
        self.assertEqual(self.service.request('GET', '/projects/p/targets', 'Bearer ' + 'a' * 40, None)[0], 404)
        self.assertEqual(self.request(suffix='/missing/secrets')[0], 404)
        payload = self.request()[1]
        target = payload['targets'][0]
        self.assertEqual(target['allowedImages'], [{'reference': 'worker:old', 'imageId': 'sha256:0000000000000000000000000000000000000000000000000000000000000000'}, {'reference': 'worker:new', 'imageId': 'sha256:1111111111111111111111111111111111111111111111111111111111111111'}])
        self.assertEqual(target['registration'], 'unknown')
        self.assertNotIn('never-expose', json.dumps(payload))
        self.assertNotIn('Env', json.dumps(payload))

    def test_readonly_denies_all_mutations_and_revision_unknown(self):
        for key in ('managed', 'actionsEnabled'):
            self.target[key] = False
            self.assertEqual(self.action('reconcile')[0], 409)
            self.assertEqual(self.request('PUT', '/test/secrets', {'confirm': 'test', 'values': {'SECRET': 'new'}})[0], 409)
            self.target[key] = True
        self.target['managed'] = False
        self.assertIsNone(self.request(suffix='/test/secrets')[1]['revision'])
        self.assertEqual(self.docker.calls, [])

    def test_images_commands_paths_and_confirmation_rejected(self):
        for image in ('worker:new', 'evil:latest', '--privileged'):
            self.assertEqual(self.action(image=image)[0], 400)
        self.assertEqual(self.request('POST', '/test/actions', {'action': 'drain', 'confirm': 'wrong', 'requestId': 'x'})[0], 400)
        self.assertEqual(self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111', command=['sh'])[0], 400)
        self.assertEqual(self.docker.calls, [])

    def test_secret_version_atomic_private_write_only_and_allowlist(self):
        before = self.request(suffix='/test/secrets')[1]
        self.assertEqual(before['keys'], ['AGENT_NAME', 'SECRET'])
        self.assertEqual(self.request('PUT', '/test/secrets', {'confirm': 'test', 'values': {'EVIL': 'x'}})[0], 400)
        self.assertEqual(self.request('PUT', '/test/secrets', {'confirm': 'test', 'values': {'SECRET': 'x\nINJECT=1'}})[0], 400)
        status, after = self.request('PUT', '/test/secrets', {'confirm': 'test', 'values': {'SECRET': 'rotated-secret'}})
        self.assertEqual(status, 200)
        self.assertNotEqual(before['revision'], after['revision'])
        self.assertNotIn('rotated-secret', json.dumps(after))
        self.assertIn('never-expose', self.secret.read_text())
        for path in (self.root / 'state').rglob('*'):
            if path.is_file():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('rotated-secret', self.service.state_path.read_text())

    def test_candidate_failure_never_signals_old(self):
        self.docker.healthy = False
        status, operation = self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111')
        self.assertEqual(status, 202)
        self.assertEqual(self.wait(operation)['state'], 'failed')
        self.assertFalse(any(c[0] == 'kill' and c[-1] == 'old' for c in self.docker.calls))
        self.assertTrue(self.docker.containers['old']['State']['Running'])

    def test_rollout_rollback_preserve_prior_image_and_secret_revision(self):
        initial = self.request(suffix='/test/secrets')[1]['revision']
        self.request('PUT', '/test/secrets', {'confirm': 'test', 'values': {'SECRET': 'rotated'}})
        operation = self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[1]
        self.assertEqual(self.wait(operation)['state'], 'succeeded')
        rollback = self.action('rollback', request='back')[1]
        self.assertEqual(self.wait(rollback)['state'], 'succeeded')
        target = self.request()[1]['targets'][0]
        self.assertEqual(target['imageId'], 'sha256:0000000000000000000000000000000000000000000000000000000000000000')
        self.assertEqual(target['secretRevision'], initial)
        self.assertTrue(any(c[:3] == ['kill', '--signal', 'SIGTERM'] for c in self.docker.calls))
        self.assertFalse(any(c[0] == 'stop' or 'SIGKILL' in c for c in self.docker.calls))

    def test_timeout_reconcile_reuses_candidate_and_never_resignals(self):
        self.docker.exit_on_term = False
        operation = self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[1]
        self.assertEqual(self.wait(operation)['state'], 'timed_out')
        self.assertEqual(self.action(request='second', image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[0], 409)
        self.docker.containers['old']['State'] = {'Running': False, 'Status': 'exited'}
        reconcile = self.action('reconcile', request='reconcile')[1]
        self.assertEqual(self.wait(reconcile)['state'], 'succeeded')
        self.assertEqual(sum(c[0] == 'create' for c in self.docker.calls), 1)
        self.assertEqual(sum(c[0] == 'kill' for c in self.docker.calls), 1)

    def test_idempotency_and_concurrent_target_lock(self):
        self.docker.gate = threading.Event()
        first = self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[1]
        duplicate = self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[1]
        self.assertEqual(first['id'], duplicate['id'])
        self.assertEqual(self.action(request='second', image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[0], 409)
        self.assertEqual(self.request('PUT', '/test/secrets', {'confirm': 'test', 'values': {'SECRET': 'racing'}})[0], 409)
        self.docker.gate.set()
        self.assertEqual(self.wait(first)['state'], 'succeeded')

    def test_restart_marks_unknown_without_commands(self):
        self.docker.exit_on_term = False
        self.wait(self.action(image='sha256:1111111111111111111111111111111111111111111111111111111111111111')[1])
        state = json.loads(self.service.state_path.read_text())
        state['operations'][-1]['state'] = 'running'
        self.h.atomic_json(self.service.state_path, state)
        count = len(self.docker.calls)
        restarted = self.h.Helper(self.config, self.root / 'state', self.docker)
        result = restarted.request('GET', '/targets', 'Bearer ' + 'a' * 40, None)[1]
        self.assertEqual(result['operations'][-1]['state'], 'unknown')
        self.assertEqual(result['operations'][-1]['error'], 'reconcile_required')
        self.assertEqual(len(self.docker.calls), count)

    def test_log_redaction_and_bounds(self):
        data = self.request(suffix='/test/logs?kind=runtime&lines=2')[1]
        self.assertLessEqual(len(data['lines']), 2)
        self.assertNotIn('never-expose', json.dumps(data))
        self.assertNotIn('abcdef', json.dumps(data))
        self.assertEqual(self.request(suffix='/test/logs?kind=bad')[0], 400)

    def test_build_is_target_scoped_and_deploys_only_after_success(self):
        self.target['build'] = {'context': '/trusted/context', 'dockerfile': '/trusted/Dockerfile', 'imageTagPrefix': 'fixture/build'}
        self.assertEqual(self.action(image='sha256:' + '2' * 64)[0], 400)
        built = self.action('build')[1]
        self.assertEqual(self.wait(built)['state'], 'succeeded')
        images = self.request()[1]['targets'][0]['allowedImages']
        self.assertIn('sha256:' + '2' * 64, [i['imageId'] for i in images])
        self.assertEqual(self.wait(self.action(request='after-build', image='sha256:' + '2' * 64)[1])['state'], 'succeeded')

    def test_reconcile_never_promotes_wrong_candidate_image(self):
        self.docker.exit_on_term = False
        self.wait(self.action(image='sha256:' + '1' * 64)[1])
        candidate = self.service.state['targets']['test']['pending']['candidate']['id']
        self.docker.containers[candidate]['Image'] = 'sha256:' + '3' * 64
        self.docker.containers['old']['State'] = {'Running': False, 'Status': 'exited'}
        operation = self.action('reconcile', request='reconcile')[1]
        self.assertEqual(self.wait(operation)['state'], 'unknown')
        self.assertEqual(self.service.state['targets']['test']['current']['id'], 'old')

    def test_inventory_drain_only_does_not_advertise_fake_candidate(self):
        self.docker.exit_on_term = False
        self.wait(self.action('drain')[1])
        inventory = self.request()[1]['targets'][0]
        self.assertEqual(len(inventory['instances']), 1)
        self.assertEqual(inventory['instances'][0]['role'], 'draining')

    def test_short_or_missing_server_token_rejected(self):
        for token in ('short', None):
            self.config['token'] = token
            with self.assertRaises(ValueError):
                self.h.Helper(self.config, self.root / 'invalid')

    def test_state_and_container_labels_have_only_single_server_ownership(self):
        self.wait(self.action(image='sha256:' + '1' * 64)[1])
        self.assertEqual(set(self.service.state['targets']), {'test'})
        self.assertNotIn('projectId', json.dumps(self.service.state))
        self.assertNotIn('deployment-helper.project', json.dumps(self.docker.calls))
        self.assertTrue(any('deployment-helper.owner=' + self.service.state['owner'] in call for call in self.docker.calls))

    def test_actual_health_requires_success_and_matching_agent(self):
        import io
        class Reply(io.BytesIO):
            status = 200
        opener = unittest.mock.Mock()
        def replies(agent):
            return [Reply(b'OK'), Reply(json.dumps({'agent_name': agent}).encode())]
        with patch.object(self.h.urllib.request, 'build_opener', return_value=opener):
            opener.open.side_effect = replies('wrong')
            self.assertFalse(self.h.Docker().worker_health(18083, 'fixture'))
            opener.open.side_effect = replies('fixture')
            self.assertTrue(self.h.Docker().worker_health(18083, 'fixture'))
        self.assertTrue(all(call.args[0].startswith('http://127.0.0.1:18083/') for call in opener.open.call_args_list))

    def test_idempotency_conflicting_payload_is_denied(self):
        self.wait(self.action(image='sha256:' + '1' * 64)[1])
        self.assertEqual(self.action('drain')[0], 409)

    def test_readonly_bare_docker_credentials_are_redacted_privately(self):
        self.target.update(managed=False, actionsEnabled=False)
        self.target.pop('secretsFile')
        self.docker.containers['old']['Config']['Env'] = ['LIVEKIT_API_SECRET=zxqw987unlabelled', 'AGENT_NAME=fixture']
        with patch.object(self.docker, 'run', return_value='error zxqw987unlabelled here'):
            result = self.request(suffix='/test/logs')[1]
        self.assertEqual(result['lines'], ['error [redacted] here'])
        self.assertNotIn('LIVEKIT_API_SECRET', json.dumps(self.request()[1]))
        self.assertEqual(self.request(suffix='/test/secrets')[1]['keys'], [])

    def test_inventory_and_operation_timestamps_are_epoch_milliseconds(self):
        target = self.request()[1]['targets'][0]
        self.assertIsInstance(target['observedAt'], int)
        self.assertGreater(target['observedAt'], 1_700_000_000_000)
        operation = self.wait(self.action('drain')[1])
        self.assertIsInstance(operation['startedAt'], int)
        self.assertIsInstance(operation['steps'][0]['at'], int)

    def test_build_timeout_remains_unknown_until_operator_reconciles(self):
        self.target['build'] = {'context': '/trusted', 'dockerfile': '/trusted/Dockerfile', 'imageTagPrefix': 'fixture/build'}
        with patch.object(self.docker, 'build', side_effect=self.h.APIError(503, 'Docker command timed out; reconciliation may be required')):
            operation = self.wait(self.action('build')[1])
        self.assertEqual(operation['state'], 'unknown')
        self.assertEqual(self.action('build', request='repeat')[0], 409)

    def test_failed_post_drain_health_is_not_promoted(self):
        original = self.docker.worker_health
        count = 0
        def health(port, agent):
            nonlocal count
            count += 1
            return original(port, agent) if count == 1 else False
        with patch.object(self.docker, 'worker_health', side_effect=health):
            operation = self.wait(self.action(image='sha256:' + '1' * 64)[1])
        self.assertEqual(operation['state'], 'unknown')
        self.assertEqual(self.service.state['targets']['test']['current']['id'], 'old')

    def test_bounded_docker_output_discards_partial_secret_lines(self):
        original = subprocess.Popen
        def client(argv, **kwargs):
            return original([sys.executable, '-c', 'import sys; sys.stdout.write("x" * 400000 + "sensitive-tail\\npublic\\n")'], **kwargs)
        with patch.object(self.h.subprocess, 'Popen', side_effect=client):
            output = self.h.Docker().run(['logs', 'fixture'])
        self.assertLess(len(output), self.h.MAX_BYTES + 100)
        self.assertNotIn('sensitive-tail', output)
        self.assertIn('public', output)

    def test_disposable_worker_real_sigterm_finishes_active_job(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        worker = MODULE.parent / 'fixtures/deployment-helper/worker.py'
        process = subprocess.Popen([sys.executable, str(worker)],
            env=dict(os.environ, FIXTURE_PORT=str(port), AGENT_NAME='fixture'),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        def cleanup():
            if process.poll() is None:
                try:
                    urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}/release', data=b'{{}}', method='POST'), timeout=1).close()
                except OSError:
                    pass
                process.terminate()
                process.wait(timeout=5)
        self.addCleanup(cleanup)
        url = f'http://127.0.0.1:{port}'
        deadline = time.monotonic() + 3
        while True:
            try:
                with urllib.request.urlopen(url + '/worker', timeout=1) as response:
                    self.assertEqual(json.load(response)['agent_name'], 'fixture')
                break
            except OSError:
                if time.monotonic() > deadline:
                    self.fail('fixture did not start')
                time.sleep(.02)
        with urllib.request.urlopen(urllib.request.Request(url + '/busy?hold=1', data=b'{}', method='POST')) as response:
            self.assertTrue(json.load(response).get('held'))
        process.terminate()
        time.sleep(.1)
        self.assertIsNone(process.poll(), 'active fixture job must survive SIGTERM until completion')
        with urllib.request.urlopen(url + '/worker') as response:
            state = json.load(response)
            self.assertTrue(state['held'])
            self.assertEqual(state['signals'], 1)
        with urllib.request.urlopen(urllib.request.Request(url + '/release', data=b'{}', method='POST')):
            pass
        self.assertEqual(process.wait(timeout=3), 0)

    def test_unicode_log_response_stays_inside_proxy_byte_budget(self):
        with patch.object(self.docker, 'run', return_value=('😀' * 100 + '\n') * 500):
            status, payload = self.request(suffix='/test/logs?lines=500')
        self.assertEqual(status, 200)
        self.assertLess(len(json.dumps(payload).encode()), self.h.MAX_BYTES)
        self.assertTrue(payload['truncated'])

    def test_real_docker_null_image_labels_report_unknown_version(self):
        original = self.docker.image
        def image(reference):
            result = original(reference)
            result['Config']['Labels'] = None
            return result
        with patch.object(self.docker, 'image', side_effect=image):
            status, payload = self.request()
        self.assertEqual(status, 200)
        self.assertIsNone(payload['targets'][0]['version'])

    def test_http_auth_and_nonblocking_server(self):
        server = self.h.make_server(self.service, 0)
        self.addCleanup(server.server_close)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        url = f'http://127.0.0.1:{server.server_address[1]}/targets'
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url)
        self.assertEqual(error.exception.code, 401)
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + 'a' * 40})
        with urllib.request.urlopen(request) as response:
            self.assertTrue(json.load(response)['configured'])

    def test_docker_signal_argv_and_bounded_redaction_failure(self):
        docker = self.h.Docker()
        original = subprocess.Popen
        def client(argv, **kwargs):
            self.assertEqual(argv, ['docker', 'kill', '--signal', 'SIGTERM', 'old'])
            self.assertFalse(kwargs.get('shell', False))
            return original([sys.executable, '-c', 'print("ok")'], **kwargs)
        with patch.object(self.h.subprocess, 'Popen', side_effect=client):
            self.assertEqual(docker.run(['kill', '--signal', 'SIGTERM', 'old']).strip(), 'ok')


if __name__ == '__main__':
    unittest.main()
