---
name: open-pr
description: Helps create GitHub pull requests from the current branch with explicit base-branch confirmation and automatic issue discovery from the tracker. Use when the user asks to open, create, or prepare a PR, pull request, merge request, or asks to link related GitHub issues in a PR.
argument-hint: "Optional PR title or context"
---

# Open PR

Create a GitHub pull request safely from the current branch, with explicit base-branch confirmation and issue links discovered from the tracker.

## Invocation behavior

When this skill is loaded directly, including `/skill:open-pr` with no arguments, treat that invocation as the user's request to start creating a PR now.

Do not reply with only a passive loaded/ready message. Immediately run the preflight checks that do not mutate state, then ask the user which base branch to merge into before any PR creation or branch push.

## Quick start

1. Inspect repo state:
   - current branch and tracking status
   - clean/dirty working tree
   - default branch and remotes
   - existing PR for the current branch
2. Ask the user which branch to merge into before creating the PR.
3. Search the issue tracker for issues related to the current branch before asking the user for issue numbers.
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

Always ask the user what branch the PR should merge into. Use the `ask_user` tool when available, with discovered candidate base branches as options plus a freeform branch option.

Provide context in the question:

- current/head branch
- default branch
- whether the head branch is ahead of the candidate base
- any invalid option, e.g. head and base are the same branch

Do not create a PR until the user confirms a valid base branch.

### 3. Discover tied issues from the tracker

Do not ask the user to supply issue numbers until after you have searched the issue tracker.

Collect search evidence from:

- active GitHub issue workflow, if present
- current branch name, e.g. `feature/123-thing`, `issue-123`, `fix-123`
- normalized branch tokens, e.g. split `feature/add-open-pr-issue-discovery` into `add`, `open`, `pr`, `issue`, `discovery`
- issue numbers embedded in branch names, commit messages, user-provided PR context/title, or an existing PR body
- commit messages on the branch
- existing PR body, if updating

Search GitHub issues directly. Prefer targeted searches first, then broader token searches when needed:

```sh
# Exact issue number hints from branch/commits/context
gh issue view <number> --comments --json number,title,state,body,labels,comments,url

# Exact branch string and meaningful branch tokens, including closed issues
gh search issues "<current-branch>" --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner)" --state all --json number,title,state,body,labels,url

gh issue list --state all --limit 100 --json number,title,state,body,labels,url \
  --search "<meaningful branch token or phrase>"
```

When broad issue listings are needed, keep tool output small by filtering/summarizing in the command (for example with `jq`) before showing results.

Rank candidate issues by confidence:

1. Explicit issue number in branch/commits/context/active workflow.
2. Exact current branch string in issue title/body/comments.
3. Multiple distinctive branch tokens in issue title/body.
4. Commit subject or PR-title phrase matches issue title/body.

Use high-confidence matches automatically in the draft PR body. If multiple plausible issues remain, present the discovered candidates and ask the user to choose among them or select “none”. Only ask for freeform issue numbers after search returns no useful candidates.

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

Prefer `Closes #N` for high-confidence implementation work that completes an issue. Use `Related to #N` for plausible or user-confirmed non-closing relationships. Do not use closing keywords when the relationship is uncertain.

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
