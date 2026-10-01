## Error Handling

### Prefixed Errors, Graceful Degradation, Tool Outputs
Fail fast on the plugin's own contracts with `Error` messages carrying machine-readable prefixes (`INVALID_NAME:`, `INVALID_SOURCE:`, `UNKNOWN_STEP:`, `NAME_TAKEN:`, `Blocked:`). Degrade gracefully on optional or external input — skip with a warning or return an empty result/sentinel rather than crashing. `tool()` handlers never throw; they catch and return `{ output }`. When a returned error is meant to drive agent behavior (tool outputs, hook blocks, subagent reports), include an actionable `Hint:` describing the expected next action.
