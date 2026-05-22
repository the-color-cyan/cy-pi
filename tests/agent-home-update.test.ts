import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import {
	parseAgentHomeStatus,
	recommendedAgentHomeUpdateCommand,
} from "../extensions/agent-home-update.ts";

async function tempRoot() {
	return mkdtemp(join(tmpdir(), "agent-home-update-test-"));
}

async function executableFile(path: string) {
	await writeFile(path, "#!/usr/bin/env bash\n", "utf8");
	await chmod(path, 0o755);
}

test("parses machine-readable update status", () => {
	assert.deepEqual(
		parseAgentHomeStatus(
			"status=behind\nbehind=2\nahead=0\nbranch=main\nupstream=origin/main\n",
		),
		{
			status: "behind",
			behind: "2",
			ahead: "0",
			branch: "main",
			upstream: "origin/main",
		},
	);
});

test("recommends plain pi update when the repo wrapper is active on PATH", async () => {
	const root = await tempRoot();
	await mkdir(join(root, "bin"));
	await executableFile(join(root, "bin", "pi"));

	assert.equal(
		recommendedAgentHomeUpdateCommand(root, join(root, "bin")),
		"pi update",
	);
});

test("recommends the repo wrapper when it exists but is not active on PATH", async () => {
	const root = await tempRoot();
	const other = await tempRoot();
	await mkdir(join(root, "bin"));
	await executableFile(join(root, "bin", "pi"));
	await executableFile(join(other, "pi"));

	assert.equal(
		recommendedAgentHomeUpdateCommand(
			root,
			[join(other), join(root, "bin")].join(delimiter),
		),
		`"${join(root, "bin", "pi")}" update`,
	);
});

test("falls back to the update script when the repo wrapper is missing", async () => {
	const root = await tempRoot();
	await mkdir(join(root, "scripts"));

	assert.equal(
		recommendedAgentHomeUpdateCommand(root, ""),
		`"${join(root, "scripts", "update-agent-home.sh")}" --pull`,
	);
});
