#!/usr/bin/env python3
"""Disposable signal-aware worker. No RTC/provider/carrier SDKs or traffic."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import os
import signal
import threading
import time
import urllib.parse

logger = logging.getLogger(__name__)
state = {'busyUntil': 0.0, 'signals': 0, 'draining': False, 'held': False}


def terminate(signum, frame):
    state['signals'] += 1
    state['draining'] = True
    logger.info('SIGTERM received; finishing active fixture job')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_GET(self):
        payload = {'agent_name': os.environ.get('AGENT_NAME', 'fixture'),
                   'version': os.environ.get('FIXTURE_VERSION', 'one'),
                   'signals': state['signals'], 'draining': state['draining'], 'held': state['held']}
        self.reply(payload)

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == '/release':
            state['held'] = False
            state['busyUntil'] = 0.0
            self.reply({'released': True})
            return
        if parsed.path != '/busy':
            self.send_error(404)
            return
        query = urllib.parse.parse_qs(parsed.query)
        seconds = min(30, max(0, float(query.get('seconds', ['2'])[0])))
        state['held'] = query.get('hold') == ['1']
        state['busyUntil'] = time.monotonic() + seconds
        self.reply({'busy': True, 'held': state['held']})

    def reply(self, value):
        data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    logging.basicConfig(level=logging.INFO)
    signal.signal(signal.SIGTERM, terminate)
    server = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('FIXTURE_PORT', '8081'))), Handler)
    threading.Thread(target=lambda: server.serve_forever(poll_interval=.05), daemon=True).start()
    # Deliberately log a bare secret to exercise helper redaction.
    logger.info('fixture startup %s', os.environ.get('FIXTURE_SECRET', ''))
    while not state['draining'] or state['held'] or time.monotonic() < state['busyUntil']:
        time.sleep(.02)
    server.shutdown()
    server.server_close()
    logger.info('fixture active job finished; graceful exit')


if __name__ == '__main__':
    main()
