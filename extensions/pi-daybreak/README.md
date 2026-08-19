# pi-daybreak

Live account-scoped model discovery for pi's `openai-codex` provider.

pi ships a static built-in Codex model catalog. This extension queries the
ChatGPT Codex backend's model catalog — `GET /backend-api/codex/models`, the
same endpoint Codex CLI uses — at session start, and exposes any models your
account is entitled to that are missing from the built-in list (e.g.
`gpt-daybreak-*` aliases).

Discovered models clone metadata from the built-in `gpt-5.6-sol` entry
(cost, context window, thinking-level map, tool-compat flags), so they track
upstream pi-ai updates instead of duplicating a static copy.

## Behavior

- Runs on `session_start` with the provider's resolved OAuth credential;
  re-registers `openai-codex` with built-ins plus discovered extras (pi's
  provider layer replaces the model list wholesale, so built-ins are
  re-supplied).
- Only catalog entries with `visibility: "list"` are added.
- Offline sessions, missing auth, and fetch failures leave the built-in
  list unchanged.

## Caveats

- The composed list is cached at `<agent dir>/cache/pi-daybreak/models.json`
  and re-registered synchronously at extension load, which runs before
  `--model` resolution. Selecting a discovered model via `--model` only
  warns on the first-ever run (no cache yet); the request still works (the
  backend accepts the slug), and the cache also covers offline sessions.
- Catalog presence signals entitlement, not guaranteed inference — the
  backend can still reject requests server-side.
- Discovered models inherit sol's thinking-level map and compat flags. If a
  discovered model differs (e.g. no `max` thinking level), adjust after
  selection.
- The catalog is gated on a `client_version` parameter (see
  `CLIENT_VERSION` in `index.ts`); bump it to track Codex CLI releases.
