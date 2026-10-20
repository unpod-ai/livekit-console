import importlib.util
import json
import os
from pathlib import Path
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch
import urllib.error

# Exercise the helper's transport behavior without installing the Agents SDK in the console.
module_path = Path(__file__).resolve().parents[2] / "examples" / "agent_report_upload.py"
spec = importlib.util.spec_from_file_location("agent_report_upload", module_path)
helper = importlib.util.module_from_spec(spec)
fake_agents = types.ModuleType("livekit.agents")
fake_agents.JobContext = object
with patch.dict("sys.modules", {"livekit": types.ModuleType("livekit"), "livekit.agents": fake_agents}):
    spec.loader.exec_module(helper)


class UploadTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"CONSOLE_URL": "https://console.example.com", "AGENT_TELEMETRY_TOKEN": "test-token"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.ctx = Mock()
        self.ctx.make_session_report.return_value.to_dict.return_value = {
            "room_id": "RM_example", "job_id": "AJ_example", "timestamp": 1000,
            "chat_history": {"items": []},
        }

    async def test_retry_reuses_the_same_serialized_report(self):
        sent = []

        def send(request, timeout):
            sent.append(request.data)
            if len(sent) == 1:
                raise urllib.error.URLError("temporary failure")
            return Mock(__enter__=Mock(return_value=Mock()), __exit__=Mock(return_value=False))

        with patch.object(helper.urllib.request, "build_opener") as build, patch.object(helper.asyncio, "sleep", new_callable=AsyncMock):
            build.return_value.open.side_effect = send
            self.assertTrue(await helper.upload_session_report(self.ctx, "example-agent"))
        self.ctx.make_session_report.assert_called_once()
        self.assertEqual(sent[0], sent[1])
        self.assertEqual(json.loads(sent[0])["agentName"], "example-agent")

    async def test_rejected_authentication_is_not_retried(self):
        with patch.object(helper.urllib.request, "build_opener") as build, patch.object(helper.logger, "warning"):
            build.return_value.open.side_effect = urllib.error.HTTPError("https://console.example.com", 401, "unauthorized", {}, None)
            self.assertFalse(await helper.upload_session_report(self.ctx, "example-agent"))
            self.assertEqual(build.return_value.open.call_count, 1)

    async def test_non_json_metrics_do_not_break_the_session_end_callback(self):
        self.ctx.make_session_report.return_value.to_dict.return_value = {"metric": float("nan")}
        with patch.object(helper.urllib.request, "build_opener") as build, patch.object(helper.logger, "warning"):
            self.assertFalse(await helper.upload_session_report(self.ctx, "example-agent"))
            build.assert_not_called()

    def test_upload_redirects_are_not_followed(self):
        self.assertIsNone(helper.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example.com"))
