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
        self.ctx.make_session_report.return_value.model_usage = None
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
        self.assertEqual(json.loads(sent[0])["schemaVersion"], 2)

    async def test_rejected_authentication_is_not_retried(self):
        with patch.object(helper.urllib.request, "build_opener") as build, patch.object(helper.logger, "warning"):
            build.return_value.open.side_effect = urllib.error.HTTPError("https://console.example.com", 401, "unauthorized", {}, None)
            self.assertFalse(await helper.upload_session_report(self.ctx, "example-agent"))
            self.assertEqual(build.return_value.open.call_count, 1)

    async def test_log_batch_transport_retries_preserve_ids_and_body(self):
        self.ctx.job = types.SimpleNamespace(id="AJ_example", room=types.SimpleNamespace(sid="RM_example"))
        entry = {"id": "entry1", "at": 1000, "level": "INFO", "message": "Job ready"}
        sent = []

        def send(request, timeout):
            sent.append(request.data)
            if len(sent) == 1:
                raise urllib.error.URLError("temporary failure")
            return Mock(__enter__=Mock(return_value=Mock()), __exit__=Mock(return_value=False))

        with patch.dict(os.environ, {"AGENT_LOGS_ENABLED": "true"}), patch.object(helper.urllib.request, "build_opener") as build, patch.object(helper.asyncio, "sleep", new_callable=AsyncMock):
            build.return_value.open.side_effect = send
            self.assertTrue(await helper.upload_session_logs(self.ctx, "example-agent", [entry]))
        self.assertEqual(sent[0], sent[1])
        body = json.loads(sent[0])
        self.assertEqual(body["entries"], [entry])
        self.assertEqual(body["jobId"], "AJ_example")
        self.assertEqual(body["roomSid"], "RM_example")

    async def test_log_collection_is_opt_in_and_bounded(self):
        with patch.dict(os.environ, {"AGENT_LOGS_ENABLED": ""}), patch.object(helper.urllib.request, "build_opener") as build:
            self.assertFalse(await helper.upload_session_logs(self.ctx, "example-agent", []))
            build.assert_not_called()
        with patch.dict(os.environ, {"AGENT_LOGS_ENABLED": "true"}), patch.object(helper.urllib.request, "build_opener") as build:
            self.assertFalse(await helper.upload_session_logs(self.ctx, "example-agent", [{}] * 101))
            build.assert_not_called()

    async def test_opted_in_hook_emits_job_lifecycle_logs_even_when_report_fails(self):
        with patch.dict(os.environ, {"AGENT_LOGS_ENABLED": "true"}), patch.object(helper, "upload_session_logs", new_callable=AsyncMock, return_value=True) as upload_logs, patch.object(helper, "upload_session_report", new_callable=AsyncMock, side_effect=RuntimeError("unavailable")), patch.object(helper.logger, "warning"):
            self.assertTrue(helper.register_shutdown_report(self.ctx, "example-agent"))
            await self.ctx.add_shutdown_callback.call_args.args[0]()
        self.assertEqual(upload_logs.await_count, 2)
        messages = [call.args[2][0]["message"] for call in upload_logs.await_args_list]
        self.assertEqual(messages, ["Agent job started", "Agent job shutdown"])

    async def test_usage_defaults_keep_their_type_and_unknown_model_identity(self):
        usage = Mock(type="llm_usage", provider="", model="")
        usage.model_dump.return_value = {"input_tokens": 120, "output_tokens": 40}
        self.ctx.make_session_report.return_value.model_usage = [usage]
        with patch.object(helper.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = Mock(__enter__=Mock(return_value=Mock()), __exit__=Mock(return_value=False))
            self.assertTrue(await helper.upload_session_report(self.ctx, "example-agent"))
        body = json.loads(build.return_value.open.call_args.args[0].data)
        self.assertEqual(body["report"]["usage"], [{"type": "llm_usage", "provider": "", "model": "", "input_tokens": 120, "output_tokens": 40}])

    async def test_non_json_metrics_do_not_break_the_session_end_callback(self):
        self.ctx.make_session_report.return_value.to_dict.return_value = {"metric": float("nan")}
        with patch.object(helper.urllib.request, "build_opener") as build, patch.object(helper.logger, "warning"):
            self.assertFalse(await helper.upload_session_report(self.ctx, "example-agent"))
            build.assert_not_called()

    def test_upload_redirects_are_not_followed(self):
        self.assertIsNone(helper.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other.example.com"))

    async def test_shutdown_registration_uploads_after_the_sdk_callback_runs(self):
        with patch.object(helper, "upload_session_report", new_callable=AsyncMock, return_value=True) as upload:
            self.assertTrue(helper.register_shutdown_report(self.ctx, "example-agent"))
            upload.assert_not_awaited()
            callback = self.ctx.add_shutdown_callback.call_args.args[0]
            await callback()
            upload.assert_awaited_once_with(self.ctx, "example-agent")

    async def test_shutdown_upload_failure_does_not_break_other_cleanup(self):
        with patch.object(helper, "upload_session_report", new_callable=AsyncMock, side_effect=RuntimeError("no native session")), patch.object(helper.logger, "warning") as log:
            helper.register_shutdown_report(self.ctx, "example-agent")
            await self.ctx.add_shutdown_callback.call_args.args[0]()
            log.assert_called_once()

    def test_unconfigured_shutdown_hook_is_not_registered(self):
        with patch.dict(os.environ, {"AGENT_TELEMETRY_TOKEN": ""}):
            self.assertFalse(helper.register_shutdown_report(self.ctx, "example-agent"))
            self.ctx.add_shutdown_callback.assert_not_called()

    async def test_report_excludes_native_exception_objects_and_tool_payloads(self):
        self.ctx.make_session_report.return_value.to_dict.return_value.update({
            'events': [{'error': RuntimeError('not JSON serializable')}],
            'options': {'instructions': 'private'},
            'chat_history': {'items': [
                {'type': 'message', 'role': 'system', 'content': ['private']},
                {'type': 'message', 'role': 'assistant', 'content': ['Hello', {'image': object()}], 'metrics': {'e2e_latency': 0}},
                {'type': 'function_call', 'name': 'lookup', 'call_id': 'one', 'arguments': 'private'},
                {'type': 'function_call_output', 'call_id': 'one', 'output': 'private', 'is_error': True},
            ]},
        })
        with patch.object(helper, '_post_telemetry', new_callable=AsyncMock, return_value=True) as post:
            self.assertTrue(await helper.upload_session_report(self.ctx, 'test-agent'))
            body = json.loads(post.call_args.args[1])
            self.assertNotIn('private', json.dumps(body))
            self.assertEqual(body['report']['chat_history']['items'][1]['metrics']['e2e_latency'], 0)
