# Contributing

Thanks for helping improve LiveKit Console. Bug reports, ideas and pull requests are all welcome. Please follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Report a bug or ask for a feature
Open an [issue](https://github.com/unpod-ai/livekit-console/issues/new/choose) and use the template. For a bug, include the console version (commit), how
you run it (Docker, `npm start`, VM), your LiveKit server version, what you expected and what happened. Remove API
keys, secrets, phone numbers and hostnames from anything you paste. For security problems, see
[SECURITY.md](SECURITY.md) and do not open a public issue.

For setup questions and general ideas, use [Discussions](https://github.com/unpod-ai/livekit-console/discussions).
See the [roadmap](ROADMAP.md) and [good first issues](https://github.com/unpod-ai/livekit-console/labels/good%20first%20issue)
for places to help. Comment on an issue before starting substantial work so contributors can coordinate.

## Set up
Requirements: Node.js 22.13 or newer and a LiveKit server to point at (see [docs/getting-started.md](docs/getting-started.md)).
```bash
cp .env.example .env     # fill in LIVEKIT_URL, the API key/secret, ADMIN_USER, ADMIN_PASSWORD, SESSION_SECRET
npm install
npm run dev              # UI on :5173 (proxies /api), server on :8080
```
No LiveKit server handy? `server/scripts/simulate-webhooks.ts` seeds demo history:
```bash
cd server && npx tsx --env-file=../.env scripts/simulate-webhooks.ts http://localhost:8080 6
```

## Make a change
1. Fork the repo and create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Match the surrounding code: TypeScript, plain CSS (the theme tokens are in `web/src/styles.css`), small components.
4. Check it builds and type-checks: `npm run build`. CI runs the same.
5. Try it in a browser. If you change a page, say which pages you checked.
6. Update the docs in `docs/` and the README when behavior or configuration changes.
7. Open a pull request using the template.

## Guidelines
- Never commit `.env`, `.env.deploy`, databases or real credentials. Use fictional data in examples, tests and
  screenshots (for example `+1 415 555 0100`).
- Do not show data a self-hosted LiveKit server doesn't expose. The console says so instead of faking it.
- Write commit messages that say why, in the imperative ("Add worker outage history").
