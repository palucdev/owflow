# Fix Loop Contract — User-Driven Fix-Then-Reverify

Shared contract for skills that resolve verification issues together with the user. It pins the option wording, iteration budget, state-write cadence, and exit conditions so each applying skill describes only its workflow-specific deltas instead of restating the loop.

**Applies to**:

- `dev-verify` — the `verification-done` step after `implementation-verifier` returns `passed_with_issues` or `failed`
- `migration-fix` — when the verification state facts say fixable issues remain (`issues-resolved`)

Skills that use the loop MUST reference this file and document only their deltas in the "Workflow-Specific Deltas" section.

---

## Loop (max 3 iterations)

1. **Display the detailed issue breakdown** grouped by category and severity, with location, description, and fixability.
2. **Present critical + warning issues as a numbered list.** Info issues are listed for awareness, not actionable.
3. **Ask via `question`** — "Which issues should I fix?" with exactly three options:
   - **"Fix all fixable issues"**
   - **"Let me choose specific issues"**
   - **"Skip fixes, proceed as-is"**
4. **Fix the selected issues directly.** Immediately after each fix, append it to `verification_context.fixes_applied` in state — never defer to the end of the loop. Bump `orchestrator.updated`; re-read the state file + run `verify_template`.
5. **After fixes, set `options.skip_test_suite: false`** (code changed — the suite must re-run on re-verification).
6. **Ask via `question`** — "Re-run verification to check fixes?" with options:
   - **"Yes, re-run verification"** → re-invoke `implementation-verifier` (Skill tool), then **immediately** update `verification_context.reverify_count` and refresh `verification_context.last_status` + `issues_found` from the verifier's structured return; return to step 1.
   - **"No, proceed to next phase"** → exit the loop to the Exit Gate.
7. **Record each user decision** (specific selection, proceed-with-warnings, deliberate skip) in `verification_context.decisions_made`.

The loop is capped at **3 iterations**; at the cap, the question in "Exit Conditions" decides the outcome.

---

## Exit Conditions

| Condition | Action |
| --------- | ------ |
| ✅ No critical issues remain | Append the skill's success slug and proceed. |
| ⚠ Max 3 iterations reached | `question` — "Proceed with known issues?" / stop-or-rollback option. Proceed ⇒ append the success slug with the approval recorded in `decisions_made`; stop/rollback ⇒ do NOT append, record the decision. |
| Deliberate skip ("Skip fixes, proceed as-is") | A user-chosen skip, not a failure: no success slug, no failure entry; record the reason in `phase_summaries.<fix>.summary` + `decisions_made`. |
| ❌ Critical issues remain unresolved | **MUST NOT proceed without explicit user approval.** |
| Verifier itself fails | Do NOT append the success slug; append it to `orchestrator.failed_phases` and increment `auto_fix_attempts["<slug>"]`. |

---

## State Writes (per iteration, never batched)

- `fixes_applied` — after every fix.
- `reverify_count` + refreshed `last_status` / `issues_found` — right after each verifier run.
- `decisions_made` — after each user decision.
- The success slug — only when the loop settles (✅, or an approved ⚠); never on a deliberate skip or a failure.

**Single-writer split**: the verification step owns the initial `last_status` / `issues_found`; the fix loop owns `fixes_applied`, `reverify_count`, `decisions_made`, plus the re-verify refresh of `last_status` / `issues_found`.

---

## Workflow-Specific Deltas

### Development (`dev-verify`)

None beyond this contract.

### Migration (`migration-fix`)

- **Compatibility verdict invalidation**: after fixes, set `verification_context.compatibility_status: null` (field-level fail-closed exception — the compatibility checks ran against pre-fix code). Only `migration-verify` may set a new verdict; when it is not `passed`, the required next step is `/owflow:migration-verify <task-path>`, never finalize.
- **Data-integrity HALT**: data-integrity issues are NEVER auto-fixed. HALT, present the rollback option with the issue, and append the failure entry; rollback happens only on explicit user confirmation — no automatic rollback or revert ever. A deliberate skip cannot waive a data-integrity failure or any non-passed compatibility check.
