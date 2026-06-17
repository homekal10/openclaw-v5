# OpenClaw Sprint 001Q — CI Main Health and Release Hygiene

## Status

In progress.

## Scope

Sprint 001Q continues the CI reliability work after PR #23 by removing remaining Blacksmith runner dependencies from active workflow jobs on the clean post-merge main baseline.

## Base

Started from PR #23 merge commit:

`b6c008a0936b223aef57f9d7d170bf38a0435005`

## Allowed files

- `.github/workflows/ci.yml`
- `.github/workflows/labeler.yml`
- `.github/workflows/workflow-sanity.yml`
- `docs/OPENCLAW_SPRINT_001Q_CI_MAIN_HEALTH_RELEASE_HYGIENE.md`

## Safety constraints

This sprint must not modify product/runtime code, Docker configuration, dependency manifests, lockfiles, providers, scripts, execution code, MT5 code, strategy code, dashboard code, logs, data, or environment files.

## Change summary

- Replaced remaining Ubuntu Blacksmith runner references with `ubuntu-24.04`.
- Replaced remaining Windows Blacksmith runner reference with `windows-2025`.
- Kept the change workflow-only and documentation-only.
- No product, runtime, Docker, dependency, provider, script, strategy, MT5, execution, dashboard, data, log, or environment file changes are included.

## Validation plan

- Confirm only the approved workflow and documentation files changed.
- Confirm no remaining `runs-on: blacksmith...` references exist in the patched workflows.
- Confirm `install-smoke.yml` remains untouched.
- Run patch checks and no-tab checks.
- Push only to `deploy` after local validation passes.
- Open a PR from the Sprint 001Q branch to `main`.
- Merge only through GitHub UI after checks are reviewed.