import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import unittest


class DeployArgumentsTest(unittest.TestCase):
    def test_ssh_remote_command_preserves_optional_empty_arguments(self):
        source = Path(__file__).resolve().parents[2] / 'deploy.sh'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copy2(source, root / 'deploy.sh')
            (root / '.env.deploy').write_text('DEPLOY_HOST=test-host\nDEPLOY_DIR=console\n')
            binary = root / 'bin'
            binary.mkdir()
            ssh = binary / 'ssh'
            ssh.write_text('#!/usr/bin/env python3\nimport json,os,sys\nif any("bash" in arg for arg in sys.argv[1:]):\n open(os.environ["DEPLOY_CAPTURE"],"w").write(json.dumps({"command":sys.argv[1:],"script":sys.stdin.read()}))\nelse:\n sys.stdin.read() if sys.argv[-1].startswith("tar ") else None\n')
            ssh.chmod(0o755)
            capture = root / 'capture.json'
            env = dict(os.environ, PATH=str(binary) + ':' + os.environ['PATH'], DEPLOY_CAPTURE=str(capture))
            for key in ['AGENT_WORKER_URLS']:
                env.pop(key, None)
            subprocess.run(['bash', str(root / 'deploy.sh')], env=env, check=True, stdout=subprocess.DEVNULL)
            data = json.loads(capture.read_text())
            self.assertEqual(len(data['command']), 6)  # ssh options + host + one shell command
            remote = shlex.split(data['command'][-1])
            self.assertEqual(remote[:3], ['bash', '-s', '--'])
            self.assertEqual(remote[-1], '')
            prefix = data['script'].split('cd ~/')[0]
            subprocess.run(['bash', '-s', '--', *remote[3:]], input=prefix, text=True, check=True, env=env)
