import assert from "node:assert/strict";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	atomicWriteSettingsFile,
	captureLocalSettings,
} from "../extensions/settings-capture.ts";

async function fixture() {
	const agentHome = await mkdtemp(join(tmpdir(), "cy-pi-settings-capture-"));
	const localPath = join(agentHome, "settings.json");
	const managedPath = join(agentHome, "settings.managed.json");
	await writeFile(
		localPath,
		JSON.stringify({
			model: "new",
			nested: { enabled: true },
			localOnly: join(agentHome, "extensions"),
			similarPrefix: `${agentHome}-backup/extensions`,
		}),
	);
	await writeFile(
		managedPath,
		JSON.stringify({ model: "old", nested: { enabled: true }, removed: true }),
	);
	await chmod(managedPath, 0o640);
	return { agentHome, localPath, managedPath };
}

test("captures the full local snapshot after confirmation", async () => {
	const { agentHome, managedPath } = await fixture();
	let confirmation = "";
	const result = await captureLocalSettings({
		agentHome,
		hasUI: true,
		confirm: async (_title, message) => {
			confirmation = message;
			return true;
		},
	});

	assert.deepEqual(result, {
		status: "captured",
		summary: { added: 2, changed: 1, removed: 1, unchanged: 1 },
	});
	assert.match(confirmation, /2 added, 1 changed, 1 removed, 1 unchanged/);
	assert.equal(
		await readFile(managedPath, "utf8"),
		`{\n  "model": "new",\n  "nested": {\n    "enabled": true\n  },\n  "localOnly": "$PI_CODING_AGENT_DIR/extensions",\n  "similarPrefix": "${agentHome}-backup/extensions"\n}\n`,
	);
	assert.equal((await stat(managedPath)).mode & 0o777, 0o640);
	assert.deepEqual(
		(await readdir(agentHome)).filter((name) =>
			name.startsWith(".settings-capture-"),
		),
		[],
	);
});

test("cancellation leaves managed settings unchanged", async () => {
	const { agentHome, managedPath } = await fixture();
	const before = await readFile(managedPath, "utf8");
	const result = await captureLocalSettings({
		agentHome,
		hasUI: true,
		confirm: async () => false,
	});

	assert.equal(result.status, "cancelled");
	assert.equal(await readFile(managedPath, "utf8"), before);
});

test("concurrent changes during confirmation abort capture", async () => {
	const { agentHome, localPath, managedPath } = await fixture();
	const managedBefore = await readFile(managedPath, "utf8");

	await assert.rejects(
		captureLocalSettings({
			agentHome,
			hasUI: true,
			confirm: async () => {
				await writeFile(localPath, '{"changedDuringConfirmation":true}\n');
				return true;
			},
		}),
		/Settings changed while confirmation was open/,
	);
	assert.equal(await readFile(managedPath, "utf8"), managedBefore);
});

test("no-UI mode fails closed without reading or prompting", async () => {
	let prompted = false;
	const result = await captureLocalSettings({
		agentHome: join(tmpdir(), "does-not-exist"),
		hasUI: false,
		confirm: async () => {
			prompted = true;
			return true;
		},
	});

	assert.deepEqual(result, { status: "no-ui" });
	assert.equal(prompted, false);
});

test("atomic write failure preserves the destination and cleans temporary files", async () => {
	const agentHome = await mkdtemp(
		join(tmpdir(), "cy-pi-settings-capture-failure-"),
	);
	const destination = join(agentHome, "settings.managed.json");
	await mkdir(destination);
	await writeFile(join(destination, "marker"), "original\n");

	await assert.rejects(
		atomicWriteSettingsFile(destination, '{"replacement":true}\n'),
	);
	assert.equal(
		await readFile(join(destination, "marker"), "utf8"),
		"original\n",
	);
	assert.deepEqual(
		(await readdir(agentHome)).filter((name) =>
			name.startsWith(".settings-capture-"),
		),
		[],
	);
});

test("malformed local JSON fails before confirmation and preserves managed settings", async () => {
	const { agentHome, localPath, managedPath } = await fixture();
	const before = await readFile(managedPath, "utf8");
	await writeFile(localPath, "{ malformed\n");
	let prompted = false;

	await assert.rejects(
		captureLocalSettings({
			agentHome,
			hasUI: true,
			confirm: async () => {
				prompted = true;
				return true;
			},
		}),
		/Cannot read valid JSON from local settings/,
	);
	assert.equal(prompted, false);
	assert.equal(await readFile(managedPath, "utf8"), before);
	assert.deepEqual(
		(await readdir(agentHome)).filter((name) =>
			name.startsWith(".settings-capture-"),
		),
		[],
	);
});
