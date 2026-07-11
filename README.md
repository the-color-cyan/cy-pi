# cy-pi

Portable pi agent resources for cyan.

This repo is intended to be used directly as a Pi agent home: clone it and run pi with this checkout as `PI_CODING_AGENT_DIR`, like using a Neovim config checkout in place.

## Contents

- `extensions/` — pi TypeScript extensions
  - `agent-home-update.ts` — notifies on startup when tracked agent-home commits are available
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
- `openspec/` — OpenSpec configuration and project specifications
- `.pi/` — OpenSpec-generated Pi prompts and skills
- `agents/` — active pi-subagents custom agents and chain definitions, when present
- `archive/` — inert resources kept for reference only; these are not loaded by the direct agent-home workflow
- `APPEND_SYSTEM.md` — global system-prompt append content
- `SUBAGENTS_ASYNC_PLAYBOOK.md` — async subagent reference used by the global instructions
- `settings.example.json` — portable example settings with secrets/runtime state removed
- `commit-message-prompt.md` — default global prompt for `/commit-message`

Not included: `auth.json`, local `settings.json`, sessions, run history, caches, generated worktrees, or API keys.

## Use as your Pi agent home

Clone the repo and initialize the canonical runtime plus ignored runtime files:

```bash
git clone git@github.com:the-color-cyan/cy-pi.git ~/pi/cy-pi
cd ~/pi/cy-pi
./scripts/init-agent-home.sh
exec "$SHELL"
pi
```

The root `package.json` and `package-lock.json` pin the exact Pi runtime used on every machine. Initialization installs that lock with `npm ci`, creates `./bin/pi`, and configures bash, zsh, and fish to put only this checkout's `bin/` first on `PATH`. The wrapper sets `PI_CODING_AGENT_DIR` and executes the checkout-local `node_modules/.bin/pi`; it never selects a global Pi installation. Re-running init repairs older managed PATH blocks that exposed `node_modules/.bin` directly.

`./scripts/pi-home.sh` launches the same wrapper and retains support for `--evanescent`.

### Synchronizing and updating

Normal Git synchronization carries the pinned runtime version to other machines. After pulling, run `./scripts/init-agent-home.sh`; a successful agent-home pull through `pi update` also reconciles both lockfiles with `npm ci`.

Bare `pi update` (and `pi update self`, `pi update pi`, or `pi update --self`) updates the three tracked `@earendil-works` Pi packages to the same latest exact version. `pi update --all` does that and then updates configured Pi packages. Extension-only and source-specific update forms are delegated to the local Pi runtime.

A runtime update intentionally changes tracked files. Commit and push them so every machine receives the same version:

```bash
pi update
git add package.json package-lock.json
git commit -m "chore(pi): update pinned runtime"
git push
```

At startup, the loaded extension checks whether this repo has remote commits not yet pulled and notifies you in the session UI. It respects `PI_OFFLINE=1`.

This keeps resources editable in place: `extensions/`, `skills/`, `prompts/`, `themes/`, `agents/`, `APPEND_SYSTEM.md`, and the top-level prompt/playbook files are all loaded from the checkout. Runtime state such as `auth.json`, `settings.json`, sessions, run history, tracker state, and generated worktrees is ignored by git.

Do not install this checkout as a package inside its own `settings.json`; that can duplicate commands/skills.

## OpenSpec

[OpenSpec](https://openspec.dev/) is installed as a root development dependency. Its generated Pi skills and prompt templates under `.pi/` are loaded through the package manifest, so they are available when this checkout is used as the Pi agent home.

Use the pinned CLI with:

```bash
npm exec openspec -- <command>
```

In Pi, restart after updating generated resources, then use `/opsx-propose`, `/opsx-apply`, `/opsx-archive`, `/opsx-explore`, `/opsx-sync`, or `/opsx-update`.

## commit-message extension

`/commit-message` uses the active pi model to generate a commit message from staged changes. If nothing is staged, it falls back to the working tree diff. The generated message is copied to the clipboard and lazygit is launched in the repo when available.

The generated message is installed as a temporary `git commit.template` for that lazygit process, so lazygit's commit-with-editor action (`C` by default) opens an editor prefilled with it. For lazygit's inline commit box (`c`), paste from the clipboard. If lazygit is unavailable or pi is not running with an interactive TUI, the command falls back to the clipboard/display flow.

Use `/commit-message --clipboard-only` (aliases: `--clipboard`, `--no-lazygit`, `--no-lg`) to skip lazygit and only copy/show the generated message.

Prompt lookup order:

1. Repo override: `<git-root>/.pi/commit-message-prompt.md`
2. Global prompt: `~/.pi/agent/commit-message-prompt.md`
3. Built-in fallback prompt inside the extension

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

`extensions/github-tracker.ts` exposes tab completion for `/gh-track`, `/gh-issue`, `/gh-work`, and `/gh-labels` subcommands. It also completes `/gh-track projects <status|enable|disable|on|off>`, `/gh-issue stage <number> <stage>`, `/gh-work pane <mode>`, and `/gh-work done --close`.

## git-ai extension

`extensions/git-ai.ts` uses:

```bash
$GIT_AI_BIN
```

when set. Otherwise it uses `~/.git-ai/bin/git-ai` if present, then falls back to `git-ai` on `PATH`.

Set `GIT_AI_BIN` if a target machine installs `git-ai` somewhere else.

## Settings

`settings.example.json` is the portable reference setup for fresh clones. `scripts/init-agent-home.sh` copies it to ignored local `settings.json` when missing, materializes checkout-local paths, creates ignored runtime directories, and installs both root and `npm/` lockfiles with `npm ci`. The root lock owns the Pi runtime version; `npm/` owns configured third-party package dependencies. Auth, local settings, sessions, caches, and secrets remain machine-local.
