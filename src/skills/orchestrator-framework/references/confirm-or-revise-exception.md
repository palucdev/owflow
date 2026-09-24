# Confirm-or-Revise Exception

Extension of the [Gate Contract](gate-contract.md) for utility skills with explicit no-follow-up contracts — currently `agents-md-generator` and `rule-reviewer`.

## Rule

The standard Exit Gate's results-acceptance question offers four options (Accept / Adjust / Discuss / Stop). Utility skills whose whole purpose is to produce a single artifact and stop **narrow this to confirm-or-revise only**:

- **Confirm** — the artifact is good; end the skill.
- **Revise** — user specifies what to change; re-work only the affected parts of the artifact, then re-present it and re-ask.

## What stays prohibited

- No follow-up suggestions, "next steps" hints, or "Other options" blocks after Confirm.
- No auto-chaining into other skills or workflows.
- Follow-up work happens only if the user explicitly asks for it.

## Why

Utility skills end their contract with the artifact itself — there is no pipeline to continue — so offering pipeline-style next steps would imply a workflow that does not exist.
