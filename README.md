# cy-pi

Portable pi agent resources for cyan.

This repo is a pi package for resources pi can load directly, plus a small link installer for pi resources that are not part of pi package discovery yet.

## Contents

- `extensions/` — pi TypeScript extensions
  - `cd.ts` — adds `/cd <path>` to migrate the active session to a new working directory
  - `sh.ts` — adds `/sh <command>` to run a shell command in pi's current working directory
  - `commit-message.ts` — adds `/commit-message` to generate/copy a git commit message and open lazygit
  - `git-ai.ts`
  - `github-tracker.ts` — adds `/gh-track`, `/gh-issue`, `/gh-work`, and `/gh-labels` helpers for issue workflow tracking
  - `pair.ts` — adds `/pair` for pair-programming session management
  - `think.ts` — adds `/think <level>` for quick thinking-level changes
- `skills/` — Agent Skills loaded by pi
  - `productivity/` — general workflow skills (`handoff`)
- `prompts/` — prompt templates (currently empty)
- `themes/` — custom themes (currently empty)
- `agents/` — active pi-subagents custom agents and chain definitions, when present
- `archive/` — inert resources kept for reference only; these are not declared in the pi package manifest, not published by `npm pack`, and not linked by the install scripts
- `APPEND_SYSTEM.md` — global system-prompt append content
- `SUBAGENTS_ASYNC_PLAYBOOK.md` — async subagent reference used by the global instructions
- `settings.example.json` — portable example settings with secrets/runtime state removed
- `packages.example.json` — portable list of non-custom package sources to sync across pi instances
- `commit-message-prompt.md` — default global prompt for `/commit-message`

Not included: `auth.json`, sessions, run history, caches, or API keys.

## Install from git

Install the stable package with a pinned tag:

```bash
pi install git:git@github.com:the-color-cyan/cy-pi@v0.1.0
```

That loads the package resources declared in `package.json`:

- extensions
- skills
- prompts
- themes

If you also want global resources that pi packages do not discover yet (`APPEND_SYSTEM.md`, active `agents/`, and related prompt/playbook files), clone this repo and run the link installer:

```bash
git clone git@github.com:the-color-cyan/cy-pi.git ~/pi/cy-pi
cd ~/pi/cy-pi
./scripts/install-local-links.sh
```

When this repo is already installed with `pi install`, the link installer intentionally removes repo-owned global extension/skill symlinks and lets pi package discovery load those resources. This avoids duplicate skill or command conflicts.

## Isolated `pi-dev` launcher

Use `scripts/pi-dev.sh` for an explicit dev harness. Normal `pi` remains untouched; `pi-dev.sh` launches Pi with `PI_CODING_AGENT_DIR=~/.pi-dev/agent`.

```bash
./scripts/pi-dev.sh                         # launch existing dev home; no refresh
./scripts/pi-dev.sh --refresh               # match normal pi packages/settings, force cy-pi@main
./scripts/pi-dev.sh --local --refresh       # use this checkout via symlinks
./scripts/pi-dev.sh --reset-refresh         # archive/rebuild dev home, then refresh
./scripts/pi-dev.sh --refresh --no-launch   # refresh only
./scripts/pi-dev.sh --refresh --model k2p6  # pass args through to pi
```

Package mode installs private `cy-pi` from SSH by default:

```text
git:git@github.com:the-color-cyan/cy-pi@main
```

Override it with `CY_PI_DEV_SOURCE` when needed. `--copy-auth` is required to copy `~/.pi/agent/auth.json`; refreshes do not copy credentials by default. Reset backups are kept under `~/.pi-dev/` with retention of 10 newest backups and 30 days.

Recommended shell alias:

```bash
alias pi-dev="$HOME/pi/cy-pi/scripts/pi-dev.sh"
```

See [`docs/pi-dev-isolation.md`](docs/pi-dev-isolation.md).

The older normal-harness helper `scripts/use-local-package.sh` is still available when you explicitly want `~/.pi/agent/settings.json` to point at this checkout as a local package.

## commit-message extension

`/commit-message` uses the active pi model to generate a commit message from staged changes. If nothing is staged, it falls back to the working tree diff. The generated message is copied to the clipboard and lazygit is launched in the repo when available.

