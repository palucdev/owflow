---
name: quick-plan
description: Enter planning mode with AI SDLC standards awareness
---

# Planning Mode with Standards Awareness

Enter OpenCode's planning mode for a task, with automatic discovery of project standards from `.owflow/docs/`.

## Usage

```bash
/quick-plan [task description]
```

## Examples

```bash
/quick-plan "Add user authentication with email/password"
/quick-plan "Refactor the payment processing module"
/quick-plan
```

---

## Workflow

### Step 1: Parse Input

**Get the task description:**

- If provided as argument, use it directly
- If not provided, use question to prompt:
  ```
  "What would you like to plan? Please describe the task or feature."
  ```

### Step 1b: Create Task Directory

**Create a lightweight task directory for artifact anchoring.**

1. Generate a task name from the task description:
   - Extract 3–5 key words, convert to lowercase kebab-case
   - Prepend today's date: `YYYY-MM-DD-kebab-name`
   - Examples: "Add retry logic to API client" → `2026-05-28-add-api-retry-logic`, "Refactor the payment processing module" → `2026-05-28-refactor-payment-module`
2. Create directory: `.owflow/tasks/quick-plan/YYYY-MM-DD-task-name/`
3. Create `analysis/` subdirectory inside it
4. Write `task.yml` with initial state using the template [src/templates/quick-plan-task.yml](../templates/quick-plan-task.yml).
5. **CRITICAL**: Use the `verify_template` tool immediately after creation to check YAML validity against `quick-plan-task.yml`.

### Step 2: Discover and Read Standards (BEFORE Plan Mode)

**CRITICAL: This step MUST complete before calling Plan Agent.**

1. **Check if `.owflow/docs/INDEX.md` exists**
   - **If not exists**: Note that no standards are available, skip to Step 3
   - **If exists**: Continue with discovery below

2. **Read INDEX.md** to understand available standards and documentation

3. **Identify applicable standards** based on:
   - The categories and files listed in INDEX.md
   - The nature of the task being planned
   - Keywords and patterns in the task description (e.g., "API" → api standards, "form" → validation standards, "upload" → file-handling standards)

4. **READ the actual standard files** using the Read tool — reading INDEX.md alone is NOT sufficient

5. **Summarize key guidelines** from each standard file read — these will carry into plan mode as context
6. **Update `task.yml`**: Add paths of standards read to `standards_applied` list

### Step 2b: Write Findings

**After standards discovery, write `analysis/findings.md`** in the task directory:

```markdown
# Task Analysis

## Context
[What was analyzed to inform the plan — codebase areas explored, existing patterns found]

## Key Decisions
[Architectural or implementation decisions made during planning]

## Standards Referenced
- [standard file]: [key guideline applied]
```

### Step 3: Enter Planning Mode

**Use the `Plan agent` to trigger OpenCode's builtin planning mode.**

**Standards context from Step 2 MUST actively inform all plan mode phases:**

- **Phase 1 (Explore)**: When launching Explore agents, include in the prompt: "The following project standards apply to this task: [list standard files and key guidelines from Step 2]. Verify how the existing codebase follows these standards."
- **Phase 2 (Plan)**: When launching Plan agents, include in the prompt: "Apply these project standards in your implementation plan: [list standard files and key guidelines from Step 2]. Each implementation step must conform to these standards."
- **Phase 4 (Final Plan)**: The plan file must incorporate standards into the implementation steps themselves, not just list them in a separate section.

The planning mode will:

1. Launch Explore agents to understand the codebase (with standards context)
2. Launch Plan agents to design implementation approach (with standards constraints)
3. Review and verify alignment with user intent
4. Write final plan to plan file (with standards woven into steps)
5. Ask for user approval (gated on mandatory standards sections)

### Approval question gate: Mandatory Standards Sections

**BLOCKING: Do NOT call ask user for approval until the plan file contains these sections:**

1. **"## Applicable Standards"** — list each standard file that was read, with key guidelines extracted from each. If no standards exist, state: "No AI SDLC standards found. Consider running `/flow-init`."

2. **"## Standards Compliance Checklist"** — checkboxes for each applicable standard guideline that implementation must follow. Example:
   ```markdown
   - [ ] API endpoints follow REST naming conventions (from `standards/backend/api.md`)
   - [ ] Error responses use standard error format (from `standards/backend/api.md`)
   - [ ] New components use TypeScript strict mode (from `standards/frontend/components.md`)
   ```

If these sections are missing from the plan file, add them before asking user for approval.

### Graceful Fallback

**If `.owflow/docs/` does not exist:**

Continue with planning mode normally. The "Applicable Standards" section in the plan should note:

```
No AI SDLC standards found. Consider running `/flow-init` to initialize
project documentation and coding standards for better consistency.
```

## What This Does

1. **Parses** task description from user input
2. **Creates** lightweight task directory with `task.yml` for artifact anchoring
3. **Discovers and READS** applicable standard files from `.owflow/docs/` (BEFORE plan mode)
4. **Writes** `analysis/findings.md` with task context and key decisions
5. **Enters** OpenCode's builtin planning mode via delegating to `Plan Agent` with standards already loaded
6. **Produces** a plan file with implementation approach, applicable standards, and compliance checklist
7. **Gates** Approval question on mandatory standards sections in the plan file
8. **Updates** `task.yml` with `status: completed` and `plan_path` after plan approval

## Benefits Over Manual Planning

- Automatic standards discovery and integration
- Standards read BEFORE planning begins (not as an afterthought)
- Plan file for review before implementation
- Standards compliance checklist built into the plan

## After Planning

Once the plan is approved:

- **Update `task.yml`**: set `status: completed`, `plan_path: [path to plan file]`, `updated: [now]`
- Implementation begins based on the plan
- Standards are applied during coding

## Post-Implementation Verification

After implementation is complete, verify standards compliance using the checklist from the plan:

1. **Review the "Standards Compliance Checklist"** in the plan file
2. **For each checklist item**: verify implementation follows the guideline
3. **Document verification results** (pass/fail for each item)
4. **Address any violations** before marking task complete

This ensures the discovered standards are actually enforced, not just documented.
