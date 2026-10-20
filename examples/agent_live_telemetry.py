"""Bounded LiveKit Agents event collector and OpenTelemetry span exporter.

Configure before AgentSession.start; use with the sibling report uploader.
Transport receives (route, serialized_body) and returns an awaitable bool.
"""
import asyncio
from collections import deque
import hashlib
import importlib.metadata
import json
import logging
import math
import os
import time
import uuid

logger = logging.getLogger(__name__)
KEY = "_livekit_console_telemetry"
METRICS = {"llm_node_ttft", "tts_node_ttfb", "e2e_latency", "transcription_delay", "end_of_turn_delay", "on_user_turn_completed_delay", "duration", "ttft", "ttfb", "audio_duration", "input_tokens", "output_tokens", "tokens_per_second", "playback_latency", "total_requests"}


def measured(value):
    if hasattr(value, "model_dump"):
        value = value.model_dump()
    value = value if isinstance(value, dict) else {}
    return {k: n for k, n in value.items() if k in METRICS and isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n) and n >= 0}


def correlation():
    try:
        from opentelemetry import trace
        context = trace.get_current_span().get_span_context()
        if context.is_valid:
            return {"traceId": format(context.trace_id, "032x"), "spanId": format(context.span_id, "016x")}
    except (ImportError, AttributeError):
        pass
    return {}


