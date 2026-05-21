import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createMigratedSessionFile,
	isFreshStartupSessionFile,
	removeFreshStartupSessionArtifact,
} from "../extensions/lib/cd-migration.ts";

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "cd-migration-test-"));
}

test("migrated session preserves entries and parent session for non-fresh sessions", async () => {
	const root = await tempRoot();
	const sourceSession = join(root, "source.jsonl");
	const entries = [
		{ type: "user", content: "hello" },
		{ type: "assistant", content: "world" },
	] as never[];

	const migrated = createMigratedSessionFile({
		agentDir: root,
		targetCwd: "/tmp/target",
		now: new Date("2026-01-01T00:00:00Z"),
		id: "session-a",
		sessionManager: {
			getSessionFile: () => sourceSession,
			getEntries: () => entries,
		},
	});

	const lines = (await readFile(migrated, "utf8")).trim().split("\n");
	assert.equal(lines.length, 3);
	assert.deepEqual(JSON.parse(lines[0]), {
		type: "session",
		version: 3,
		id: "session-a",
		timestamp: "2026-01-01T00:00:00.000Z",
		cwd: "/tmp/target",
		parentSession: sourceSession,
	});
	assert.deepEqual(
		lines.slice(1).map((line) => JSON.parse(line)),
		entries,
	);
});

test("only session files with no non-header entries are fresh startup artifacts", async () => {
	const root = await tempRoot();
	const fresh = join(root, "fresh.jsonl");
	const nonFresh = join(root, "non-fresh.jsonl");
	await writeFile(fresh, '{"type":"session","cwd":"/tmp"}\n', "utf8");
	await writeFile(
		nonFresh,
		'{"type":"session","cwd":"/tmp"}\n{"type":"user","content":"keep"}\n',
		"utf8",
	);

	assert.equal(await isFreshStartupSessionFile(fresh), true);
	assert.equal(await isFreshStartupSessionFile(nonFresh), false);
	assert.equal(await removeFreshStartupSessionArtifact(nonFresh), false);
	assert.equal(existsSync(nonFresh), true);
	assert.equal(await removeFreshStartupSessionArtifact(fresh), true);
	assert.equal(existsSync(fresh), false);
});
