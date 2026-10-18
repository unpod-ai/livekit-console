# Security policy

## Reporting a vulnerability
Please do not open a public issue. Use **Report a vulnerability** under this repository's
[Security tab](https://github.com/unpod-ai/livekit-console/security/advisories/new) to send a private report to the maintainers. Include what you found,
how to reproduce it, and the impact. You should get a first reply within a few days.

## What to report
For example: authentication or role bypass, leaking the LiveKit API key/secret or egress storage credentials to the
browser, injection, or unsafe handling of webhooks.

## Supported versions
Only the latest commit on `main` is supported.

## Deploying safely
The console holds your LiveKit API key and secret. Run it behind HTTPS, restrict who can reach it (for example the IP
allowlist from `./deploy.sh https`), use a long random `SESSION_SECRET`, and keep `.env` out of version control.
