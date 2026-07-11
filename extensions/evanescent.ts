import { unlinkSync } from "node:fs";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createMigratedSessionFile } from "./lib/cd-migration.ts";
import {
	cleanupEvanescentRuns,
	createEvanescentRun,
	defaultTempRoot,
	findEvanescentRunFromWorkspace,
	materializeRun,
	resolveCradlePath,
	rollbackMaterializedRun,
} from "./lib/evanescent.ts";
import {
	markStartupCwdMigrationFailed,
	requestStartupCwd,
	startupCwdRequestsWereConsumed,
} from "./lib/cd-startup.ts";

function envNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cradlePath(): string {
	return resolveCradlePath(process.env.PI_EVANESCENT_CRADLE);
}

export type DirectStartupMigrationInput = {
	evanescentFlag: boolean;
	eventReason: string;
	isAlreadyInEvanescentWorkspace: boolean;
	startupRequestConsumed: boolean;
	hasPendingStartupRequest: boolean;
};

export function argvHasBooleanFlag(argv: string[], name: string): boolean {
	const flag = `--${name}`;
	const negatedFlag = `--no-${name}`;
	for (const arg of argv.slice(2)) {
		if (arg === negatedFlag) return false;
		if (arg === flag) return true;
		if (arg.startsWith(`${flag}=`)) {
			const value = arg.slice(flag.length + 1).toLowerCase();
			return !["0", "false", "no", "off"].includes(value);
		}
	}
	return false;
}

export function shouldRunDirectStartupMigration({
	evanescentFlag,
	eventReason,
	isAlreadyInEvanescentWorkspace,
	startupRequestConsumed,
	hasPendingStartupRequest,
}: DirectStartupMigrationInput): boolean {
	if (!evanescentFlag) return false;
	if (eventReason !== "startup") return false;
	if (isAlreadyInEvanescentWorkspace) return false;
	if (startupRequestConsumed) return false;
	if (hasPendingStartupRequest) return false;
	return true;
}

