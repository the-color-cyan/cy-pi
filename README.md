# pi-agent

Portable pi agent resources for cyan.

This repo is a pi package for resources pi can load directly, plus a small link installer for pi resources that are not part of pi package discovery yet.

## Contents

- `extensions/` — pi TypeScript extensions
  - `git-ai.ts`
  - `subagent-handoff.ts`
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
- `settings.example.json` — portable example settings, with secrets/runtime state removed

Not included: `auth.json`, sessions, run history, caches, or API keys.

## Install from git later

After you create a remote, install the pi package with a pinned ref:

```bash
pi install git:github.com/YOUR_USER/pi-agent@v0.1.0
```

That loads the package resources declared in `package.json`:

- extensions
- skills
- prompts
- themes

If you also want the global `APPEND_SYSTEM.md` and pi-subagents chains from this repo, clone it and run the link installer:

```bash
git clone git@github.com:YOUR_USER/pi-agent.git ~/pi-agent
cd ~/pi-agent
./scripts/install-local-links.sh
```

## Local install while developing

From this checkout:

```bash
pi install "$(pwd)"
```

During this migration, the original global locations were symlinked to this repo, so local pi continues to load these resources without adding the local package to settings.

## git-ai extension

`extensions/git-ai.ts` uses:

```bash
$GIT_AI_BIN
```

when set. Otherwise it uses `~/.git-ai/bin/git-ai` if present, then falls back to `git-ai` on `PATH`.

Set `GIT_AI_BIN` if a target machine installs `git-ai` somewhere else.

## Settings

Use `settings.example.json` as a starting point only. Copy relevant parts into:

```text
~/.pi/agent/settings.json
```

or project-local:

```text
.pi/settings.json
```

Replace the placeholder package source with your actual remote, preferably pinned to a tag.

## Notes

Pi packages currently auto-discover extensions, skills, prompt templates, and themes. The `agents/` chain files and top-level `APPEND_SYSTEM.md` are kept here for portability, but need to be linked or copied into the standard pi locations by `scripts/install-local-links.sh`.
