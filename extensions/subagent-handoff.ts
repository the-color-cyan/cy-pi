import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

let lastParentSessionFile: string | null = null;

function getAsyncRoots(): string[] {
	if (process.env.PI_SUBAGENTS_ASYNC_DIR) {
		return [path.resolve(process.env.PI_SUBAGENTS_ASYNC_DIR)];
	}
	const tmp = process.env.PI_TMP_DIR || os.tmpdir();
	return [
		path.join(tmp, "pi-subagents-project", "async-subagent-runs"),
		path.join(tmp, "pi-subagents-user", "async-subagent-runs"),
	];
}

function findRunDirs(idOrPrefix: string): string[] {
	const matches: string[] = [];
	for (const root of getAsyncRoots()) {
		if (!fs.existsSync(root)) continue;
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (entry.name === idOrPrefix || entry.name.startsWith(idOrPrefix)) {
				matches.push(path.join(root, entry.name));
			}
		}
	}
	return matches;
}

function findLatestRunDir(): string | undefined {
	const allRuns: Array<{ dir: string; mtimeMs: number }> = [];
	for (const root of getAsyncRoots()) {
		if (!fs.existsSync(root)) continue;
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(root, entry.name);
			try {
				const statusPath = path.join(dir, "status.json");
				const stat = fs.existsSync(statusPath) ? fs.statSync(statusPath) : fs.statSync(dir);
				allRuns.push({ dir, mtimeMs: stat.mtimeMs });
			} catch {
				// ignore unreadable entries
			}
		}
	}
	allRuns.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return allRuns[0]?.dir;
}

function readRunSessionFile(runDir: string): string | undefined {
	const statusPath = path.join(runDir, "status.json");
	if (!fs.existsSync(statusPath)) return undefined;
	try {
		const status = JSON.parse(fs.readFileSync(statusPath, "utf-8")) as { sessionFile?: string };
		return status.sessionFile;
	} catch {
		return undefined;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("subattach", {
		description: "Attach to a subagent run session by async run id/prefix",
		handler: async (args, ctx) => {
			const idOrPrefix = args.trim();
			if (!idOrPrefix) {
				ctx.ui.notify("Usage: /subattach <asyncRunIdOrPrefix>", "error");
				return;
			}

			const matches = findRunDirs(idOrPrefix);
			if (matches.length === 0) {
				ctx.ui.notify(`No async run found for '${idOrPrefix}'.`, "error");
				return;
			}
			if (matches.length > 1) {
				const options = matches.map((dir) => `${path.basename(dir)} (${dir})`);
				ctx.ui.notify(
					`Ambiguous id '${idOrPrefix}'. Be more specific. Matches: ${options.join(", ")}`,
					"error",
				);
				return;
			}

			const runDir = matches[0]!;
			const sessionFile = readRunSessionFile(runDir);
			if (!sessionFile) {
				ctx.ui.notify(`Run ${path.basename(runDir)} has no sessionFile in status.json yet.`, "error");
				return;
			}
			if (!fs.existsSync(sessionFile)) {
				ctx.ui.notify(`Session file not found: ${sessionFile}`, "error");
				return;
			}

			const current = ctx.sessionManager.getSessionFile();
			lastParentSessionFile = current ?? null;
			await ctx.switchSession(sessionFile);
		},
	});

	pi.registerCommand("subattach-latest", {
		description: "Attach to the most recently updated async subagent run session",
		handler: async (_args, ctx) => {
			const runDir = findLatestRunDir();
			if (!runDir) {
				ctx.ui.notify("No async runs found.", "error");
				return;
			}
			const sessionFile = readRunSessionFile(runDir);
			if (!sessionFile) {
				ctx.ui.notify(`Latest run ${path.basename(runDir)} has no sessionFile in status.json yet.`, "error");
				return;
			}
			if (!fs.existsSync(sessionFile)) {
				ctx.ui.notify(`Session file not found: ${sessionFile}`, "error");
				return;
			}
			const current = ctx.sessionManager.getSessionFile();
			lastParentSessionFile = current ?? null;
			await ctx.switchSession(sessionFile);
		},
	});

	pi.registerCommand("subback", {
		description: "Switch back to the previous session saved by /subattach",
		handler: async (_args, ctx) => {
			if (!lastParentSessionFile) {
				ctx.ui.notify("No previous session recorded. Use /subattach first.", "error");
				return;
			}
			if (!fs.existsSync(lastParentSessionFile)) {
				ctx.ui.notify(`Previous session file no longer exists: ${lastParentSessionFile}`, "error");
				return;
			}
			await ctx.switchSession(lastParentSessionFile);
		},
	});
}
