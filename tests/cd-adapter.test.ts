import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import cdExtension from "../extensions/cd.ts";
import {
	requestStartupCwd,
	resetStartupCwdRequestsForTests,
} from "../extensions/lib/cd-startup.ts";

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "cd-adapter-test-"));
}

function registerCdSessionStartHandler(): (
	event: any,
	ctx: any,
) => Promise<void> {
	let handler: ((event: any, ctx: any) => Promise<void>) | undefined;
	cdExtension({
		on: (event: string, callback: typeof handler) => {
			if (event === "session_start") handler = callback;
		},
		registerCommand: () => {},
	} as any);
	assert.ok(handler);
	return handler;
}

test("conflicting startup cwd requests prompt with UI and migrate to selected target", async () => {
	resetStartupCwdRequestsForTests();
	const root = await tempRoot();
	const sourceSession = join(root, "source.jsonl");
	await writeFile(
		sourceSession,
		'{"type":"session","cwd":"/tmp/source"}\n',
		"utf8",
	);
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	let selectedOptions: string[] | undefined;
	let migratedSessionFile: string | undefined;
	try {
		requestStartupCwd("extension-a", "/tmp/target-a");
		requestStartupCwd("extension-b", "/tmp/target-b");
		const handler = registerCdSessionStartHandler();
		await handler(
			{ reason: "startup" },
			{
				cwd: "/tmp/source",
				hasUI: true,
				ui: {
					notify: () => {},
					select: async (_title: string, options: string[]) => {
						selectedOptions = options;
						return "/tmp/target-b";
					},
				},
				waitForIdle: async () => {},
				sessionManager: {
					getSessionFile: () => sourceSession,
					getEntries: () => [],
				},
				switchSession: async (sessionFile: string, options: any) => {
					migratedSessionFile = sessionFile;
					const [header] = (await readFile(sessionFile, "utf8"))
						.trim()
						.split("\n");
					assert.equal(JSON.parse(header).cwd, "/tmp/target-b");
					await options.withSession({
						cwd: "/tmp/target-b",
						ui: { notify: () => {} },
						sendMessage: async () => {},
					});
					return { cancelled: false };
				},
			},
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		resetStartupCwdRequestsForTests();
	}

	assert.deepEqual(selectedOptions, ["/tmp/target-a", "/tmp/target-b"]);
	assert.ok(migratedSessionFile);
});

test("startup cwd migration fails closed when event context lacks session controls", async () => {
	resetStartupCwdRequestsForTests();
	const sentMessages: string[] = [];
	const notifications: Array<{ message: string; level: string | undefined }> =
		[];
	let shutdownCalled = false;
	let handler: ((event: any, ctx: any) => Promise<void>) | undefined;
	let inputHandler: ((event: any, ctx: any) => Promise<any>) | undefined;
	try {
		requestStartupCwd("test", "/tmp/target", { requiresFreshSession: true });
		cdExtension({
			on: (event: string, callback: any) => {
				if (event === "session_start") handler = callback;
				if (event === "input") inputHandler = callback;
			},
			registerCommand: () => {},
			sendUserMessage: (message: string) => sentMessages.push(message),
		} as any);
		assert.ok(handler);
		assert.ok(inputHandler);

		await assert.rejects(
			handler(
				{ reason: "startup" },
				{
					cwd: "/tmp/source",
					hasUI: false,
					ui: {
						notify: (message: string, level?: string) =>
							notifications.push({ message, level }),
					},
					shutdown: () => {
						shutdownCalled = true;
					},
					sessionManager: {
						getSessionFile: () => undefined,
						getEntries: () => [],
					},
				},
			),
			/Startup cwd migration cannot run from this pi startup context/,
		);

		assert.deepEqual(sentMessages, []);
		assert.equal(shutdownCalled, true);
		assert.deepEqual(notifications, [
			{
				message:
					"Startup cwd migration cannot run from this pi startup context. Shutting down to avoid continuing in the wrong workspace. For Evanescent launches in this pi version, use scripts/pi-home.sh --evanescent so the workspace is selected before pi starts.",
				level: "error",
			},
		]);
		const inputResult = await inputHandler(
			{ text: "cwd", source: "interactive" },
			{
				ui: {
					notify: (message: string, level?: string) =>
						notifications.push({ message, level: level ?? "info" }),
				},
			},
		);
		assert.deepEqual(inputResult, { action: "handled" });
	} finally {
		resetStartupCwdRequestsForTests();
	}
});

test("startup cwd migration removes created session file when switch throws", async () => {
	resetStartupCwdRequestsForTests();
	const root = await tempRoot();
	const sourceSession = join(root, "source.jsonl");
	await writeFile(
		sourceSession,
		'{"type":"session","cwd":"/tmp/source"}\n',
		"utf8",
	);
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	let targetSessionFile: string | undefined;
	try {
		requestStartupCwd("test", "/tmp/target");
		const handler = registerCdSessionStartHandler();
		await assert.rejects(
			() =>
				handler(
					{ reason: "startup" },
					{
						cwd: "/tmp/source",
						hasUI: false,
						ui: { notify: () => {} },
						waitForIdle: async () => {},
						sessionManager: {
							getSessionFile: () => sourceSession,
							getEntries: () => [],
						},
						switchSession: async (sessionFile: string) => {
							targetSessionFile = sessionFile;
							assert.equal(existsSync(sessionFile), true);
							throw new Error("switch failed");
						},
					},
				),
			/switch failed/,
		);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		resetStartupCwdRequestsForTests();
	}
	assert.ok(targetSessionFile);
	assert.equal(existsSync(targetSessionFile), false);
});
