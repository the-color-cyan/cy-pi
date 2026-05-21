# Implement evanescent with startup migration

Evanescent v1 uses the cd extension's **Startup migration** mechanism rather than true **Launch cwd selection** in pi core. This keeps the feature implementable as a portable cy-pi extension while still moving into an isolated workspace before the first user or agent turn; the trade-off is that pi briefly creates an initial runtime/session in the original cwd before migrating.

## Considered Options

- Add a pi core lifecycle hook so extension flags can choose cwd before session/resource/tool initialization.
- Use a helper script to launch pi directly from a temp workspace.
- Use cd **Startup migration** from `--evanescent` and optionally add a helper script later.

## Consequences

`--evanescent` is fresh-session only in v1 and enforces that contract by detecting non-empty started sessions. The generic cd **Startup migration** API remains reusable for non-fresh sessions with /cd-style migrated child session semantics.
