# Repo Instructions

This repo packages portable pi resources.

- Do not commit auth files, sessions, run history, API keys, or local caches.
- Keep `package.json -> pi` limited to resources pi packages understand: `extensions`, `skills`, `prompts`, and `themes`.
- Keep pi-subagents chains in `agents/`; use `scripts/install-local-links.sh` to link them into `~/.pi/agent/agents`.
- Add any new pi extensions to `extensions/` in this repo so they stay portable.
- For local development, use `scripts/use-local-package.sh` so pi loads this checkout as a local package (no symlink conflicts). It also links non-package resources.
- If you temporarily need direct global extension/skill symlinks for testing, use `scripts/install-local-links.sh --force-package-resources`, then clean up with `scripts/install-local-links.sh --no-package-resources` afterward.
- Prefer portable paths. Use `$HOME`, `homedir()`, or environment variables instead of absolute machine-specific paths.
- If adding runtime npm dependencies for extensions, put them in `dependencies` and keep pi runtime packages as peer dependencies with `"*"`.
