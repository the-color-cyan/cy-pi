# Subagents Async Playbook

## Quick Commands

| Intent | Command |
|--------|---------|
| Run one agent sync (default) | `/run scout "audit auth flow"` |
| Run one agent async | `/run scout "audit auth flow" --bg` |
| Run independent scouts in parallel async | `/parallel scout "frontend pass" -> scout "backend pass" -> scout "test pass" --bg` |
| See active/recent async runs | `/subagents-status` or `subagent_status({ action: "list" })` |
| Attach to a specific async run session | `/subattach <runIdOrPrefix>` |
| Attach to most recent async run session | `/subattach-latest` |
| Return to previous session | `/subback` |

## When Async Is Worth It

| Worth It | Skip It |
|----------|---------|
| Independent scout tasks across modules | Single-file focused edits |
| Parallel implementation lanes with clear boundaries | Tightly coupled changes requiring back-and-forth |
| Bulk reviews across many files | Quick one-off fixes |
| Long-running analysis where latency matters | When total token cost exceeds sync fallback |

## A/B Measurement Protocol

To decide whether async improves outcomes for a workflow, measure:

1. **Time**
   - Record wall-clock time from request to final answer.
   - Async should reduce elapsed time for parallelizable work.

2. **Retries**
   - Count how many subagent reruns or fix passes are needed.
   - More retries may indicate poor task boundaries.

3. **Pass Rate**
   - Mark each run as pass/fail against a checklist.
   - Compare pass rates across sync and async for the same task type.

4. **Token Cost**
   - Sum prompt + completion tokens for all subagents and the parent.
   - Async may increase total tokens; ensure the time savings justify it.

## Usage Reference

### `/subagents-status` or `subagent_status`
- Lists active and recent async subagent runs.
- Use it to find the `runId` prefix for `/subattach`.
- `subagent_status({ id: "<prefix>" })` also prints the run folder and session path when available.

### `/subattach <asyncRunIdOrPrefix>`
- Resolves the run directory under the async runs folder.
- Reads `status.json` and switches into the session file if present.
- Requires the session file to still exist on disk.

### `/subattach-latest`
- Picks the most recently updated async run (`status.json` mtime).
- Switches into that run's `sessionFile`.
- Handy when you just launched one run and want to jump in quickly.

### `/subback`
- Returns to the last session attached via `/subattach` or `/subattach-latest`.
- Stored in-memory during the current process lifetime.
- Falls back with an error if no prior attach occurred or the file is gone.

