# Persistent agent and worker inventory

Agent names, worker endpoint samples and native worker IDs describe different things. The console assigns stable
console agent/worker IDs, labels them separately from native IDs and keeps the inventory after raw status samples
expire. An inactive agent remains discoverable even when it served no sessions in the selected range.

## Names and aliases

The agent detail page includes a stable identity and its observed names. An administrator can link a previous name
or explicitly merge the existing identity for that name. Linking requires confirmation of the existing source
identity; collisions are not silently overwritten. The prior console ID resolves to the canonical identity, and
original participant attributes, reports, jobs and metrics retain their source names.

Session filters, recent sessions, session counts and retained model usage under a stable identity include its linked
aliases. Source-name performance comparisons remain explicitly named populations. Endpoint reuse by a differently
named agent does not, by itself, authorize merging those agent identities.

## Worker identity and lifecycle

Native `AW_` IDs are stored when actually reported. A changed native ID or configured instance marker creates a new
archived inventory entry. If no native ID is reported, the console records an endpoint/agent observation: it cannot
prove when an anonymous worker process restarted. Last reported IDs have their own observation timestamp and are not
presented as a current registration guarantee.

First observation, last check, last healthy response, archived state and safe deployment metadata persist separately
from short-lived raw samples. Removed endpoints remain archived. Historical jobs and sessions link to workers only
when a native worker ID matches; an agent name alone does not assign a job to a particular worker instance.

The UI distinguishes endpoint availability, valid worker information, reported readiness/registration and job count.
A successful health request does not establish registration, room membership or readiness to accept another job.
Unknown fields stay unknown and stale checks cannot establish a currently healthy worker.

## Collection and retention

`AGENT_WORKER_URLS` continues to configure trusted status endpoint base URLs. `AGENT_WORKER_METADATA` optionally maps
those exact URLs to safe configured metadata (`instanceKey`, `image`, `version`, `environment`, `region`, `host`). It
must be updated by your deployment integration when that metadata changes; it is not automatic Docker discovery.
Never include environment variables or secrets in this metadata. A configured instance key distinguishes deployments
that cannot report a native worker ID.

Raw check samples remain available for 14 days. Hourly rollups retain successful/failed check counts and reported
load sums/counts under `WORKER_ROLLUP_RETENTION_DAYS` (default 365, configurable 14–3650). Availability percentages
measure sampled checks, not continuous uptime. Missing load is not zero. Hourly rollup windows include rounded hour
boundaries; the current partial hour contains only received checks. Retention gaps are not interpolated.

Existing retained samples and observed agent names are backfilled without inventing already-expired process history.
Inventory records survive rollup expiry. All stores are included in the console SQLite database and the same backup/
restore procedure. The identity-linking API is administrator-only; inventory reads follow existing authenticated
history access and contain metadata, not transcripts or credentials.
