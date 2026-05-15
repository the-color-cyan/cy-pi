# Isolated `pi-dev` setup

`pi-dev` is an explicit launcher for a separate Pi home at `~/.pi-dev/agent`.
Normal `pi` continues to use `~/.pi/agent`.

## Layout

```text
~/.pi/agent/           # normal/default Pi home
~/.pi-dev/agent/       # isolated dev Pi home used by scripts/pi-dev.sh
~/pi/cy-pi/            # this repo, containing the launcher and local resources
```

## Launcher

From this repo:

```bash
./scripts/pi-dev.sh
```

Recommended shell alias:

```bash
alias pi-dev="$HOME/pi/cy-pi/scripts/pi-dev.sh"
```

Plain launch is intentionally non-mutating:

```bash
pi-dev                  # launch current ~/.pi-dev/agent
pi-dev --model k2p6     # pass args through to pi
```

## Refresh from normal Pi

Refresh makes the dev home behave like normal Pi, except `cy-pi` is forced to the dev channel:

```bash
pi-dev --refresh
pi-dev --refresh --no-launch
```

Refresh behavior:

1. reads live normal settings from `~/.pi/agent/settings.json`
2. merges normal preferences and package entries into `~/.pi-dev/agent/settings.json`
3. preserves dev-only package entries, except all existing `cy-pi` entries are removed
4. sets `subagents.defaultSessionDir` to `~/.pi-dev/agent/sessions/subagent`
5. installs normal third-party packages into the dev home
6. installs `cy-pi` from `CY_PI_DEV_SOURCE`, defaulting to:

```text
git:git@github.com:the-color-cyan/cy-pi@main
```

After installing package-mode `cy-pi`, the script symlinks non-package resources from the installed checkout into the dev home:

```text
agents/
APPEND_SYSTEM.md
SUBAGENTS_ASYNC_PLAYBOOK.md
commit-message-prompt.md
```

Package-discovered resources (`extensions/`, `skills/`, `prompts/`, `themes/`) stay owned by Pi package discovery in package mode.

## Local checkout mode

Use local mode for active editing without pushing to `main`:

```bash
pi-dev --local --refresh
```

Local mode removes `cy-pi` package entries and symlinks this checkout's resources into `~/.pi-dev/agent`, including both package resources and non-package resources.

## Reset refresh

```bash
pi-dev --reset-refresh
```

Reset refresh archives the current dev home, rebuilds it, refreshes, then launches unless `--no-launch` is passed.
Backups are stored next to the dev home and pruned with both limits:

- keep the newest 10 backups
- delete backups older than 30 days
- never delete the backup created by the current command

## Auth

Auth is explicit. Refresh and reset do not copy credentials by default.

```bash
pi-dev --refresh --copy-auth
pi-dev --reset-refresh --copy-auth
```

`--copy-auth` copies `~/.pi/agent/auth.json` to `~/.pi-dev/agent/auth.json` with restrictive permissions when possible.

## Notes

- `pi-dev` does not mutate shell rc files.
- Use `CY_PI_DEV_SOURCE=... pi-dev --refresh` to test another branch/tag/source.
- Project-local `.pi/` directories are still shared by both harnesses when running inside that project.
