"""Call upload_session_report(ctx, agent_name) from your Python AgentServer on_session_end callback."""

import asyncio
import json
import logging
import os
import urllib.error
import urllib.request

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
        body = json.dumps({
            "schemaVersion": 1,
            "agentName": agent_name,
            "report": ctx.make_session_report().to_dict(),
        }, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError):
        logger.warning("Console report could not be serialized")
        return False

    def send() -> None:
        request = urllib.request.Request(
            console_url + "/api/telemetry/session-reports",
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
                logger.warning("Console report upload rejected (HTTP %s)", exc.code)
                return False
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        if attempt == 0:
            await asyncio.sleep(0.5)
    logger.warning("Console report upload failed after two attempts")
    return False