class SessionTelemetry:
    def __init__(self, ctx, agent_name, send, *, sdk_version, capacity=1000, background=True):
        self.ctx, self.agent_name, self.send = ctx, agent_name, send
        self.sdk_version, self.capacity = sdk_version, capacity
        self.loop = asyncio.get_running_loop()
        self.queue, self.pending, self.seen = deque(), None, set()
        self.total, self.dropped, self.mode = 0, 0, "unknown"
        self.sessions, self.listeners = [], []
        self.closing, self.closed = False, False
        self.wake, self.lock, self.close_lock = asyncio.Event(), asyncio.Lock(), asyncio.Lock()
        self.provider, self.log_handler = None, None
        self.quality_collector = None
        self.last_usage = {}
        self.last_heartbeat = time.monotonic()
        self.task = asyncio.create_task(self._run()) if background else None

    def emit(self, kind, **fields):
        if self.closed:
            return False
        event = {"id": fields.pop("id", uuid.uuid4().hex), "kind": kind, "at": fields.pop("at", time.time()), **fields}
        if event["id"] in self.seen:
            return True
        if len(self.seen) >= 100000:
            self.total += kind != "collection"
            self.dropped += 1
            return False
        self.seen.add(event["id"])
        if kind != "collection":
            self.total += 1
        if len(self.queue) + (len(self.pending[1]) if self.pending else 0) >= self.capacity:
            self.dropped += 1
            return False
        self.queue.append(event)
        if len(self.queue) >= 25:
            self.wake.set()
        return True

    def _envelope(self, entries):
        participant = None
        try:
            participant = self.ctx.room.local_participant.sid or None
        except (AttributeError, RuntimeError):
            pass
        return {"schemaVersion": 1, "roomSid": self.ctx.job.room.sid, "jobId": self.ctx.job.id,
                "agentName": self.agent_name, "batchId": uuid.uuid4().hex,
                "sdk": {"language": "python", "version": self.sdk_version},
                "participantSid": participant, "workerId": os.environ.get("LIVEKIT_WORKER_ID") or None,
                "mode": self.mode, "capabilities": ["events", "metrics", "usage", "report"] + (["spans"] if self.provider else []) + (["logs"] if os.environ.get("AGENT_LOGS_ENABLED") == "true" else []), "entries": entries}

    async def _send(self, body):
        try:
            return await asyncio.wait_for(self.send("/api/telemetry/events", body), 7)
        except Exception:
            return False

    async def flush(self):
        async with self.lock:
            self._usage()
            if self.pending is None and self.queue:
                entries = []
                while self.queue and len(entries) < 25:
                    item = self.queue.popleft()
                    candidate = entries + [item]
                    try:
                        body = json.dumps(self._envelope(candidate), allow_nan=False).encode()
                    except (TypeError, ValueError):
                        self.dropped += 1
                        continue
                    if len(body) > 256 * 1024:
                        if entries:
                            self.queue.appendleft(item)
                            break
                        self.dropped += 1
                        continue
                    entries = candidate
                if entries:
                    # Envelope (including batch ID and participant metadata) is frozen across retries.
                    self.pending = (json.dumps(self._envelope(entries), allow_nan=False).encode(), entries)
            if self.pending:
                if not await self._send(self.pending[0]):
                    return False
                self.pending = None
            return True

    async def _run(self):
        while not self.closing:
            try:
                await asyncio.wait_for(self.wake.wait(), 1)
            except asyncio.TimeoutError:
                pass
            self.wake.clear()
            if not self.closing:
                if time.monotonic() - self.last_heartbeat >= 30:
                    self.emit("collection", state="receiving", droppedCount=self.dropped)
                    self.last_heartbeat = time.monotonic()
                await self.flush()

    def _usage(self):
        for session in self.sessions:
            try:
                models = [{**u.model_dump(exclude_defaults=True), "type": u.type, "provider": u.provider, "model": u.model} for u in session.usage.model_usage]
                signature = json.dumps(models, sort_keys=True, allow_nan=False)
                if signature != self.last_usage.get(id(session)):
                    self.last_usage[id(session)] = signature
                    self.emit("usage", models=models)
            except (AttributeError, TypeError, ValueError):
                continue

    def attach(self, session, *, mode=None):
        if session in self.sessions:
            return
        self.sessions.append(session)
        if mode:
            self.mode = mode if self.mode in ("unknown", mode) else "mixed"
        else:
            try:
                from livekit.agents.llm import RealtimeModel, LLM
                if isinstance(session.llm, RealtimeModel):
                    self.mode = "realtime"
                elif isinstance(session.llm, LLM):
                    self.mode = "pipeline"
            except ImportError:
                pass

        def listen(event, callback):
            def guarded(value):
                try:
                    callback(value)
                except Exception:
                    self.dropped += 1
            session.on(event, guarded)
            self.listeners.append((session, event, guarded))

        def conversation(event):
            item = event.item
            if item.type == "agent_handoff":
                self.emit("handoff", at=getattr(item, "created_at", time.time()), fromAgent=getattr(item, "old_agent_id", None), toAgent=item.new_agent_id, **correlation())
            elif item.type == "message" and item.role in ("user", "assistant"):
                content = item.content if isinstance(item.content, list) else [item.content]
                fields = {"role": item.role, "text": "\n".join(p for p in content if isinstance(p, str)), "interrupted": bool(item.interrupted), "metrics": measured(getattr(item, "metrics", None))}
                # Same SDK item/update deduplicates; a later changed item remains visible as an update.
                identity = hashlib.sha256((str(item.id) + json.dumps(fields, sort_keys=True)).encode()).hexdigest()
                self.emit("message", id="msg_" + identity, at=getattr(item, "created_at", time.time()), messageId=str(item.id), **fields, **correlation())

        def tools(event):
            outputs = {o.call_id: o for o in event.function_call_outputs if o is not None}
            for call in event.function_calls:
                output = outputs.get(call.call_id)
                self.emit("tool", at=event.created_at, name=call.name, callId=call.call_id, isError=bool(getattr(output, "is_error", False)), status="completed" if output else "unavailable", **correlation())

        def error(event):
            value = event.error
            inner = getattr(value, "error", value)
            self.emit("error", at=event.created_at, message=(type(value).__name__ + ": " + str(inner))[:4000], source=type(event.source).__name__, recoverable=bool(getattr(value, "recoverable", False)), **correlation())

        def metric(event):
            value = event.metrics
            stage = getattr(value, "type", "other").replace("_metrics", "").replace("realtime_model", "realtime")
            if stage == "vad":
                return  # Per-frame VAD samples are deliberately excluded from the bounded session stream.
            raw = value.model_dump() if hasattr(value, "model_dump") else vars(value)
            mapped = {**raw}
            for src, target in [("prompt_tokens", "input_tokens"), ("completion_tokens", "output_tokens"), ("end_of_utterance_delay", "end_of_turn_delay")]:
                if src in raw:
                    mapped[target] = raw[src]
            context = correlation()
            if getattr(value, "speech_id", None):
                context["turnId"] = value.speech_id
            self.emit("metrics", at=event.created_at, stage=stage if stage in ("stt", "llm", "tts", "eou", "realtime") else "other", metrics=measured(mapped), **context)

        listen("conversation_item_added", conversation)
        listen("function_tools_executed", tools)
        listen("agent_state_changed", lambda e: self.emit("state", at=e.created_at, state=e.new_state, **correlation()))
        listen("error", error)
        listen("metrics_collected", metric)

    def record_span(self, span):
        attrs = span.attributes or {}
        name = span.name
        lower = name.lower()
        stage = "realtime" if "realtime" in lower else "llm" if "llm" in lower else "tts" if "tts" in lower else "stt" if "stt" in lower else "tool" if "tool" in lower else "session" if name == "agent_session" else "turn" if any(k in lower for k in ("turn", "speaking", "eou")) else "other"
        values = {}
        for src, target in [("lk.response.ttft", "llm_node_ttft"), ("lk.response.ttfb", "tts_node_ttfb"), ("lk.e2e_latency", "e2e_latency"), ("lk.transcription_delay", "transcription_delay"), ("lk.end_of_turn_delay", "end_of_turn_delay"), ("gen_ai.usage.input_tokens", "input_tokens"), ("gen_ai.usage.output_tokens", "output_tokens")]:
            if src in attrs:
                values[target] = attrs[src]
        context = {"traceId": format(span.context.trace_id, "032x"), "spanId": format(span.context.span_id, "016x")}
        turn = attrs.get("lk.generation_id") or attrs.get("lk.speech_id") or attrs.get("lk.turn_id")
        if isinstance(turn, str):
            context["turnId"] = turn
        parent = format(span.parent.span_id, "016x") if span.parent and span.parent.span_id else None
        status = getattr(span.status.status_code, "name", "UNSET").lower()
        self.emit("span", id="span_" + context["traceId"] + context["spanId"], at=span.start_time / 1e9, end=span.end_time / 1e9,
                  name=name[:200], stage=stage, status=status if status in ("error", "ok") else "unset", parentSpanId=parent,
                  interrupted=attrs.get("lk.interrupted") is True, metrics=measured(values), **context)

    def configure_tracing(self, provider=None):
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExportResult
        from livekit.agents.telemetry import set_tracer_provider
        collector = self

        class Exporter:
            def export(self, spans):
                for span in spans:
                    collector.loop.call_soon_threadsafe(collector.record_span, span)
                return SpanExportResult.SUCCESS

            def shutdown(self):
                pass

            def force_flush(self, timeout_millis=30000):
                return True

        self.provider = provider or TracerProvider()
        self.provider.add_span_processor(SimpleSpanProcessor(Exporter()))
        set_tracer_provider(self.provider)

    def capture_logs(self):
        collector = self
        prefixes = [p.strip() for p in os.environ.get("AGENT_TELEMETRY_LOGGERS", "livekit.agents").split(",") if p.strip()]

        class Handler(logging.Handler):
            def emit(self, record):
                if not any(record.name == p or record.name.startswith(p + ".") for p in prefixes) or "console_telemetry" in record.name or "agent_live_telemetry" in record.name:
                    return
                try:
                    fields = {"at": record.created, "level": record.levelname, "message": record.getMessage()[:4000], "logger": record.name[:200], **correlation()}
                    collector.loop.call_soon_threadsafe(lambda: collector.emit("log", **fields))
                except Exception:
                    collector.dropped += 1

        self.log_handler = Handler(logging.INFO)
        logging.getLogger().addHandler(self.log_handler)

    async def close(self):
        async with self.close_lock:
            if self.closed:
                return self.dropped == 0
            self.closing = True
            if self.quality_collector:
                try:
                    await asyncio.wait_for(self.quality_collector.close(), 8)
                except Exception:
                    logger.warning("Connection quality collector could not finish")
            self.wake.set()
            for session, event, callback in self.listeners:
                session.off(event, callback)
            if self.log_handler:
                logging.getLogger().removeHandler(self.log_handler)
            if self.provider:
                await asyncio.to_thread(self.provider.force_flush, 3000)
                await asyncio.sleep(0)  # Drain span exporter callbacks queued from other threads.
            if self.task:
                try:
                    await asyncio.wait_for(self.task, 8)
                except asyncio.TimeoutError:
                    pass
            self._usage()
            while self.queue or self.pending:
                if not await self.flush():
                    self.dropped += len(self.queue) + (len(self.pending[1]) if self.pending else 0)
                    self.queue.clear()
                    self.pending = None
                    break
            terminal = {"id": uuid.uuid4().hex, "kind": "collection", "at": time.time(), "state": "incomplete" if self.dropped else "complete", "expectedCount": self.total, "droppedCount": self.dropped}
            accepted = await self._send(json.dumps(self._envelope([terminal]), allow_nan=False).encode())
            self.closed = True
            return accepted and self.dropped == 0


