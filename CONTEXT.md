# cy-pi Agent Home

This context defines the language for portable pi agent-home workflows and extensions in this repository.

## Language

**Startup migration**:
A best-effort cwd change requested during extension startup and applied before the first user or agent turn is processed.
_Avoid_: True launch cwd selection, pre-runtime cwd selection

**Launch cwd selection**:
A cwd choice made before pi creates the initial session, resources, tools, and runtime services.
_Avoid_: Startup migration

**Startup cwd request**:
An in-process extension request for a **Startup migration** to a target cwd, issued while the requesting extension is loaded before the first session starts.
_Avoid_: Environment-triggered cwd change, hidden slash-command request, session-start cwd request, late cwd request

**Startup cwd conflict**:
A state where multiple **Startup cwd requests** name different target cwds for the same startup.
_Avoid_: Last-writer-wins cwd selection

**Fresh startup session**:
A startup session with no non-header entries at the moment a **Startup migration** succeeds.
_Avoid_: Empty-looking session, disposable session

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

- A **Startup migration** may approximate **Launch cwd selection** for interactive workflows, but does not replace it.
- A **Startup cwd request** is issued by an extension during extension loading and fulfilled by the cd extension.
- Identical **Startup cwd requests** coalesce; a **Startup cwd conflict** is resolved by user choice when UI is available and otherwise fails closed with no migration.
- A **Fresh startup session** may be deleted after a successful **Startup migration**; non-fresh sessions follow /cd-style migrated child session semantics.
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

## Example dialogue

> **Dev:** "Can the extension change cwd at startup?"
> **Domain expert:** "Yes, as a **Startup migration** before the first turn, but not as **Launch cwd selection** before pi initializes."

## Flagged ambiguities

- "Startup cwd change" was ambiguous between **Startup migration** and **Launch cwd selection** — resolved: use **Startup migration** for the extension-level implementation.
- "Request a cwd change" could mean shell environment, slash command, or in-process API — resolved: a **Startup cwd request** is in-process extension API only.
- Multiple startup cwd requests could silently depend on extension load order — resolved: only same-target requests coalesce; different targets are a **Startup cwd conflict**.
