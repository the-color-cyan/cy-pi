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
