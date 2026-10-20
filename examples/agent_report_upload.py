"""Call upload_session_report(ctx, agent_name) from your Python AgentServer on_session_end callback."""

import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.request
import uuid

from livekit.agents import JobContext

logger = logging.getLogger(__name__)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward the service token to a redirect destination.
        return None


async def upload_session_report(ctx: JobContext, agent_name: str) -> bool:
    console_url = os.environ.get("CONSOLE_URL", "").rstrip("/")
    token = os.environ.get("AGENT_TELEMETRY_TOKEN", "")
    if not console_url or not token:
        logger.warning("Console report upload is not configured")
        return False

    # Build once so retries retain the same report timestamp and content.
    try:
        report = ctx.make_session_report()
        payload = report.to_dict()
        if report.model_usage is not None:
            # SDK 1.5.8's to_dict excludes defaults, including the usage discriminator.
            payload["usage"] = [
                {**usage.model_dump(exclude_defaults=True), "type": usage.type,
                 "provider": usage.provider, "model": usage.model}
                for usage in report.model_usage
            ]
        body = json.dumps({
            "schemaVersion": 2,
            "agentName": agent_name,
            "report": payload,
        }, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        logger.warning("Console report could not be serialized")
        return False

    return await _post_telemetry("/api/telemetry/session-reports", body)


async def _post_telemetry(route: str, body: bytes) -> bool:
    console_url = os.environ.get("CONSOLE_URL", "").rstrip("/")
    token = os.environ.get("AGENT_TELEMETRY_TOKEN", "")
    if not console_url or not token:
        return False

    def send() -> None:
        request = urllib.request.Request(
            console_url + route,
            data=body,
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
            method="POST",
        )
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=3) as response:
            response.read()

    for attempt in range(2):
        try:
            await asyncio.to_thread(send)
            return True
        except urllib.error.HTTPError as exc:
            if exc.code < 500 and exc.code != 429:
                logger.warning("Console telemetry upload rejected (HTTP %s)", exc.code)
                return False
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        if attempt == 0:
            await asyncio.sleep(0.5)
    logger.warning("Console telemetry upload failed after two attempts")
    return False


def make_session_log(level: str, message: str, **correlation) -> dict:
    """Build once and retain this entry ID when retrying it in a later batch."""
    entry = {"id": uuid.uuid4().hex, "at": time.time(), "level": level, "message": message}
    for key in ("logger", "turnId", "traceId", "spanId"):
        if key in correlation:
            entry[key] = correlation[key]
    return entry


async def upload_session_logs(ctx: JobContext, agent_name: str, entries: list[dict]) -> bool:
    """Explicit structured logs; no root/process logger or arbitrary exception capture."""
    if os.environ.get("AGENT_LOGS_ENABLED") != "true" or not 1 <= len(entries) <= 100:
        return False
    try:
        body = json.dumps({
            "schemaVersion": 1, "roomSid": ctx.job.room.sid, "jobId": ctx.job.id,
            "agentName": agent_name, "batchId": uuid.uuid4().hex, "entries": entries,
        }, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, AttributeError):
        logger.warning("Console log batch could not be serialized")
        return False
    if len(body) > 256 * 1024:
        logger.warning("Console log batch exceeds 256 KiB")
        return False
    return await _post_telemetry("/api/telemetry/logs", body)


def register_shutdown_report(ctx: JobContext, agent_name: str) -> bool:
    """For legacy workers whose SDK finalizes AgentSession before shutdown callbacks (verified on 1.5.8)."""
    if not os.environ.get("CONSOLE_URL") or not os.environ.get("AGENT_TELEMETRY_TOKEN"):
        return False

    collector = None
    if os.environ.get("AGENT_TELEMETRY_EVENTS_ENABLED") == "true":
        try:
            if __package__:
                from .agent_live_telemetry import start_collection
            else:
                from agent_live_telemetry import start_collection
            collector = start_collection(ctx, agent_name, _post_telemetry)
        except Exception as exc:
            logger.warning("Console live collection unavailable (%s)", type(exc).__name__)

    log_start = asyncio.create_task(upload_session_logs(ctx, agent_name, [make_session_log("INFO", "Agent job started")])) if os.environ.get("AGENT_LOGS_ENABLED") == "true" else None

    async def export_report() -> None:
        try:
            if await upload_session_report(ctx, agent_name):
                logger.info("Console agent session report uploaded")
        except Exception as exc:
            # Telemetry must not prevent application cleanup, including for non-AgentSession handlers.
            logger.warning("Console report callback unavailable (%s)", type(exc).__name__)

    async def export_logs() -> None:
        if log_start is None:
            return
        try:
            await log_start
            await upload_session_logs(ctx, agent_name, [make_session_log("INFO", "Agent job shutdown")])
        except Exception as exc:
            logger.warning("Console log callback unavailable (%s)", type(exc).__name__)

    async def export_after_session() -> None:
        await asyncio.gather(export_report(), export_logs())
        if collector:
            try:
                await collector.close()
            except Exception as exc:
                logger.warning("Console live collection cleanup unavailable (%s)", type(exc).__name__)

    ctx.add_shutdown_callback(export_after_session)
    return True