def start_collection(ctx, agent_name, send, *, tracer_provider=None):
    if os.environ.get("AGENT_TELEMETRY_EVENTS_ENABLED") != "true":
        return None
    if getattr(ctx, KEY, None) is not None:
        return getattr(ctx, KEY)
    version = importlib.metadata.version("livekit-agents")
    collector = SessionTelemetry(ctx, agent_name, send, sdk_version=version)
    setattr(ctx, KEY, collector)
    try:
        collector.configure_tracing(tracer_provider)
    except (ImportError, AttributeError):
        collector.dropped += 1
        logger.warning("Console OpenTelemetry integration unavailable")
    if os.environ.get("AGENT_LOGS_ENABLED") == "true":
        collector.capture_logs()
    if os.environ.get("AGENT_QUALITY_ENABLED") == "true":
        try:
            try:
                from .connection_quality import attach_quality
            except ImportError:
                from connection_quality import attach_quality
            collector.quality_collector = attach_quality(ctx.room, send, reporter_id="agent:" + ctx.job.id)
        except Exception:
            logger.warning("Connection quality integration unavailable")
    collector.emit("collection", state="receiving", droppedCount=0)
    return collector


def attach_session(ctx, session, *, mode=None):
    collector = getattr(ctx, KEY, None)
    if collector:
        collector.attach(session, mode=mode)
    return collector
