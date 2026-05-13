# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`
- **PRDs**: create PRDs as GitHub issues labeled `prd`.
- **Issue relationships**: use actual GitHub issue relationships for parents/sub-issues and blockers. Prefer current `gh issue create` / `gh issue edit` flags such as `--parent`, `--blocked-by`, and `--blocking` when available.
- **Direct blockers only**: create only nearest/direct blocker relationships. For a chain A blocks B blocks C, create A -> B and B -> C only; do not also create a transitive A -> C relationship.
- **Relationship summaries**: keep human-readable `Parent` and `Blocked by` sections in issue bodies when templates ask for them, but treat them as secondary summaries. They must not substitute for GitHub relationships.
- **Branches**: every issue implementation starts in a new branch, never directly on `main`/`master` or an unrelated existing branch. Before MVP/release state, use `proj/*` branch names, for example `proj/123-short-slug`.
- **PR review outcomes**: use `agent-approved` and `agent-rejected` labels. If a review has findings, post the findings as a PR comment and apply `agent-rejected`. If there are no findings, applying `agent-approved` is enough; no comment is required.

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## GitHub relationship fallback

If the installed `gh issue` command does not support relationship flags, use `gh api`:

- Read an issue's REST database id: `gh api /repos/{owner}/{repo}/issues/{number} --jq .id` (`gh issue view --json id` returns a GraphQL node id, not the REST integer id).
- Add a sub-issue to a parent: `gh api --method POST /repos/{owner}/{repo}/issues/{parent}/sub_issues -F sub_issue_id=<child REST database id>`
- Mark an issue as blocked by another issue: `gh api --method POST /repos/{owner}/{repo}/issues/{blocked}/dependencies/blocked_by -F issue_id=<blocking REST database id>`

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
