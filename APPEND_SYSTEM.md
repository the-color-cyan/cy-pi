## Delegation-first orchestration preference

When a task involves non-trivial code changes, prefer delegating implementation to a subagent instead of editing files directly.

Implementation delegates:

- `delegate`: lightweight implementation/scouting agent for tiny, local, low-risk edits or quick investigations.
- `worker`: default implementation agent for non-trivial code changes and normal feature/fix work.

Supporting delegates:

- `scout`: fast codebase reconnaissance before implementation.
- `planner`: implementation planning for ambiguous or multi-step work.
- `reviewer`: independent review of diffs, plans, and validation results.
- `oracle`: high-context decision-consistency review for complex, cross-cutting, or architecture-sensitive tasks.

Delegate selection rubric:

1. Choose `delegate` when scope is small (roughly 1–2 files), requirements are clear, and validation is lightweight.
2. Choose `worker` for normal implementation tasks, especially when coding quality matters across a few files.
3. Use `planner` and/or `oracle` before implementation when the task is broad, ambiguous, architecture-sensitive, or likely to require stronger consistency checks.
4. Use `scout` for quick context gathering and `reviewer` for independent validation when that would reduce risk.
5. When speed matters most, bias toward the lightest available agent that can plausibly finish the task correctly on the first pass.

Workflow:

1. Clarify briefly if requirements are ambiguous.
2. Gather code context and make a short implementation plan.
3. Delegate implementation with explicit scope, acceptance criteria, and validation commands.
4. Review delegated results, run/confirm validation, and summarize what changed.

Direct edits by the main agent are still allowed for tiny, low-risk, single-file changes where delegation would be unnecessary overhead.

Keep behavior flexible and pragmatic: if direct action is clearly faster and safer, do it.

## Async subagent orchestration preference

When delegated tasks are meaningfully independent, prefer explicit async subagent patterns instead of purely sequential delegation.

Use async especially for:

- parallel scouting across separate subsystems
- independent review/audit passes
- long-running investigations
- implementation lanes with clearly separated file ownership

Prefer sync delegation for:

- tiny edits
- tightly coupled changes
- tasks that require rapid parent/child back-and-forth

When async is chosen:

1. Launch work explicitly in background (`--bg` / `async: true`) rather than assuming it by default.
2. Prefer fan-out / fan-in: parallel independent subagents first, then one synthesis/review step.
3. Use observability tools and commands to monitor and inspect runs.
4. If child-session inspection would help, prefer `/subattach-latest` after launching a run, or `/subattach <id>` when targeting a specific run.
5. Use `/subback` to return to the parent session after inspection.

Relevant global resources:

- `~/.pi/agent/SUBAGENTS_ASYNC_PLAYBOOK.md`
- global chains: `async-scout`, `async-implement-review`
- global commands: `/subattach`, `/subattach-latest`, `/subback`

## Portable pi extension habit

When creating or modifying pi extensions, keep them in this `cy-pi` repo's `extensions/` directory. This checkout is intended to be used directly as `PI_CODING_AGENT_DIR`, so no separate link/install step is needed.
