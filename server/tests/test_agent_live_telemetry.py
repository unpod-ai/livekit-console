import importlib.util
import json
import os
from unittest.mock import patch
from pathlib import Path
import types
import unittest

spec = importlib.util.spec_from_file_location("agent_live_telemetry", Path(__file__).resolve().parents[2] / "examples" / "agent_live_telemetry.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Session:
    def __init__(self):
        self.handlers = {}
        self.usage = types.SimpleNamespace(model_usage=[])
        self.llm = None

    def on(self, event, callback):
        self.handlers[event] = callback

    def off(self, event, callback):
        self.handlers.pop(event, None)


class LiveTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.ctx = types.SimpleNamespace(job=types.SimpleNamespace(id="AJ_test", room=types.SimpleNamespace(sid="RM_test")), userdata={})
        self.sent = []

    async def send(self, path, body):
        self.sent.append(json.loads(body))
        return True

    async def test_retry_preserves_batch_and_terminal_counts_unique_records(self):
        bodies = []

        async def retry(path, body):
            bodies.append(body)
            return len(bodies) != 1

        collector = helper.SessionTelemetry(self.ctx, "test-agent", retry, sdk_version="1.5.8", background=False)
        collector.emit("message", id="msg1", at=1000, role="user", text="Hello")
        collector.emit("message", id="msg1", at=1000, role="user", text="Hello")
        self.assertFalse(await collector.flush())
        self.assertTrue(await collector.flush())
        self.assertEqual(bodies[0], bodies[1])
        self.assertTrue(await collector.close())
        terminal = json.loads(bodies[-1])["entries"][0]
        self.assertEqual(terminal["expectedCount"], 1)
        self.assertEqual(terminal["droppedCount"], 0)
        self.assertEqual(terminal["state"], "complete")

    async def test_queue_overflow_is_reported_as_incomplete(self):
        collector = helper.SessionTelemetry(self.ctx, "test-agent", self.send, sdk_version="1.5.8", capacity=1, background=False)
        self.assertTrue(collector.emit("state", id="one", state="thinking"))
        self.assertFalse(collector.emit("state", id="two", state="speaking"))
        await collector.close()
        terminal = self.sent[-1]["entries"][0]
        self.assertEqual(terminal["state"], "incomplete")
        self.assertEqual(terminal["expectedCount"], 2)
        self.assertEqual(terminal["droppedCount"], 1)

    async def test_native_event_projection_excludes_tools_payload_and_handles_errors(self):
        collector = helper.SessionTelemetry(self.ctx, "test-agent", self.send, sdk_version="1.5.8", background=False)
        session = Session()
        collector.attach(session, mode="realtime")
        message = types.SimpleNamespace(type="message", id="chat1", created_at=1000, role="assistant", content=["Hello", {"image": "private"}], interrupted=True, metrics={"e2e_latency": 0})
        session.handlers["conversation_item_added"](types.SimpleNamespace(item=message))
        call = types.SimpleNamespace(name="lookup", call_id="call1", arguments="private")
        output = types.SimpleNamespace(call_id="call1", is_error=True, output="private")
        session.handlers["function_tools_executed"](types.SimpleNamespace(function_calls=[call], function_call_outputs=[output], created_at=1001))
        session.handlers["error"](types.SimpleNamespace(error=RuntimeError("tool unavailable"), source=session, created_at=1002))
        await collector.close()
        entries = [entry for batch in self.sent for entry in batch["entries"]]
        self.assertFalse("private" in json.dumps(entries))
        self.assertTrue(next(e for e in entries if e["kind"] == "message")["interrupted"])
        self.assertTrue(next(e for e in entries if e["kind"] == "tool")["isError"])
        self.assertEqual(next(e for e in entries if e["kind"] == "message")["metrics"]["e2e_latency"], 0)
        self.assertTrue(any(e["kind"] == "error" for e in entries))
        self.assertEqual(self.sent[-1]["mode"], "realtime")
        self.assertEqual(session.handlers, {})

    async def test_span_projection_keeps_timing_ids_and_drops_content_attributes(self):
        collector = helper.SessionTelemetry(self.ctx, "test-agent", self.send, sdk_version="1.5.8", background=False)
        span = types.SimpleNamespace(name="llm_node", context=types.SimpleNamespace(trace_id=1, span_id=2), parent=types.SimpleNamespace(span_id=3), start_time=1000000000, end_time=2000000000,
            status=types.SimpleNamespace(status_code=types.SimpleNamespace(name="ERROR")), attributes={"lk.generation_id": "turn1", "lk.response.ttft": 0.2, "lk.chat_ctx": "private", "lk.instructions": "private"})
        collector.record_span(span)
        await collector.close()
        record = next(e for b in self.sent for e in b["entries"] if e["kind"] == "span")
        self.assertEqual(record["traceId"], "0" * 31 + "1")
        self.assertEqual(record["stage"], "llm")
        self.assertEqual(record["at"], 1)
        self.assertEqual(record["end"], 2)
        self.assertEqual(record["metrics"]["llm_node_ttft"], 0.2)
        self.assertFalse("private" in json.dumps(record))

    async def test_upload_failure_and_unserializable_items_never_claim_complete(self):
        async def fail(path, body):
            return False
        collector = helper.SessionTelemetry(self.ctx, "test-agent", fail, sdk_version="1.5.8", background=False)
        collector.emit("message", text="Hello", role="user")
        self.assertFalse(await collector.close())
        self.assertEqual(collector.dropped, 1)
        self.assertFalse(await collector.close())
        collector = helper.SessionTelemetry(self.ctx, "test-agent", self.send, sdk_version="1.5.8", background=False)
        collector.emit("metrics", stage="llm", metrics={"duration": float('nan')})
        await collector.close()
        self.assertEqual(self.sent[-1]["entries"][0]["state"], "incomplete")

    async def test_native_job_context_does_not_require_userdata(self):
        del self.ctx.userdata
        with patch.dict(os.environ, {"AGENT_TELEMETRY_EVENTS_ENABLED": "true", "AGENT_LOGS_ENABLED": "false"}), patch.object(helper.importlib.metadata, "version", return_value="1.5.8"), patch.object(helper.SessionTelemetry, "configure_tracing"):
            collector = helper.start_collection(self.ctx, "test-agent", self.send)
            self.assertIs(helper.start_collection(self.ctx, "test-agent", self.send), collector)
            session = Session()
            self.assertIs(helper.attach_session(self.ctx, session), collector)
            await collector.close()
