# Phase 4 inventory implementation plan

> **For agentic workers:** Use superpowers:executing-plans and scoped parallel implementation/review.

**Goal:** Retain agent identity, aliases and worker history beyond raw health samples.
**Architecture:** SQLite inventory/alias/archive tables and hourly rollups; polling records durable observations; existing history APIs resolve aliases and React agent detail exposes inventory without a global workers page.
**Tech stack:** TypeScript, node:sqlite, Express, React.
**Spec:** docs/superpowers/specs/2026-10-21-phase4-inventory-design.md

## Constraints
No tags/releases or version bumps. Do not infer identity from endpoint reuse, fabricate native IDs or claim registration from sampled health. Keep production agent names unchanged during tests. Preserve existing deployment credentials and private evidence.

## Tasks
- [x] 1. Test/implement durable agent aliases, explicit identity links, worker archives, native identity transitions, legacy backfill and bounded hourly rollup retention.
- [x] 2. Integrate polling and alias-aware history/session/usage queries; preserve actual source names and stable IDs across restart/removal.
- [x] 3. Add agent-scoped inventory, lifecycle/metadata and long-range rollup views, native-ID job/session links and admin alias linking.
- [x] 4. Review and verify full tests/build/browser; prove rename/restart/sample expiry in isolation and inspect live retained history without disrupting production.
- [x] 5. Merge protected PRs, back up/deploy, verify live healthy inventory and update both checklists. No release.

Verified: 74 server tests, 44 Python tests, production builds and eight isolated Chrome checks passed. Protected PR #21 merged and the POC deployment passed authenticated browser checks for current/archived agents, retained rollups, independent 90-day selection, historical navigation and mobile width. Anonymous reads were denied. A fresh backup retained all four inventory/alias/worker/rollup tables, passed SQLite integrity checks and contained no orphan worker identities. No release or production agent rename was performed.
