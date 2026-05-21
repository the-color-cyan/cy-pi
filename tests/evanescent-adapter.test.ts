import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import evanescentExtension, {
	materializeCurrentRun,
	migrateToWorkspace,
	shouldRunDirectStartupMigration,
} from "../extensions/evanescent.ts";
import {
	createEvanescentRun,
	readMetadata,
	writeMetadata,
} from "../extensions/lib/evanescent.ts";
import {
	consumeStartupCwdRequests,
	resetStartupCwdRequestsForTests,
} from "../extensions/lib/cd-startup.ts";

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "evanescent-adapter-test-"));
}

test("evanescent direct startup migration waits for pending cd startup request", () => {
	assert.equal(
		shouldRunDirectStartupMigration({
			evanescentFlag: true,
			eventReason: "startup",
			isAlreadyInEvanescentWorkspace: false,
			startupRequestConsumed: false,
			hasPendingStartupRequest: true,
		}),
		false,
	);
	assert.equal(
		shouldRunDirectStartupMigration({
			evanescentFlag: true,
			eventReason: "startup",
			isAlreadyInEvanescentWorkspace: false,
			startupRequestConsumed: false,
			hasPendingStartupRequest: false,
		}),
		true,
	);
});

test("evanescent flag prepares a fresh run and startup cwd request during extension loading", async () => {
	resetStartupCwdRequestsForTests();
	const root = await tempRoot();
	const previousTempRoot = process.env.PI_EVANESCENT_TEMP_ROOT;
	process.env.PI_EVANESCENT_TEMP_ROOT = join(root, "temp-runs");
	const registeredFlags: Array<{ name: string; description?: string }> = [];
	try {
		await evanescentExtension({
			registerFlag: (name: string, definition: { description?: string }) => {
				registeredFlags.push({ name, description: definition.description });
			},
			getFlag: (name: string) => name === "evanescent",
			on: () => {},
			registerCommand: () => {},
			registerTool: () => {},
		} as any);

		assert.deepEqual(
			registeredFlags.map((flag) => flag.name),
			["evanescent"],
		);
		const resolution = consumeStartupCwdRequests();
		assert.equal(resolution.kind, "migrate");
		assert.equal(
			resolution.kind === "migrate" &&
				resolution.requests[0].requiresFreshSession,
			true,
		);
		assert.match(
			resolution.kind === "migrate" ? resolution.targetCwd : "",
			/\/workspace$/,
		);
		const metadata = await readMetadata(
			join(resolution.kind === "migrate" ? resolution.targetCwd : "", ".."),
		);
		assert.equal(metadata.materialized, false);
		assert.equal(
			metadata.workspacePath,
			resolution.kind === "migrate" ? resolution.targetCwd : "",
		);
	} finally {
		if (previousTempRoot === undefined)
			delete process.env.PI_EVANESCENT_TEMP_ROOT;
		else process.env.PI_EVANESCENT_TEMP_ROOT = previousTempRoot;
		resetStartupCwdRequestsForTests();
	}
});

