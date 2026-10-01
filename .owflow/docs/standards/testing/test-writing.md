## Test Writing

### Test Behavior
Focus on what code does, not how it does it, to allow safe refactoring.

### Clear Names
Use descriptive names explaining what's tested and expected (`shouldReturnErrorWhenUserNotFound`).

### Mock External Dependencies
Isolate tests by mocking databases, APIs, and external services.

### Fast Execution
Keep unit tests fast (milliseconds) so developers run them frequently.

### Risk-Based Testing
Prioritize testing based on business criticality and likelihood of bugs.

### Balance Coverage and Velocity
Adjust test coverage based on project needs and team workflow.

### Critical Path Focus
Ensure core user workflows and critical business logic are well-tested.

### Appropriate Depth
Match edge case testing to the risk profile of the code.

### TDD Red Gate First
A reproducible defect must pass through a TDD red gate (a failing test that reproduces it) before any implementation work. Quick lanes (`--quick`, `dev-bugfix`) never bypass the red gate.

### Incremental Verification of New Tests
After each task group, run only the newly added tests — not the entire suite. The full suite runs only at the comprehensive pre-commit verification gate.

### Full Suite and Verification Report Before Commit
Before code review or commit, run the full test suite and produce a verification report. Failed iterations loop within the per-subskill retry budgets (dev-verify: 3, dev-finalize: 3).

### Behavior-Descriptive Test Names
Name tests as behavior statements about the unit, preferably with a "should …" prefix; remaining names state the scenario or contract directly.
