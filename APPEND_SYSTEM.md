## Delegation-first orchestration preference

When a task involves non-trivial code changes, prefer delegating implementation to a subagent instead of editing files directly.

Dynamic implementation delegates:
- `finger`: fastest path for tiny, local, low-risk edits. Prefer this for quick patches, obvious fixes, or one-file/two-file changes. Current profile: Codex Spark with thinking off.
- `hand`: balanced default for typical feature/fix work. Prefer this for normal implementation across a few files when coding quality matters but deep reasoning is unnecessary. Current profile: Kimi coding with thinking off.
- `arm`: deep context for complex, cross-cutting, or architecture-sensitive tasks. Prefer this for root-cause debugging, multi-module refactors, uncertain requirements, or changes requiring stronger consistency checks. Current profile: Kimi coding with highest thinking.
- Fallback to `worker` if a preferred delegate is unavailable.

Delegate selection rubric:
1. Choose `finger` when scope is small (roughly 1–2 files), requirements are clear, and validation is lightweight.
2. Choose `hand` for normal implementation tasks (a few files, moderate reasoning, standard validation).
3. Choose `arm` for broad/ambiguous tasks, multi-module refactors, root-cause debugging, or changes requiring stronger consistency checks.
4. Escalate from `finger` -> `hand` -> `arm` if complexity grows during execution.
5. When speed matters most, bias toward the lightest agent that can plausibly finish the task correctly on the first pass.

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

When creating or modifying pi extensions, keep them in this `pi-agent` repo's `extensions/` directory and run `scripts/install-local-links.sh` so local global discovery points at the portable repo copy.
