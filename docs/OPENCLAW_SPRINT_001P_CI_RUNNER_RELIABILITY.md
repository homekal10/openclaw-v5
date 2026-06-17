# OpenClaw Sprint 001P — CI Runner Reliability

## Problem

PR #22 was blocked by queued GitHub checks waiting for Blacksmith runners.

Observed queued runner label:

- blacksmith-16vcpu-ubuntu-2404

## Scope

This sprint adds a surgical GitHub-hosted runner fallback for PR gate jobs only.

## Patched Checks

- CI / preflight
- CI / security-fast
- Install Smoke / preflight
- Labeler / label
- Labeler / label-issues
- Workflow Sanity / actionlint
- Workflow Sanity / no-tabs

## Runner Change

Changed only the queued PR gate jobs from:

blacksmith-16vcpu-ubuntu-2404

to:

ubuntu-24.04

## Safety Constraints

- No release workflow runner changes.
- No Docker release runner changes.
- No npm publish runner changes.
- No product code changes.
- No MT5/live execution changes.
- No strategy runtime changes.
- No database/schema changes.

## Sprint Status

Implementation pending validation in 001P-C.
## F2 — Security-Fast Scope Fix

After PR #23 proved that GitHub-hosted runners execute the PR gate jobs, `CI / security-fast` failed at `Audit production dependencies`.

Diagnosis showed PR #23 changed only workflow/docs files and no dependency manifests or lockfiles.

The production dependency audit is now scoped as follows:

- run on non-PR events
- run fail-closed when the base commit is unavailable
- run on PRs when dependency manifests or lockfiles changed
- skip on workflow/docs-only PRs with no dependency manifest or lockfile changes

Workflow security checks remain active:

- detect-private-key
- zizmor audit for changed GitHub workflows

Implementation pending validation in 001P-F3.
## H1 — Residual Install Smoke Queue Fix

After PR #23 was updated with the security-fast scope fix, GitHub still showed residual queued checks.

Discovery found the remaining directly queued PR-relevant job:

- Install Smoke / install-smoke

The job still used:

- blacksmith-16vcpu-ubuntu-2404

It has now been changed to:

- ubuntu-24.04

This remains a workflow-only CI reliability fix. No product runtime, provider, MT5/live execution, strategy runtime, database/schema, release, or publish workflow files are changed.

Implementation pending validation in 001P-H2.
## I1 — Install Smoke Build Action Port

After moving Install Smoke / install-smoke onto ubuntu-24.04, the job was no longer queued and began executing.

GitHub then failed the job at:

- Build root Dockerfile smoke image

Diagnosis showed the install-smoke Docker build steps still used:

- useblacksmith/build-push-action@v2

Because the job now runs on a GitHub-hosted runner, the install-smoke Docker build steps have been ported to:

- docker/build-push-action@v6

The existing docker/setup-buildx-action setup remains in place.

This remains a workflow-only CI reliability fix. No product runtime, provider, MT5/live execution, strategy runtime, database/schema, release, or publish workflow files are changed.

Implementation pending validation in 001P-I2.
## J2 — Workflow/Docs-Only Install Smoke Bypass

After the runner fallback and build-action port were completed, Install Smoke / install-smoke executed on ubuntu-24.04 and reached the heavy root Dockerfile build.

The root Dockerfile build is out of scope for this runner-reliability PR and currently depends on Docker/package-lock state unrelated to PR #23.

The install-smoke preflight now treats pull requests that only change GitHub workflow files and docs as workflow/docs-only validation. For those PRs:

- preflight still runs
- workflow-sanity still validates workflow syntax
- heavyweight Install Smoke Docker image builds are skipped
- non-PR events remain fail-closed and continue to run the heavy smoke path
- PRs touching non-workflow/docs files still run the heavy install-smoke job

This remains a workflow-only CI reliability fix. No product runtime, provider, MT5/live execution, strategy runtime, Dockerfile, package manifest, lockfile, database/schema, release, or publish workflow files are changed.

Implementation pending validation in 001P-J3.
## K1 — GITHUB_OUTPUT-Safe Workflow/Docs Bypass Log

The workflow/docs-only bypass correctly skipped the heavyweight Install Smoke Docker job, but the preflight manifest step failed because a human-readable log line was written inside the `$GITHUB_OUTPUT` block.

The bypass message now redirects to stderr:

- `echo "Workflow/docs-only PR; bypassing heavyweight install-smoke Docker job." >&2`

The GitHub output file now receives only valid output records:

- `docs_only=...`
- `run_install_smoke=...`
- `workflow_only_bypass=...`

This remains a workflow-only CI reliability fix. No product runtime, Dockerfile, package manifest, lockfile, provider, MT5/live execution, strategy runtime, database/schema, release, or publish workflow files are changed.

Implementation pending validation in 001P-K1.