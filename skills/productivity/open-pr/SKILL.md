---
name: open-pr
description: Helps create and manage GitHub pull requests from the current branch using the repo's gh-pr workflow, with explicit base-branch confirmation and issue-link discovery. Use when the user asks to open, create, inspect, update, or prepare a PR, pull request, or merge request.
argument-hint: "Optional PR title or context"
---

# Open PR

Create or manage GitHub pull requests using the GitHub tracker PR workflow. Prefer the `github_pr` tool or `/gh-pr` command rather than ad hoc `gh pr` shell commands.

## Invocation behavior

When this skill is loaded directly, including `/skill:open-pr` with no arguments, treat that invocation as the user's request to start PR work now.

Do not reply with only a passive loaded/ready message. Immediately run non-mutating preflight checks, then ask the user which base branch to merge into before creating a PR or pushing a branch.

## PR command mirror

Use the same shape as `/gh-issue`, but for pull requests:

```sh
/gh-pr list [gh pr list args]
/gh-pr create <title> --body <body> --base <confirmed-branch> [--head <branch>] [--draft]
/gh-pr view <number>
/gh-pr comment <number> <text>
/gh-pr close <number>
```

Tool equivalent: `github_pr` with actions `list`, `create`, `view`, `comment`, and `close`.

## Workflow

1. Inspect repo/PR state without mutating:
   - `git status --short`
   - current branch and upstream/tracking status
   - default branch and likely base branches
   - existing PR for the current branch via `github_pr list` or `/gh-pr list --head <branch>`
2. Ask the user to confirm the base branch. Use `ask_user` when available.
3. Discover linked issues before asking for manual issue numbers:
   - active GitHub issue workflow, if present (`github_work status` / `github_work view`)
   - issue numbers in branch name, commits, user PR context/title, or existing PR body
   - targeted `github_issue view` / `github_issue list` searches
4. Draft the PR body with:
   - summary
   - validation performed
   - issue links
5. Create the PR with `github_pr` / `/gh-pr`, or use `github_pr comment` for lightweight updates to an existing PR.

## Issue linking rules

Use GitHub-recognized closing keywords only when the PR is expected to complete the issue:

```md
Closes #123
Fixes #456
```

Use plain references for related but non-closing work:

```md
Related to #789
```

Do not invent issue numbers. If linkage is uncertain, ask.

## Safety rules

- Never create a PR from a branch into itself.
- Never assume the base branch; ask first.
- Never create duplicate PRs for the same branch.
- Never close a PR unless the user explicitly asks.
- If the working tree is dirty, ask whether to stop or continue without uncommitted changes.
- If upstream is missing and pushing is required, ask before pushing.

## Response after create/update

Return only:

- PR URL or PR number
- base/head branches
- linked issues (`Closes` / `Related`)
- any follow-up the user must do
