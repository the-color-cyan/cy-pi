import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadHeaderLines } from "../extensions/ascii-header.ts";

test("loadHeaderLines: accepts headers of any non-empty height", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ascii-header-test-"));
	const path = join(dir, "header.txt");
	await writeFile(path, "one\ntwo\nthree\nfour\n", "utf8");

	assert.deepEqual(loadHeaderLines(path), ["one", "two", "three", "four"]);
});
