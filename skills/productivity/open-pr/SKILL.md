---
name: open-pr
description: Helps create GitHub pull requests from the current branch with explicit base-branch confirmation and issue linking. Use when the user asks to open, create, or prepare a PR, pull request, merge request, or asks to link related GitHub issues in a PR.
argument-hint: "Optional PR title or context"
---

# Open PR

Create a GitHub pull request safely from the current branch, with explicit base-branch confirmation and linked issues.

## Quick start

1. Inspect repo state:
   - current branch and tracking status
   - clean/dirty working tree
   - default branch and remotes
   - existing PR for the current branch
2. Ask the user which branch to merge into before creating the PR.
3. Find related issue numbers.
4. Create or update the PR body with GitHub issue-linking keywords.

## Workflow

### 1. Preflight

Run checks before creating anything:

- Confirm this is a GitHub repo (`gh repo view`).
- Confirm current branch is not empty and is not the selected base branch.
- Confirm working tree state. If dirty, ask whether to stop or continue without uncommitted changes.
- Check whether a PR already exists for the current branch (`gh pr view`). If one exists, offer to update it instead of creating a duplicate.
- Push the branch if needed, after confirming with the user when upstream is missing.

### 2. Ask for base branch

Always ask the user what branch the PR should merge into.

Provide context in the question:

- current/head branch
- default branch
- whether the head branch is ahead of the candidate base
- any invalid option, e.g. head and base are the same branch

Do not create a PR until the user confirms a valid base branch.

### 3. Find tied issues

Collect related issue numbers from available evidence:

- active GitHub issue workflow, if present
- current branch name, e.g. `feature/123-thing`, `issue-123`, `fix-123`
- commit messages on the branch
- user-provided PR context or title
- existing PR body, if updating

If issue ties are unclear, ask the user for related issue numbers or allow “none”.

### 4. Link issues in the PR body

Use GitHub-recognized linking keywords for issues that should close when the PR merges:

```md
Closes #123
Fixes #456
```

Use plain references for issues that are related but should not auto-close:

```md
Related to #789
```

Prefer `Closes #N` for implementation work that completes an issue. Do not use closing keywords when the relationship is uncertain.

### 5. Create the PR

Use `gh pr create` with:

- `--base <confirmed-base>`
- `--head <current-branch>`
- a concise title derived from user input or branch commits
- a body that includes summary, validation, and issue links

After creation, return only:

- PR URL
- base/head branches
- linked issues
- any follow-up the user must do

## Safety rules

- Never create a PR from a branch into itself.
- Never assume the base branch; ask first.
- Never create duplicate PRs for the same branch.
- Never invent issue numbers.
- Prefer asking over guessing when issue linkage affects auto-closing behavior.
