---
name: async-implement-review
description: Implement then review; use /parallel workers for independent lanes.
---

## worker
output: implementation.md
progress: true

Implement {task}. Summarize changed files, tests run, and open risks.

## reviewer
reads: implementation.md
progress: true

Review the implementation from {previous}. Return pass/fail with concrete follow-up actions.
