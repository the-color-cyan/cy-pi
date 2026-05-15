# Repo Instructions

This repo packages portable pi resources.

- Do not commit auth files, sessions, run history, API keys, or local caches.
- Keep `package.json -> pi` limited to resources pi packages understand: `extensions`, `skills`, `prompts`, and `themes`.
- Keep active pi-subagents chains in `agents/`; use `scripts/install-local-links.sh` to link them into `~/.pi/agent/agents`.
- Keep parked/unused resources under `archive/`; do not add `archive/` to `package.json -> pi`, package `files`, or link installers.
- Add any new pi extensions to `extensions/` in this repo so they stay portable.
- For isolated development, prefer `scripts/pi-dev.sh`: package mode tests `cy-pi@main` in `~/.pi-dev/agent`, and `--local --refresh` symlinks this checkout for active editing while normal `~/.pi/agent` remains untouched.
- Use `scripts/use-local-package.sh` only when you explicitly want the normal/global harness to load this checkout as a local package.
- Prefer portable paths. Use `$HOME`, `homedir()`, or environment variables instead of absolute machine-specific paths.
- If adding runtime npm dependencies for extensions, put them in `dependencies` and keep pi runtime packages as peer dependencies with `"*"`.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `the-color-cyan/cy-pi`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage labels use the default canonical vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Domain docs use a single-context layout. See `docs/agents/domain.md`.
