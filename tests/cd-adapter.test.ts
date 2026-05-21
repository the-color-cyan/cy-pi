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
