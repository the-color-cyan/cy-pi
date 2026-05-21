# TDD Issue Loop: ISSUE_NUMBER

Target GitHub issue: ISSUE_NUMBER

## Operating mode

Use `skill:tdd` for every implementation slice.

Work in small vertical tracer-bullet slices. Each iteration should:

1. Inspect the current issue state (`github_work view`).
2. Pick exactly one thin TDD slice from the remaining issue acceptance criteria or review gaps.
3. Write or update one behavior-focused failing test through a public interface.
4. Run the focused test and confirm RED.
5. Implement the smallest code change needed.
6. Run the focused test and confirm GREEN.
7. Refactor only after GREEN, and rerun tests after each refactor.
8. Run relevant broader validation (`npm test`, plus LSP diagnostics when useful).
9. Update this Ralph file with commands, outputs, files changed, and remaining risk.
10. Comment meaningful progress/blockers on the GitHub issue and keep stage current.

Continue until the issue acceptance criteria are satisfied and no serious review gaps remain.

## Startup checklist

- [ ] Run `github_work start ISSUE_NUMBER` or confirm ISSUE_NUMBER is already active
- [ ] Run `github_work view`
- [ ] Read the issue problem statement, acceptance criteria, comments, and linked docs
- [ ] Read `skill:tdd` guidance
- [ ] Reconcile already-implemented work, if any, against the issue acceptance criteria
- [ ] Identify the first small TDD slice backlog
- [ ] Set/keep issue stage appropriate (`stage:in-progress` while coding, `stage:review` when ready)

## Current issue state summary

Fill this in after `github_work view`:

- State:
- Labels/stage:
- Key acceptance criteria:
- Existing implementation notes:
- Known blockers/risks:

## Slice backlog

Rebuild this list from the current code and issue text at loop start. Keep each item small enough for one RED→GREEN cycle.

- [ ] Acceptance-criteria reconciliation: map issue requirements to implemented behavior, tests, docs, or explicit follow-up.
- [ ] TDD slice:
- [ ] TDD slice:
- [ ] TDD slice:
- [ ] Documentation/domain check, if applicable.
- [ ] Final validation and independent review pass.

Add, split, or remove slices as evidence dictates. Do not do horizontal test batches.

## Per-iteration checklist

For each Ralph iteration:

- [ ] Re-read active issue if requirements may have changed.
- [ ] Select one incomplete slice.
- [ ] Add/update one behavior test first.
- [ ] Run focused test and record RED output.
- [ ] Implement minimal code.
- [ ] Run focused test and record GREEN output.
- [ ] Run broader relevant validation.
- [ ] Refactor only while GREEN.
- [ ] Update this file's checklist, verification log, and notes.
- [ ] Comment important progress/blockers on the issue.

## Completion criteria

Only finish when:

- [ ] All issue acceptance criteria are implemented, tested, documented, or explicitly deferred with rationale.
- [ ] All TDD slices in this file are complete.
- [ ] Relevant tests pass.
- [ ] TypeScript compile/build passes, if applicable.
- [ ] LSP diagnostics for touched source are clean or known/non-blocking.
- [ ] Independent review is complete or intentionally skipped with rationale.
- [ ] Issue is moved to `stage:review` with a final summary comment.

When done, output:

```xml
<promise>COMPLETE</promise>
```

## Acceptance-criteria reconciliation

Fill this in during the first iteration.

Implemented with behavior coverage:

-

Implemented but worth final adapter/smoke coverage:

-

Explicitly deferred/out of scope:

-

## Verification log

Record commands and results here.

-

## Reflection checkpoints

At reflection iterations, answer:

1. What has been accomplished so far?
2. What's working well?
3. What's not working or blocking progress?
4. Should the approach be adjusted?
5. What are the next priorities?

## Notes / decisions / blockers

- Use behavior tests through public seams; avoid testing private implementation details.
- Do not do horizontal test batches. One failing behavior test per slice, then minimal implementation.
- Keep new pi extension work under `extensions/` and preserve direct-home portability.
