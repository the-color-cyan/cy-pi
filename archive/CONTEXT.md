# Archived Evanescent Context

This context defines the language for the archived Evanescent feature (parked under `archive/`; not loaded by the active agent-home workflow). It builds on the generic startup-migration language in the root `CONTEXT.md`.

## Language

**Evanescent run**:
A temporary pi run launched with `--evanescent` for a fresh session whose workspace is isolated under a cleanup-managed parent directory.
_Avoid_: Scratch folder, temp project

**Evanescent workspace**:
The empty cwd used by pi inside an **Evanescent run**, without automatic git initialization.
_Avoid_: Evanescent run directory, metadata directory

**Cradle**:
The configurable user-owned home for materialized **Evanescent runs**, defaulting to `~/cradle`.
_Avoid_: Temp cache, workspace folder

**Materialize**:
To move an entire **Evanescent run** from temporary storage into the **Cradle**, normally through `/materialize [name]`; when no name is provided, the destination name comes from the run id or timestamp.
_Avoid_: Export workspace, copy files

**Active evanescent run**:
An **Evanescent run** protected from cleanup because its metadata identifies a live pi process or active lock.
_Avoid_: Current temp folder

## Relationships

- The generic cd **Startup migration** API supports non-fresh sessions, but `--evanescent` is fresh-session only.
- `--evanescent` rejects incompatible non-fresh modes with a hard startup error when possible; in v1, it enforces this by detecting a non-empty started session.
- An **Evanescent run** contains an **Evanescent workspace** plus metadata outside that workspace.
- An **Evanescent run** is identified by run-root metadata containing id, created time, workspace path, materialization state/path, pid, and schema version.
- Each `--evanescent` launch creates a new **Evanescent run**, even when launched from an existing **Evanescent workspace**.
- **Materialize** moves the whole **Evanescent run** into the **Cradle**, keeping the **Evanescent workspace** as the cwd inside it.
- **Materialize** fails rather than overwriting, merging, or auto-suffixing an existing **Cradle** destination.
- **Materialize** is meaningful only inside an **Evanescent run**; outside one, it errors with guidance.
- **Materialize** can be invoked by slash command or by a model-callable tool that requires user confirmation.
- A model-requested **Materialize** without confirmation support fails safely and instructs the user to run `/materialize`.
- When an **Evanescent run** is active, the extension gives the model concise context about the temporary workspace and materialization path.
- Cleanup applies only to unmaterialized **Evanescent runs** in temporary storage; the **Cradle** is never cleaned automatically.
- In v1, cleanup runs at evanescent startup rather than on a periodic active-session timer.
- Cleanup removes unmaterialized **Evanescent runs** by both maximum age and maximum retained run count.
- Cleanup skips the current **Evanescent run** and any **Active evanescent run**.
- After **Materialize**, pi immediately migrates cwd/session to the moved **Evanescent workspace**.
