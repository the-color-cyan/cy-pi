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

---

# Code Context

## Files Retrieved

1. `extensions/commit-message.ts` (lines 1-180) - imports, option/types, `git()` wrapper using `pi.exec`.
2. `extensions/commit-message.ts` (lines 180-360) - worktree discovery/grouping helpers used by `/yeet`.
3. `extensions/commit-message.ts` (lines 540-670) - `/yeet` command implementation and final notification.
4. `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` (lines 821-835) - extension command handlers are awaited directly by Pi.
5. `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js` (lines 1761-1774, 2427-2445) - `ctx.ui.notify(..., "info")` routes through TUI-managed `showStatus()`.
6. `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` (lines 1474-1480) - `pi.exec` captures command stdout/stderr.

## Key Code

`/yeet` emits several TUI notifications, then prints the planned commits directly to process stdout:

```ts
// extensions/commit-message.ts:601-613
const summary = planned
  .map(({ group, message }, index) => ...)
  .join("\n\n---\n\n");
console.log(summary);
```

After the actual git operations, the line the user sees is a normal Pi TUI notification:

```ts
// extensions/commit-message.ts:651-657
if (options.push) {
  const pushResult = await git(pi, root, ["push"]);
  if (pushResult.code !== 0) throw new Error(pushResult.stderr.trim());
  ctx.ui.notify(`Committed ${planned.length} group(s) and pushed.`, "info");
}
```

Pi handles extension commands by awaiting the handler directly:

```js
// .../dist/core/agent-session.js:830-833
const ctx = this._extensionRunner.createCommandContext();
try {
  await command.handler(args, ctx);
  return true;
}
```

In interactive mode, `ctx.ui.notify(..., "info")` is TUI-managed and calls `showStatus()`:

```js
// .../dist/modes/interactive/interactive-mode.js:1764-1772
showExtensionNotify(message, type) {
  if (type === "error") this.showError(message);
  else if (type === "warning") this.showWarning(message);
  else this.showStatus(message);
}
```

`showStatus()` mutates the chat container and requests a render; it does not write raw terminal output:

```js
// .../dist/modes/interactive/interactive-mode.js:2431-2445
showStatus(message) {
  ...
  const text = new Text(theme.fg("dim", message), 1, 0);
  this.chatContainer.addChild(spacer);
  this.chatContainer.addChild(text);
  this.lastStatusSpacer = spacer;
  this.lastStatusText = text;
```

## Architecture

`/yeet` is a registered extension command. Pi executes it inside the active interactive runtime and awaits completion. The command uses:

- `ctx.ui.notify()` for progress/final status, which is safe because it goes through Pi's TUI renderer.
- `pi.exec("git", ...)` for git operations, which captures stdout/stderr rather than inheriting them.
- One direct `console.log(summary)` while the TUI is active.

The likely TUI break is not the final `ctx.ui.notify("Committed ... and pushed.")` itself. That message is just the last visible TUI action before the command returns. The suspicious operation is the earlier `console.log(summary)` at `extensions/commit-message.ts:612`: direct writes to stdout bypass the TUI renderer/alternate-screen bookkeeping and can corrupt the interactive display. Because it happens before commit/push, the corruption may only become obvious after the final notification/render.

## Start Here

Open `extensions/commit-message.ts` at lines 601-613. Minimal fix: remove the raw `console.log(summary)` or replace it with TUI-safe output, e.g. `ctx.ui.notify(summary, "info")` for dry-run/debug visibility, or a custom/session message if multiline persistent display is desired. If a detailed plan must be shown, prefer a Pi-managed UI surface rather than writing to stdout.

Also consider making final notifications singular/plural only for polish; it is unrelated to the TUI break.
