import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	SessionEntry,
	SessionHeader,
} from "@mariozechner/pi-coding-agent";

const CURRENT_SESSION_VERSION = 3;
let activeCwd = process.cwd();

function usage(currentCwd: string): string {
	return `Current directory: ${currentCwd}\nUsage: /cd <path>`;
}

function unquote(input: string): string {
	const trimmed = input.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
			return trimmed.slice(1, -1);
		}
	}
	return trimmed;
}

function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

function resolveTargetCwd(rawPath: string, currentCwd: string): string {
	return resolve(currentCwd, expandHome(unquote(rawPath)));
}

function assertDirectory(path: string): void {
	if (!existsSync(path)) {
		throw new Error(`Path does not exist: ${path}`);
	}
	const stats = statSync(path);
	if (!stats.isDirectory()) {
		throw new Error(`Path is not a directory: ${path}`);
	}
}

function defaultSessionDir(cwd: string): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(agentDir, "sessions", safePath);
}

function createMigratedSessionFile(
	ctx: ExtensionCommandContext,
	targetCwd: string,
): string {
	const timestamp = new Date().toISOString();
	const id = randomUUID();
	const sessionDir = defaultSessionDir(targetCwd);
	mkdirSync(sessionDir, { recursive: true });

	const sessionFile = join(
		sessionDir,
		`${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`,
	);
	const currentSessionFile = ctx.sessionManager.getSessionFile();
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id,
		timestamp,
		cwd: targetCwd,
		parentSession: currentSessionFile,
	};

	const entries: SessionEntry[] = ctx.sessionManager.getEntries();
	const lines = [header, ...entries].map((entry) => JSON.stringify(entry));
	writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf8");
	return sessionFile;
}

function displayPath(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
	return path;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		activeCwd = ctx.cwd;
	});

	pi.registerCommand("cd", {
		description:
			"Change pi's working directory by migrating the current session to another directory",
		getArgumentCompletions: (prefix: string) => {
			const rawPrefix = unquote(prefix);
			const expanded = expandHome(rawPrefix);
			const slash = expanded.lastIndexOf("/");
			const base = slash >= 0 ? expanded.slice(0, slash + 1) : "";
			const partial = slash >= 0 ? expanded.slice(slash + 1) : expanded;
			const searchDir = resolve(activeCwd, base || ".");

			try {
				if (!statSync(searchDir).isDirectory()) return null;
				return readdirSync(searchDir, { withFileTypes: true })
					.filter(
						(entry) => entry.isDirectory() && entry.name.startsWith(partial),
					)
					.slice(0, 50)
					.map((entry) => {
						const value = `${base}${entry.name}/`;
						return { value, label: value };
					});
			} catch {
				return null;
			}
		},
		handler: async (args, ctx) => {
			const trimmedArgs = args.trim();
			if (!trimmedArgs) {
				ctx.ui.notify(usage(ctx.cwd), "info");
				return;
			}

			await ctx.waitForIdle();

			let targetCwd: string;
			try {
				targetCwd = resolveTargetCwd(trimmedArgs, ctx.cwd);
				assertDirectory(targetCwd);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}

			if (targetCwd === ctx.cwd) {
				ctx.ui.notify(`Already in ${displayPath(targetCwd)}.`, "info");
				return;
			}

			const previousCwd = ctx.cwd;
			const targetSessionFile = createMigratedSessionFile(ctx, targetCwd);
			let result: { cancelled: boolean };
			try {
				result = await ctx.switchSession(targetSessionFile, {
					withSession: async (newCtx) => {
						await newCtx.sendMessage({
							customType: "cd.cwd_changed",
							content: `Session working directory changed from ${previousCwd} to ${newCtx.cwd}. Treat ${newCtx.cwd} as the current cwd for future filesystem operations.`,
							display: false,
							details: { previousCwd, cwd: newCtx.cwd },
						});
						newCtx.ui.notify(
							`Changed directory to ${displayPath(newCtx.cwd)}. Session migrated to ${targetSessionFile}`,
							"info",
						);
					},
				});
			} catch (error) {
				try {
					unlinkSync(targetSessionFile);
				} catch {
					// Ignore cleanup failures; the switch error is more useful.
				}
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}

			if (result.cancelled) {
				try {
					unlinkSync(targetSessionFile);
				} catch {
					// Ignore cleanup failures after cancellation.
				}
				ctx.ui.notify(
					"Directory change cancelled by another extension.",
					"warning",
				);
			}
		},
	});
}
