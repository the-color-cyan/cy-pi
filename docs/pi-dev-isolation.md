# Isolated dev Pi setup

This repo is used as the custom-resource source for the local development Pi harness.
The development harness is isolated from the normal Pi/OMP home so third-party experiments
can use `~/.pi` without mixing with custom cy-pi resources.

## Layout

```text
~/.pi-dev/agent/       # active home for custom/dev `pi`
~/.pi/agent/           # normal/default Pi home; keep available for OMP or experiments
~/pi/cy-pi/            # source of custom extensions, skills, prompts, themes, agents
```

`~/.pi-dev/agent` contains symlinks back to this checkout:

```text
~/.pi-dev/agent/extensions -> ~/pi/cy-pi/extensions
~/.pi-dev/agent/skills     -> ~/pi/cy-pi/skills
~/.pi-dev/agent/prompts    -> ~/pi/cy-pi/prompts
~/.pi-dev/agent/themes     -> ~/pi/cy-pi/themes
~/.pi-dev/agent/agents     -> ~/pi/cy-pi/agents
```

The top-level prompt/support files are linked too:

```text
APPEND_SYSTEM.md
SUBAGENTS_ASYNC_PLAYBOOK.md
commit-message-prompt.md
```

## Setup / refresh

From this repo:

```bash
./scripts/setup-pi-dev-isolation.sh
```

The script:

1. creates `~/.pi-dev/agent`
2. copies `auth.json` and `settings.json` from `~/.pi/agent` on first run only
3. removes this repo's `git:github.com/the-color-cyan/cy-pi` package entry from the dev settings
4. updates the subagent session directory to `~/.pi-dev/agent/sessions/subagent`
5. links this repo's custom resources into `~/.pi-dev/agent`

It does not delete or rewrite the normal `~/.pi/agent` tree.

## Swap active shell mode

Use the mode switcher from this repo:

```bash
./scripts/use-pi-mode.sh dev     # `pi` uses ~/.pi-dev/agent; `pi-normal` uses ~/.pi/agent
./scripts/use-pi-mode.sh normal  # `pi` uses ~/.pi/agent; `pi-dev` uses ~/.pi-dev/agent
./scripts/use-pi-mode.sh status
```

The script updates marked blocks in all supported interactive shell rc files:

```text
~/.bashrc
~/.zshrc
~/.config/fish/config.fish
```

Open a new shell after switching, or source the relevant rc file (`source ~/.zshrc`, `source ~/.bashrc`, or `source ~/.config/fish/config.fish`).

Dev mode defines `pi` as the isolated harness and `pi-normal` as the default harness. Normal mode defines `pi` as the default harness and `pi-dev` as the isolated harness.

For one-off/testing edits to a single rc file, set `PI_SHELL_RC=/path/to/rc` when running `scripts/use-pi-mode.sh`.

## Notes

- Avoid `pi install git:github.com/the-color-cyan/cy-pi` in the dev harness while using symlinks; it can duplicate commands/skills.
- Third-party packages can still live in the dev settings if needed, but custom cy-pi resources should come from the symlinks.
- Project-local `.pi/` directories are still shared by both harnesses when running inside that project.