The generated message is installed as a temporary `git commit.template` for that lazygit process, so lazygit's commit-with-editor action (`C` by default) opens an editor prefilled with it. For lazygit's inline commit box (`c`), paste from the clipboard. If lazygit is unavailable or pi is not running with an interactive TUI, the command falls back to the clipboard/display flow.

Use `/commit-message --clipboard-only` (aliases: `--clipboard`, `--no-lazygit`, `--no-lg`) to skip lazygit and only copy/show the generated message.

Prompt lookup order:

1. Repo override: `<git-root>/.pi/commit-message-prompt.md`
2. Global prompt: `~/.pi/agent/commit-message-prompt.md`
3. Built-in fallback prompt inside the extension

This repo's `commit-message-prompt.md` can be linked to the global location with `./scripts/install-local-links.sh`.

## pair extension

`/pair` manages an in-memory pair-programming session backed by custom session entries. State is restored when a session loads and persisted on every change.

Subcommands:

- `/pair start [goal]` — activate a pair session and optionally set a goal.
- `/pair stop` — deactivate the session.
- `/pair status` (alias `dashboard`) — show current state.
- `/pair mode <navigator|mentor|reviewer|debugger|implementer>` — set involvement style.
- `/pair attention <quiet|ambient|active>` — set how much the partner should interject.
- `/pair explain <terse|normal|mentor|socratic>` — set explanation depth.
- `/pair autonomy <observe|suggest|ask|edit|agentic>` — set how independently the partner acts.
- `/pair goal <text>` — set the current goal.
- `/pair plan [step1 | step2 | ...]` — without args, asks the LLM to create/revise a plan; with args, sets the plan directly (split on `|`).
- `/pair step <n|next|prev|done>` — move through the plan; without args, asks the LLM for help on the current step.
- `/pair checkpoint` — alias for `/pair step` (LLM-facing checkpoint).
- `/pair review-diff` — asks the LLM to review staged + unstaged diff as a pair partner.
- `/pair summary` — asks the LLM to summarize session progress.
- `/pair help` — shows usage.

When active, a small dashboard widget is rendered above the editor. All LLM-facing prompts explicitly frame the assistant as a pair partner, include the current state, and respect the configured mode/attention/autonomy/explanation settings.

## GitHub tracker extension

`extensions/github-tracker.ts` exposes tab completion for `/gh-track`, `/gh-issue`, `/gh-work`, and `/gh-labels` subcommands. It also completes `/gh-issue stage <number> <stage>`, `/gh-work pane <mode>`, and `/gh-work done --close`.

## git-ai extension

`extensions/git-ai.ts` uses:

```bash
$GIT_AI_BIN
```

when set. Otherwise it uses `~/.git-ai/bin/git-ai` if present, then falls back to `git-ai` on `PATH`.

Set `GIT_AI_BIN` if a target machine installs `git-ai` somewhere else.

## Settings and package sync

Use `settings.example.json` as a starting point only. Copy relevant parts into:

```text
~/.pi/agent/settings.json
```

or project-local:

```text
.pi/settings.json
```

`packages.example.json` tracks non-custom pi packages to install alongside this repo's custom resources. To refresh it from the local global pi settings (`~/.pi/agent/settings.json`) while excluding this repo's `cy-pi` package entry, run:

```bash
./scripts/copy-packages.sh
```

You can also pass explicit source and output paths:

```bash
./scripts/copy-packages.sh ~/.pi/agent/settings.json packages.example.json
```

To install those packages into the local global pi install, run:

```bash
./scripts/install-packages.sh
```

To first remove package entries from local pi settings that are not listed in the input file, run:

```bash
./scripts/install-packages.sh --prune
```

`install-packages.sh` also accepts a settings-style JSON file with a `packages` array for compatibility.

Install this repo itself separately, preferably pinned to a tag:

```bash
pi install git:git@github.com:the-color-cyan/cy-pi@v0.1.0
```

## Notes

Pi packages currently auto-discover extensions, skills, prompt templates, and themes. Active `agents/` custom agent/chain files and top-level `APPEND_SYSTEM.md` are kept here for portability, but need to be linked or copied into the standard pi locations by `scripts/install-local-links.sh`. Files under `archive/` are intentionally not loaded or linked.
