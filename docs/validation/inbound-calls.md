# Inbound-call acceptance procedure

Use a provider test number under your control. Keep credentials, phone numbers, production identifiers, recording
URLs, conversation content and operational measurements outside public reports.

## Routing and lifecycle

1. Place or select a completed real inbound call; exclude simulator fixtures.
2. Confirm the call references the intended inbound trunk and dispatch rule.
3. Confirm the room contains the agent configured by that rule.
4. Check that the console API associates the same session, call, SIP participant, agent and egress record.
5. Check participant departure, room finish and final egress completion events.
6. Check positive call/session/recording durations against their own start/end timestamps.

Call duration measures SIP participant presence, session duration measures room lifetime, and recording duration
measures the egress interval. These need not match and do not establish provider-billed duration.

## Browser navigation

Sign in through the deployed console's normal login form and follow:

- Session → call → session.
- Session → egress → session.
- Session → SIP participant → session.
- Session → agent → Sessions tab → original session.
- Call → inbound trunk and call → dispatch rule.

Check that the destination identifies the original resource and that no browser JavaScript errors occur.

## Private recordings

Confirm anonymous object access is denied. Then use authorized storage access to retrieve the recording and
verify that a media decoder can read the full audio file. Keep media and storage credentials outside the repository.
Also verify that unauthenticated console history requests are denied.

Storage authorization and audio decoding do not establish in-console playback, conversation quality or transcript
synchronization. A console login cookie is not a storage credential; private playback needs signed access or a
controlled streaming path.
