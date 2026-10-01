## Error Handling

### Clear User Messages
Show helpful, actionable messages without exposing internal details or security-sensitive information.

### Fail Fast
Validate inputs and check preconditions early; reject invalid data before it causes deeper issues.

### Typed Exceptions
Use specific exception types instead of generic ones to enable precise error handling.

### Centralized Handling
Catch and process errors at appropriate boundaries (controllers, API layers) rather than scattering try-catch throughout.

### Graceful Degradation
When non-critical services fail, continue operating with reduced functionality rather than crashing entirely.

### Retry with Backoff
Use exponential backoff for transient failures when calling external services.

### Resource Cleanup
Always release resources (file handles, connections) in finally blocks or equivalent cleanup mechanisms.

### Prefixed Errors, Graceful Degradation, Tool Outputs
Fail fast on the plugin's own contracts with `Error` messages carrying machine-readable prefixes (`INVALID_NAME:`, `INVALID_SOURCE:`, `UNKNOWN_STEP:`, `NAME_TAKEN:`, `Blocked:`). Degrade gracefully on optional or external input — skip with a warning or return an empty result/sentinel rather than crashing. `tool()` handlers never throw; they catch and return `{ output }`. When a returned error is meant to drive agent behavior (tool outputs, hook blocks, subagent reports), include an actionable `Hint:` describing the expected next action.
