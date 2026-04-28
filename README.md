# cy-pi

Portable pi agent resources for cyan.

This repo is a pi package for resources pi can load directly, plus a small link installer for pi resources that are not part of pi package discovery yet.

## Contents

- `extensions/` — pi TypeScript extensions
  - `cd.ts` — adds `/cd <path>` to migrate the active session to a new working directory
  - `sh.ts` — adds `/sh <command>` to run a shell command in pi's current working directory
  - `commit-message.ts` — adds `/commit-message` to generate/copy a git commit message and open lazygit
  - `git-ai.ts`
  - `subagent-handoff.ts`
  - `think.ts` — adds `/think <level>` for quick thinking-level changes
- `skills/` — Agent Skills loaded by pi
  - `ask`
  - `git-ai-search`
  - `prompt-analysis`
- `prompts/` — prompt templates (currently empty)
- `themes/` — custom themes (currently empty)
- `agents/` — pi-subagents chain definitions
  - `async-scout.chain.md`
  - `async-implement-review.chain.md`
- `APPEND_SYSTEM.md` — global system-prompt append content
- `SUBAGENTS_ASYNC_PLAYBOOK.md` — async subagent reference used by the global instructions
- `settings.example.json` — portable example settings, including non-custom package sources, with secrets/runtime state removed
- `commit-message-prompt.md` — default global prompt for `/commit-message`

Not included: `auth.json`, sessions, run history, caches, or API keys.

## Install from git later

After you create a remote, install the pi package with a pinned ref:

```bash
pi install git:github.com/YOUR_USER/cy-pi@v0.1.0
```

That loads the package resources declared in `package.json`:

- extensions
- skills
- prompts
- themes

If you also want the global `APPEND_SYSTEM.md` and pi-subagents chains from this repo, clone it and run the link installer:

```bash
git clone git@github.com:YOUR_USER/cy-pi.git ~/cy-pi
cd ~/cy-pi
./scripts/install-local-links.sh
```

When this repo is already installed with `pi install`, the link installer intentionally removes repo-owned global extension/skill symlinks and lets pi package discovery load those resources. This avoids duplicate skill or command conflicts. To force a mode explicitly, use `./scripts/install-local-links.sh --no-package-resources` after `pi install`, or `./scripts/install-local-links.sh --package-resources` when you are not using `pi install` and want direct global symlinks.

## Local install while developing

From this checkout:

```bash
pi install "$(pwd)"
```

If you install this checkout as a local package, run the link script for the non-package resources:

```bash
pi install "$(pwd)"
./scripts/install-local-links.sh
```

If you do not want to use `pi install` locally, direct global symlinks still work:

```bash
./scripts/install-local-links.sh --package-resources
```

## commit-message extension

`/commit-message` uses the active pi model to generate a commit message from staged changes. If nothing is staged, it falls back to the working tree diff. The generated message is copied to the clipboard and lazygit is launched in the repo when available.

The generated message is installed as a temporary `git commit.template` for that lazygit process, so lazygit's commit-with-editor action (`C` by default) opens an editor prefilled with it. For lazygit's inline commit box (`c`), paste from the clipboard. If lazygit is unavailable or pi is not running with an interactive TUI, the command falls back to the clipboard/display flow.

Use `/commit-message --clipboard-only` (aliases: `--clipboard`, `--no-lazygit`, `--no-lg`) to skip lazygit and only copy/show the generated message.

Prompt lookup order:

1. Repo override: `<git-root>/.pi/commit-message-prompt.md`
2. Global prompt: `~/.pi/agent/commit-message-prompt.md`
3. Built-in fallback prompt inside the extension

This repo's `commit-message-prompt.md` can be linked to the global location with `./scripts/install-local-links.sh`.

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

The `packages` list tracks non-custom pi packages to install alongside this repo's custom resources:

- `npm:@zenobius/pi-rose-pine`
- `npm:pi-subagents`
- `npm:pi-web-access`

To install those packages into the local global pi install, run:

```bash
./scripts/install-packages.sh
```

Install this repo itself separately with your actual remote, preferably pinned to a tag:

```bash
pi install git:github.com/YOUR_USER/cy-pi@v0.1.0
```

## Notes

Pi packages currently auto-discover extensions, skills, prompt templates, and themes. The `agents/` chain files and top-level `APPEND_SYSTEM.md` are kept here for portability, but need to be linked or copied into the standard pi locations by `scripts/install-local-links.sh`.
