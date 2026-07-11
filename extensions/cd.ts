import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	createMigratedSessionFile,
	removeFreshStartupSessionArtifact,
} from "./lib/cd-migration.ts";
import {
	consumeStartupCwdRequests,
	getStartupCwdMigrationFailure,
	markStartupCwdMigrationFailed,
	type StartupCwdRequest,
} from "./lib/cd-startup.ts";
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

type MigratingContext = {
	cwd: string;
	sessionManager: {
		getSessionFile(): string | undefined;
		getEntries(): SessionEntry[];
	};
	ui: { notify(message: string, level: "info" | "warning" | "error"): void };
	hasUI: boolean;
	waitForIdle(): Promise<void>;
	switchSession(
		sessionFile: string,
		options: {
			withSession(newCtx: {
				cwd: string;
				ui: MigratingContext["ui"];
				sendMessage(message: {
					customType: string;
					content: string;
					display: boolean;
					details?: Record<string, unknown>;
				}): Promise<void>;
			}): Promise<void>;
		},
	): Promise<{ cancelled: boolean }>;
};

type PendingStartupMigration = {
	targetCwd: string;
	requests: StartupCwdRequest[];
};

function isMigratingContext(ctx: unknown): ctx is MigratingContext {
	const candidate = ctx as Partial<MigratingContext>;
	return (
		typeof candidate.waitForIdle === "function" &&
		typeof candidate.switchSession === "function"
	);
}

function displayPath(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
	return path;
}

async function runStartupMigration(
	ctx: MigratingContext,
	migration: PendingStartupMigration,
): Promise<void> {
	await ctx.waitForIdle();
	if (
		migration.requests.some((request) => request.requiresFreshSession) &&
		ctx.sessionManager.getEntries().length > 0
	) {
		ctx.ui.notify(
			"Startup cwd migration requires a fresh empty startup session.",
			"error",
		);
		throw new Error(
			"Startup cwd migration requires a fresh empty startup session.",
		);
	}
	const startupSessionFile = ctx.sessionManager.getSessionFile();
	const targetSessionFile = createMigratedSessionFile({
		sessionManager: ctx.sessionManager,
		targetCwd: migration.targetCwd,
	});
	let result: { cancelled: boolean };
	try {
		result = await ctx.switchSession(targetSessionFile, {
			withSession: async (newCtx) => {
				await newCtx.sendMessage({
					customType: "cd.startup_cwd_changed",
					content: `Startup migration changed cwd from ${ctx.cwd} to ${newCtx.cwd}.`,
					display: false,
					details: { previousCwd: ctx.cwd, cwd: newCtx.cwd },
				});
				newCtx.ui.notify(
					`Startup migrated cwd to ${displayPath(newCtx.cwd)}.`,
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
		throw error;
	}
	if (result.cancelled) {
		try {
			unlinkSync(targetSessionFile);
		} catch {
			// Ignore cleanup failures after cancellation.
		}
		ctx.ui.notify(
			"Startup cwd migration cancelled by another extension.",
			"warning",
		);
		return;
	}
	if (startupSessionFile)
		await removeFreshStartupSessionArtifact(startupSessionFile);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		activeCwd = ctx.cwd;
		if (event.reason !== "startup") return;

		const resolution = consumeStartupCwdRequests();
		if (resolution.kind === "none") return;

		let targetCwd: string | undefined;
		if (resolution.kind === "migrate") {
			targetCwd = resolution.targetCwd;
		} else if (ctx.hasUI) {
			targetCwd = await ctx.ui.select(
				"Resolve Startup cwd conflict",
				resolution.targets,
				{ timeout: 120_000 },
			);
			if (!targetCwd) {
				ctx.ui.notify("Startup cwd migration cancelled.", "warning");
				return;
			}
		} else {
			ctx.ui.notify(
				`Startup cwd conflict between: ${resolution.targets.join(", ")}. Migration skipped.`,
				"error",
			);
			return;
		}

		if (targetCwd === ctx.cwd) return;
		const migration = { targetCwd, requests: resolution.requests };
		if (!isMigratingContext(ctx)) {
			const message =
				"Startup cwd migration cannot run from this pi startup context. Shutting down to avoid continuing in the wrong workspace. For Evanescent launches in this pi version, use scripts/pi-home.sh --evanescent so the workspace is selected before pi starts.";
			markStartupCwdMigrationFailed(message);
			ctx.ui.notify(message, "error");
			ctx.shutdown();
			throw new Error(message);
		}

		await runStartupMigration(ctx, migration);
	});

	pi.on("input", async (_event, ctx) => {
		const failure = getStartupCwdMigrationFailure();
		if (!failure) return;
		ctx.ui.notify(failure, "error");
		return { action: "handled" as const };
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
			const targetSessionFile = createMigratedSessionFile({
				sessionManager: ctx.sessionManager,
				targetCwd,
			});
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