test("evanescent workspace migration removes created session file when switch is cancelled", async () => {
	const root = await tempRoot();
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	let targetSessionFile: string | undefined;
	const notifications: string[] = [];

	try {
		await migrateToWorkspace(
			{
				cwd: "/tmp/source",
				sessionManager: {
					getSessionFile: () => join(root, "source.jsonl"),
					getEntries: () => [],
				},
				ui: { notify: (message) => notifications.push(message) },
				waitForIdle: async () => {},
				switchSession: async (sessionFile) => {
					targetSessionFile = sessionFile;
					assert.equal(existsSync(sessionFile), true);
					return { cancelled: true };
				},
			},
			"/tmp/target-workspace",
			"Started Evanescent workspace run-a.",
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}

	assert.ok(targetSessionFile);
	assert.equal(existsSync(targetSessionFile), false);
	assert.deepEqual(notifications, [
		"Evanescent workspace migration cancelled.",
	]);
});

async function withMaterializedRollbackScenario(
	switchSession: () => Promise<{ cancelled: boolean }>,
): Promise<{
	root: string;
	run: Awaited<ReturnType<typeof createEvanescentRun>>;
	notifications: string[];
}> {
	const root = await tempRoot();
	const run = await createEvanescentRun({
		tempRoot: join(root, "temp"),
		id: "run-a",
		pid: 1,
	});
	await writeFile(join(run.workspace, "note.txt"), "keep me", "utf8");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const notifications: string[] = [];
	try {
		await materializeCurrentRun(
			{
				cwd: run.workspace,
				sessionManager: {
					getSessionFile: () => join(root, "source.jsonl"),
					getEntries: () => [],
				},
				ui: { notify: (message: string) => notifications.push(message) },
				waitForIdle: async () => {},
				switchSession,
			},
			join(root, "cradle"),
			"kept",
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	return { root, run, notifications };
}

async function assertMaterializationRolledBack(
	root: string,
	run: Awaited<ReturnType<typeof createEvanescentRun>>,
) {
	assert.equal(existsSync(run.root), true);
	assert.equal(existsSync(join(root, "cradle", "kept")), false);
	assert.equal(existsSync(join(run.workspace, "note.txt")), true);
	const metadata = await readMetadata(run.root);
	assert.equal(metadata.materialized, false);
	assert.equal(metadata.workspacePath, run.workspace);
}

test("materialize outside an evanescent workspace reports guidance without migrating", async () => {
	const notifications: Array<{ message: string; level?: string }> = [];
	let switchCalled = false;

	await materializeCurrentRun(
		{
			cwd: "/tmp/not-evanescent",
			sessionManager: {
				getSessionFile: () => undefined,
				getEntries: () => [],
			},
			ui: {
				notify: (message: string, level?: string) =>
					notifications.push({ message, level }),
			},
			waitForIdle: async () => {},
			switchSession: async () => {
				switchCalled = true;
				return { cancelled: false };
			},
		},
		"/tmp/cradle",
		"kept",
	);

	assert.equal(switchCalled, false);
	assert.deepEqual(notifications, [
		{
			message:
				"/materialize only works inside an Evanescent workspace. Launch with --evanescent first.",
			level: "error",
		},
	]);
});

test("materialize command rolls back the move when session migration is cancelled", async () => {
	const { root, run, notifications } = await withMaterializedRollbackScenario(
		async () => ({ cancelled: true }),
	);

	await assertMaterializationRolledBack(root, run);
	assert.deepEqual(notifications, [
		"Evanescent workspace migration cancelled.",
		"Materialization cancelled; restored Evanescent run in temporary storage.",
	]);
});

test("before agent start adds temporary workspace context only for unmaterialized evanescent runs", async () => {
	const root = await tempRoot();
	const run = await createEvanescentRun({
		tempRoot: join(root, "temp"),
		id: "run-a",
		pid: 1,
	});
	let beforeAgentStart:
		| ((event: { systemPrompt: string }, ctx: { cwd: string }) => Promise<any>)
		| undefined;

	await evanescentExtension({
		registerFlag: () => {},
		getFlag: () => false,
		on: (event: string, callback: typeof beforeAgentStart) => {
			if (event === "before_agent_start") beforeAgentStart = callback;
		},
		registerCommand: () => {},
		registerTool: () => {},
	} as any);
	assert.ok(beforeAgentStart);

	const activeResult = await beforeAgentStart(
		{ systemPrompt: "base prompt" },
		{ cwd: run.workspace },
	);
	assert.match(activeResult.systemPrompt, /base prompt/);
	assert.match(activeResult.systemPrompt, /Evanescent mode/);
	assert.match(activeResult.systemPrompt, /\/materialize \[name\]/);

	assert.equal(
		await beforeAgentStart(
			{ systemPrompt: "base prompt" },
			{ cwd: "/tmp/not-evanescent" },
		),
		undefined,
	);

	await writeMetadata(run.root, {
		...run.metadata,
		materialized: true,
		materializedPath: join(root, "cradle", "run-a"),
	});
	assert.equal(
		await beforeAgentStart(
			{ systemPrompt: "base prompt" },
			{ cwd: run.workspace },
		),
		undefined,
	);
});

test("model materialize tool confirms before returning command guidance", async () => {
	const root = await tempRoot();
	const run = await createEvanescentRun({
		tempRoot: join(root, "temp"),
		id: "run-a",
		pid: 1,
	});
	const previousCradle = process.env.PI_EVANESCENT_CRADLE;
	process.env.PI_EVANESCENT_CRADLE = join(root, "cradle");
	let tool: { execute: (...args: any[]) => Promise<any> } | undefined;
	const confirmations: Array<{ title: string; body: string }> = [];
	try {
		await evanescentExtension({
			registerFlag: () => {},
			getFlag: () => false,
			on: () => {},
			registerCommand: () => {},
			registerTool: (definition: typeof tool) => {
				tool = definition;
			},
		} as any);
		assert.ok(tool);
		const result = await tool.execute(
			"tool-call-a",
			{ name: "kept" },
			undefined,
			undefined,
			{
				cwd: run.workspace,
				hasUI: true,
				ui: {
					confirm: async (title: string, body: string) => {
						confirmations.push({ title, body });
						return true;
					},
				},
			},
		);

		assert.equal(result.details.ok, false);
		assert.equal(result.details.requiresCommandConfirmation, true);
		assert.equal(result.details.command, "/materialize kept");
		assert.equal(confirmations.length, 1);
		assert.match(confirmations[0].body, /\/materialize kept/);
	} finally {
		if (previousCradle === undefined) delete process.env.PI_EVANESCENT_CRADLE;
		else process.env.PI_EVANESCENT_CRADLE = previousCradle;
	}
});

test("materialize command rolls back the move when session migration throws", async () => {
	const root = await tempRoot();
	const run = await createEvanescentRun({
		tempRoot: join(root, "temp"),
		id: "run-a",
		pid: 1,
	});
	await writeFile(join(run.workspace, "note.txt"), "keep me", "utf8");
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	try {
		await assert.rejects(
			() =>
				materializeCurrentRun(
					{
						cwd: run.workspace,
						sessionManager: {
							getSessionFile: () => join(root, "source.jsonl"),
							getEntries: () => [],
						},
						ui: { notify: () => {} },
						waitForIdle: async () => {},
						switchSession: async () => {
							throw new Error("switch failed");
						},
					},
					join(root, "cradle"),
					"kept",
				),
			/switch failed/,
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	}
	await assertMaterializationRolledBack(root, run);
});
