# Repo Instructions

This repo packages portable pi resources.

- Do not commit auth files, sessions, run history, API keys, or local caches.
- Keep `package.json -> pi` limited to resources pi packages understand: `extensions`, `skills`, `prompts`, and `themes`.
- Keep pi-subagents chains in `agents/`; use `scripts/install-local-links.sh` to link them into `~/.pi/agent/agents`.
- Prefer portable paths. Use `$HOME`, `homedir()`, or environment variables instead of absolute machine-specific paths.
- If adding runtime npm dependencies for extensions, put them in `dependencies` and keep pi runtime packages as peer dependencies with `"*"`.
