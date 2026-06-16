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