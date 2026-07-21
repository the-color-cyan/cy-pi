import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	filterSkillBodyForMode,
	loadCaveponyConfig,
	parseCaveponyConfig,
	parseModeCommand,
} from "../extensions/cavepony.ts";

test("parseModeCommand: empty toggles, levels set, stop/quit/off disable, junk invalid", () => {
	assert.deepEqual(parseModeCommand(undefined), { type: "toggle" });
	assert.deepEqual(parseModeCommand("  "), { type: "toggle" });
	assert.deepEqual(parseModeCommand("ULTRA"), { type: "set", level: "ultra" });
	assert.deepEqual(parseModeCommand("stop"), { type: "set", level: "off" });
	assert.deepEqual(parseModeCommand("quit"), { type: "set", level: "off" });
	assert.deepEqual(parseModeCommand("wenyan"), { type: "invalid" });
});

test("parseCaveponyConfig: defaults on garbage, merges partial", () => {
	assert.deepEqual(parseCaveponyConfig(undefined), {
		caveman: { default: "full", status: true },
		ponytail: { default: "full", status: true },
	});
	assert.deepEqual(
		parseCaveponyConfig({
			ponytail: { default: "lite", status: false },
			caveman: { default: "bogus" },
		}),
		{
			caveman: { default: "full", status: true },
			ponytail: { default: "lite", status: false },
		},
	);
});

test("loadCaveponyConfig: reads cavepony key from settings.json, tolerates missing file", async () => {
	const dir = await mkdtemp(join(tmpdir(), "cavepony-test-"));
	const path = join(dir, "settings.json");
	await writeFile(
		path,
		JSON.stringify({
			theme: "dark",
			cavepony: { caveman: { default: "off", status: false } },
		}),
		"utf8",
	);
	assert.deepEqual(loadCaveponyConfig(path), {
		caveman: { default: "off", status: false },
		ponytail: { default: "full", status: true },
	});
	assert.deepEqual(
		loadCaveponyConfig(join(dir, "nope.json")),
		parseCaveponyConfig(undefined),
	);
});

const SKILL_BODY = `---
name: ponytail
---

# Ponytail

| Level | What change |
|-------|------------|
| **lite** | Lite row. |
| **full** | Full row. |
| **ultra** | Ultra row. |

Example:
- lite: "Lite example."
- full: "Full example."
- No unrequested abstractions: keep me.
`;

test("filterSkillBodyForMode: keeps only active level rows/examples, plain rules verbatim", () => {
	const full = filterSkillBodyForMode(SKILL_BODY, "full");
	assert.match(full, /Full row\./);
	assert.match(full, /Full example\./);
	assert.match(full, /No unrequested abstractions: keep me\./);
	assert.doesNotMatch(full, /Lite row\./);
	assert.doesNotMatch(full, /Ultra row\./);
	assert.doesNotMatch(full, /name: ponytail/);

	const lite = filterSkillBodyForMode(SKILL_BODY, "lite");
	assert.match(lite, /Lite row\./);
	assert.doesNotMatch(lite, /Full row\./);
});
