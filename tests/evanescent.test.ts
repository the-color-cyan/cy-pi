import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	ACTIVE_MARKER_FILE,
	cleanupEvanescentRuns,
	createEvanescentRun,
	materializeRun,
	planEvanescentCleanup,
	readMetadata,
	resolveCradlePath,
	writeMetadata,
} from "../extensions/lib/evanescent.ts";

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "evanescent-test-"));
}

test("creates an evanescent run with empty workspace and metadata outside workspace", async () => {
	const root = await tempRoot();
	const run = await createEvanescentRun({
		tempRoot: root,
		id: "run-a",
		pid: 123,
		now: new Date("2026-01-01T00:00:00Z"),
	});
	assert.equal((await stat(run.workspace)).isDirectory(), true);
	assert.deepEqual(await readdir(run.workspace), []);
	assert.equal(existsSync(join(run.workspace, "evanescent-run.json")), false);
	const metadata = await readMetadata(run.root);
	assert.equal(metadata.id, "run-a");
	assert.equal(metadata.workspacePath, run.workspace);
	assert.equal(metadata.materialized, false);
});

test("resolves default and configured cradle paths", () => {
	assert.equal(resolveCradlePath(undefined, "/home/test"), "/home/test/cradle");
	assert.equal(resolveCradlePath("~/kept", "/home/test"), "/home/test/kept");
});

test("cleanup selects max-age and max-count candidates while skipping protected runs", async () => {
	const root = await tempRoot();
	const old = await createEvanescentRun({
		tempRoot: root,
		id: "old",
		pid: 1,
		now: new Date("2026-01-01T00:00:00Z"),
	});
	const middle = await createEvanescentRun({
		tempRoot: root,
		id: "middle",
		pid: 2,
		now: new Date("2026-01-02T00:00:00Z"),
	});
	const current = await createEvanescentRun({
		tempRoot: root,
		id: "current",
		pid: 3,
		now: new Date("2026-01-03T00:00:00Z"),
	});
	const materialized = await createEvanescentRun({
		tempRoot: root,
		id: "materialized",
		pid: 4,
		now: new Date("2026-01-04T00:00:00Z"),
	});
	await createEvanescentRun({
		tempRoot: root,
		id: "active",
		pid: 999999,
		now: new Date("2026-01-05T00:00:00Z"),
	});
	for (const run of [old, middle, current, materialized])
		await rm(join(run.root, ACTIVE_MARKER_FILE), { force: true });
	await writeMetadata(materialized.root, {
		...materialized.metadata,
		materialized: true,
		materializedPath: "/kept",
	});

	const candidates = await planEvanescentCleanup(root, {
		now: new Date("2026-01-10T00:00:00Z"),
		maxAgeMs: 3 * 24 * 60 * 60 * 1000,
		maxRetainedRuns: 1,
		currentRunRoot: current.root,
		isPidAlive: (pid) => pid === 999999,
	});
	assert.deepEqual(candidates.map((run) => run.metadata.id).sort(), [
		"middle",
		"old",
	]);
});

test("cleanup removes planned candidates only", async () => {
	const root = await tempRoot();
	const old = await createEvanescentRun({
		tempRoot: root,
		id: "old",
		pid: 1,
		now: new Date("2026-01-01T00:00:00Z"),
	});
	const keep = await createEvanescentRun({
		tempRoot: root,
		id: "keep",
		pid: 2,
		now: new Date("2026-01-10T00:00:00Z"),
	});
	await Promise.all([
		rm(join(old.root, ACTIVE_MARKER_FILE), { force: true }),
		rm(join(keep.root, ACTIVE_MARKER_FILE), { force: true }),
	]);
	const removed = await cleanupEvanescentRuns(root, {
		now: new Date("2026-01-10T00:00:00Z"),
		maxAgeMs: 24 * 60 * 60 * 1000,
		isPidAlive: () => false,
	});
	assert.deepEqual(removed, [old.root]);
	assert.equal(existsSync(old.root), false);
	assert.equal(existsSync(keep.root), true);
});

test("materialize moves whole run, rejects existing destinations, updates metadata, and returns workspace", async () => {
	const root = await tempRoot();
	const run = await createEvanescentRun({
		tempRoot: root,
		id: "run-a",
		pid: 1,
	});
	await writeFile(join(run.workspace, "note.txt"), "keep me", "utf8");
	const cradle = join(root, "cradle");
	await mkdir(join(cradle, "taken"), { recursive: true });
	await assert.rejects(
		() => materializeRun(run.root, cradle, "taken"),
		/already exists/,
	);

	const result = await materializeRun(run.root, cradle, "kept");
	assert.equal(result.destinationRoot, join(cradle, "kept"));
	assert.equal(result.workspacePath, join(cradle, "kept", "workspace"));
	assert.equal(existsSync(join(result.workspacePath, "note.txt")), true);
	assert.equal(existsSync(run.root), false);
	const metadata = await readMetadata(result.destinationRoot);
	assert.equal(metadata.materialized, true);
	assert.equal(metadata.materializedPath, result.destinationRoot);
	assert.equal(metadata.workspacePath, result.workspacePath);
});