type MigratingContext = {
	cwd: string;
	sessionManager: {
		getSessionFile(): string | undefined;
		getEntries(): SessionEntry[];
	};
	ui: { notify(message: string, level: "info" | "warning" | "error"): void };
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

type EvanescentRun = Awaited<ReturnType<typeof createEvanescentRun>>;

function isMigratingContext(ctx: unknown): ctx is MigratingContext {
	const candidate = ctx as Partial<MigratingContext>;
	return (
		typeof candidate.waitForIdle === "function" &&
		typeof candidate.switchSession === "function"
	);
}

export async function migrateToWorkspace(
	ctx: MigratingContext,
	workspace: string,
	message: string,
): Promise<boolean> {
	const targetSessionFile = createMigratedSessionFile({
		sessionManager: ctx.sessionManager,
		targetCwd: workspace,
	});
	const previousCwd = ctx.cwd;
	let result: { cancelled: boolean };
	try {
		result = await ctx.switchSession(targetSessionFile, {
			withSession: async (newCtx) => {
				await newCtx.sendMessage({
					customType: "evanescent.cwd_changed",
					content: `${message} Current workspace: ${newCtx.cwd}`,
					display: false,
					details: { previousCwd, cwd: newCtx.cwd },
				});
				newCtx.ui.notify(message, "info");
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
		ctx.ui.notify("Evanescent workspace migration cancelled.", "warning");
		return false;
	}
	return true;
}

export async function materializeCurrentRun(
	ctx: MigratingContext,
	cradle: string,
	name?: string,
): Promise<void> {
	await ctx.waitForIdle();
	const run = await findEvanescentRunFromWorkspace(ctx.cwd);
	if (!run) {
		ctx.ui.notify(
			"/materialize only works inside an Evanescent workspace. Launch with --evanescent first.",
			"error",
		);
		return;
	}
	const result = await materializeRun(run.root, cradle, name);
	let migrated = false;
	try {
		migrated = await migrateToWorkspace(
			ctx,
			result.workspacePath,
			`Materialized Evanescent run to ${result.destinationRoot}.`,
		);
	} catch (error) {
		await rollbackMaterializedRun(result.destinationRoot, run);
		throw error;
	}
	if (!migrated) {
		await rollbackMaterializedRun(result.destinationRoot, run);
		ctx.ui.notify(
			"Materialization cancelled; restored Evanescent run in temporary storage.",
			"warning",
		);
	}
}

async function prepareStartupRun() {
	const tempRoot = process.env.PI_EVANESCENT_TEMP_ROOT || defaultTempRoot();
	const run = await createEvanescentRun({ tempRoot });
	await cleanupEvanescentRuns(tempRoot, {
		currentRunRoot: run.root,
		maxAgeMs: envNumber("PI_EVANESCENT_MAX_AGE_MS", 7 * 24 * 60 * 60 * 1000),
		maxRetainedRuns: envNumber("PI_EVANESCENT_MAX_RETAINED_RUNS", 25),
	});
	return run;
}

export default async function (pi: ExtensionAPI) {
	pi.registerFlag("evanescent", {
		description: "Launch into a fresh disposable Evanescent workspace",
		type: "boolean",
	});

	// Extension CLI flags are not guaranteed to be available through getFlag()
	// during factory execution, but startup cwd requests must be registered before
	// the cd extension's session_start handler consumes them. Detect the raw CLI
	// flag here so --evanescent can prepare its workspace early enough.
	const startupRun =
		pi.getFlag("evanescent") || argvHasBooleanFlag(process.argv, "evanescent")
			? await prepareStartupRun()
			: undefined;
	let pendingStartupRun: EvanescentRun | undefined = startupRun;
	if (startupRun)
		requestStartupCwd("evanescent", startupRun.workspace, {
			requiresFreshSession: true,
		});

	pi.on("session_start", async (event, ctx) => {
		const isAlreadyInEvanescentWorkspace = Boolean(
			ctx.cwd.endsWith("/workspace") &&
				(await findEvanescentRunFromWorkspace(ctx.cwd)),
		);
		if (
			!shouldRunDirectStartupMigration({
				evanescentFlag: Boolean(pi.getFlag("evanescent")),
				eventReason: event.reason,
				isAlreadyInEvanescentWorkspace,
				startupRequestConsumed: startupCwdRequestsWereConsumed(),
				hasPendingStartupRequest: Boolean(startupRun),
			})
		)
			return;

		const run = pendingStartupRun ?? (await prepareStartupRun());
		pendingStartupRun = run;

		if (!isMigratingContext(ctx)) {
			const message =
				"Evanescent startup migration cannot run from this pi startup context. Shutting down to avoid continuing outside the temporary workspace. For this pi version, use scripts/pi-home.sh --evanescent so the workspace is selected before pi starts.";
			markStartupCwdMigrationFailed(message);
			ctx.ui.notify(message, "error");
			ctx.shutdown();
			throw new Error(message);
		}

		await ctx.waitForIdle();
		if (ctx.sessionManager.getEntries().length > 0) {
			const message = "--evanescent requires a fresh empty startup session.";
			ctx.ui.notify(message, "error");
			throw new Error(message);
		}

		pendingStartupRun = undefined;
		await migrateToWorkspace(
			ctx,
			run.workspace,
			`Started Evanescent workspace ${run.metadata.id}. Use /materialize [name] to keep it.`,
		);
	});

	pi.registerTool({
		name: "materialize",
		label: "Materialize Evanescent Run",
		description:
			"Request preservation of the current Evanescent run in the Cradle. This requires explicit user confirmation; when confirmation UI is unavailable, instructs the user to run /materialize.",
		promptSnippet:
			"materialize: request keeping an Evanescent workspace; requires explicit user confirmation",
		promptGuidelines: [
			"Use only when the user asks to keep or preserve an Evanescent workspace.",
			"If confirmation is unavailable, ask the user to run /materialize [name] themselves.",
		],
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({
					description: "Optional destination name under the Cradle",
				}),
			),
		}),
		async execute(
			_toolCallId,
			params: { name?: string },
			_signal,
			_onUpdate,
			ctx,
		) {
			const run = await findEvanescentRunFromWorkspace(ctx.cwd);
			if (!run) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Materialize only works inside an Evanescent workspace. Launch with --evanescent first.",
						},
					],
					details: { ok: false },
				};
			}

			const name = params.name?.trim() || undefined;
			const command = `/materialize${name ? ` ${name}` : ""}`;
			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Materialization requires explicit user confirmation. Ask the user to run ${command} to keep this workspace.`,
						},
					],
					details: { ok: false, requiresConfirmation: true, command },
				};
			}

			const confirmed = await ctx.ui.confirm(
				"Materialize Evanescent run?",
				`Move this cleanup-managed Evanescent run into ${cradlePath()} and continue working there?\n\nCommand: ${command}`,
			);
			if (!confirmed) {
				return {
					content: [
						{
							type: "text" as const,
							text: "Materialization cancelled by user.",
						},
					],
					details: { ok: false, cancelled: true },
				};
			}

			return {
				content: [
					{
						type: "text" as const,
						text: `Materialization confirmed, but model tool contexts cannot safely perform session migration directly. Ask the user to run ${command} to keep this workspace.`,
					},
				],
				details: {
					ok: false,
					requiresCommandConfirmation: true,
					command,
				},
			};
		},
	});

	pi.registerCommand("materialize", {
		description:
			"Move the current Evanescent run into the Cradle and keep working there",
		handler: async (args, ctx) => {
			try {
				await materializeCurrentRun(
					ctx,
					cradlePath(),
					args.trim() || undefined,
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const run = await findEvanescentRunFromWorkspace(ctx.cwd);
		if (!run || run.metadata.materialized) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nEvanescent mode: the current workspace is temporary and cleanup-managed. If the work becomes valuable, ask the user to run /materialize [name].`,
		};
	});
}
