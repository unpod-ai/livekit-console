# Single-server console cleanup

User explicitly chose “Remove projects; keep one server.” Remove the project abstraction rather than add project
creation. This supersedes Phase 5's multi-project requirement; retain Operations, retention, alerting, audit, account
roles and sensitive-content permissions, plus the unfinished Phase 6 work. No theme/version/tag/release changes.

1. Replace multi-process gateway with one application. Remove project routing/configuration/identity assertions.
2. Migrate canonical users, roles, default content grants and relevant audit records from the previous control SQLite
   store into the single application database, once and atomically. Preserve IDs/passwords/cookies; don't grant broader
   roles from former project memberships. Retain original files for rollback and consistent backups before deployment.
3. Enforce account permissions and audited operations directly. Keep content grants independent from admin/viewer role.
4. Remove selector, project access settings, project query parameters and scoped resource URLs from all UI flows.
5. Make the new deployment helper single-console with one token and target allowlists, and test room ownership without
   a project identifier. Preserve isolated graceful-drain and transport testing.
6. Remove obsolete docs/settings/tests; replace with single-server migration, permission/audit and browser coverage.
7. Run fresh full regressions/build/review, isolated Docker/RTC checks, protected merge, deploy and live acceptance.

Ownership: parent startup/auth/audit/app/config/users/deployments/docs/integration; existing UI worker web/**;
backend worker only single-server-migration module/tests; helper worker helper/installer/fixture/tests.

Acceptance: completed through protected PR #26. Single-server UI/API removal, direct account grants/audit, canonical
account migration, retained history/private recording playback, responsive views, test scenarios, snapshot integrity
and worker/collector health all verified live. No releases.
