# Archive

Files in this directory are parked for reference only.

They are intentionally not active pi resources:

- `package.json` does not include `archive/` in package `files`.
- `package.json -> pi` does not declare `archive/` as a resource root.
- Local setup/link scripts skip this directory and remove repo-owned archived/stale agent links.

Current archived resources include:

- `extensions/subagent-handoff.ts` — former `/subattach`, `/subback`, `/subpane`, and `/subagent-pane` helper extension.
- `extensions/evanescent.ts` — former `--evanescent` temporary-workspace extension with `/materialize` and cleanup support.
- `extensions/git-ai.ts` — former git-ai integration extension.
- `extensions/pair.ts` — former `/pair` pair-programming session extension.
- `extensions/think.ts` — former `/think <level>` thinking-level shortcut extension.
- `extensions/lib/evanescent.ts` — helper library for the archived evanescent extension (run metadata, cleanup, cradle, materialize).
- `tests/evanescent.test.ts` and `tests/evanescent-adapter.test.ts` — tests for the archived evanescent helper and extension.
- `docs/adr/0001-evanescent-startup-migration.md` — ADR for the evanescent startup-migration design.
- `CONTEXT.md` — archived Evanescent domain language (glossary and relationships).

The archived evanescent extension and adapter test still import the shared cd
startup/migration helpers from the active `extensions/lib/` directory via
relative paths; the archived tests run against the archived extension and
helper:

```bash
node --test --experimental-strip-types archive/tests/evanescent*.test.ts
```

Nothing under `archive/` is loaded by pi or by the active test suite.

Move a resource back to the appropriate top-level directory (`extensions/`, `skills/`, `prompts/`, `themes/`, or active `agents/`) before using it again.
