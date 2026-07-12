# Repo Instructions

This repo is a Pi agent home checkout, like a Neovim config checkout.

- Do not commit auth files, sessions, run history, API keys, local settings, generated git worktrees, or local caches.
- Direct-home mode: run `scripts/init-agent-home.sh`, then launch the
  repo-pinned runtime with `pi` (after restarting the shell) or
  `scripts/pi-home.sh`. Do not bypass `bin/pi` with
  `PI_CODING_AGENT_DIR=$PWD pi`; that may select an unrelated global runtime.
- Do not add symlink/config setup scripts that mutate another `~/.pi/agent`; this repo should be used in place.
- Keep `package.json -> pi` limited to resources pi packages understand: `extensions`, `skills`, `prompts`, and `themes`.
- Treat `settings.managed.json` as the canonical portable Pi configuration. Do
  not commit mutable `settings.json`; apply managed changes through
  `scripts/reconcile-settings.sh` or `scripts/init-agent-home.sh`, and capture
  intentional local changes with `/capture`.
- Keep active pi-subagents chains in `agents/`.
- Keep parked/unused resources under `archive/`; do not add `archive/` to `package.json -> pi` or package `files`.
- Add any new pi extensions to `extensions/` in this repo so they stay portable and direct-home friendly.
- Prefer portable paths. Use `$HOME`, `homedir()`, or environment variables instead of absolute machine-specific paths.
- Put extension runtime dependencies in `dependencies` and keep pi runtime
  packages as peer dependencies with `"*"`. The root Pi runtime is additionally
  pinned as exact root dev dependencies so `bin/pi` can run the same version on
  every machine; keep the root manifest and lockfile synchronized. Keep
  `npm/package.json` and `npm/package-lock.json` synchronized when changing
  checkout-managed extension dependencies.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `the-color-cyan/cy-pi`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage labels use the default canonical vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Domain docs use a single-context layout. See `docs/agents/domain.md`.
