# Phase 3 diagnostics implementation plan

> **For agentic workers:** Use superpowers:executing-plans; collector work may run independently with superpowers:dispatching-parallel-agents.

**Goal:** Measured connection quality, service capacity and pre-room SIP diagnostics correlated to existing sessions.
**Architecture:** Authenticated bounded projections into SQLite; admin-only read API and existing React investigation pages; opt-in native SDK and host Docker collectors.
**Tech stack:** TypeScript, Express, node:sqlite, React, Python stdlib and installed LiveKit RTC SDK.
**Spec:** docs/superpowers/specs/2026-10-21-phase3-diagnostics-design.md

## Constraints
No tags/releases/version bumps. No invented measurements or telephone calls. Preserve production worker and private env. No raw headers/credentials/recordings in public evidence.

## Tasks
- [x] 1. Test and implement normalized version-1 diagnostic records, atomic idempotent ingestion, retention and admin read routes.
- [x] 2. Implement/test host service/SIP collector and native RTC quality helper with bounded retry delivery and explicit units/durable IDs.
- [x] 3. Build service diagnostics, SIP attempt timelines and session/participant track charts with working links, missing-state copy and filters.
- [ ] 4. Review, run full tests/build and browser acceptance; deploy collectors privately, verify native quality/degradation and pre-room failure against existing live system.
- [ ] 5. Merge protected CI-passing PR, deploy, repeat live health/navigation checks and update proven checklist acceptance only.

## Shared interface
POST /api/telemetry/diagnostics (service Bearer token): {schemaVersion:1, records:[{id,at,kind:'quality'|'service'|'sip', ...normalized fields}]}. Timestamps Unix milliseconds. Max 100 records/256KiB. Exact duplicate ID/content succeeds; conflicting content rejects whole batch. GET /api/diagnostics/{services|sip|quality} uses admin login; quality requires roomSid plus optional participantSid/trackSid; SIP supports callId, roomSid, participantSid, query and pagination; reads use from/to and retained rows only. Details documented in the implementation guide.
