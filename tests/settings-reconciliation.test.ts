import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";

const execFile = promisify(execFileCallback);
const sourceRoot = new URL("..", import.meta.url).pathname;

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		assert.ok(
			parsed !== null && typeof parsed === "object" && !Array.isArray(parsed),
		);
		return parsed as Record<string, unknown>;
	} catch (error) {
		assert.fail(`expected valid JSON object at ${path}: ${String(error)}`);
	}
}

async function git(cwd: string, args: string[]) {
	return execFile("git", ["-C", cwd, ...args]);
}

test("settings reconciliation creates a fresh runtime file", async () => {
	const repo = await mkdtemp(join(tmpdir(), "cy-pi-settings-fresh-"));
	await writeFile(
		join(repo, "settings.managed.json"),
		JSON.stringify({
			enabledModels: ["declared"],
			root: "$PI_CODING_AGENT_DIR",
			commitMessage: {
				yeet: {
					model: "openai-codex/gpt-5.6-luna",
					reasoning: "medium",
				},
			},
		}),
	);

	await execFile("bash", [
		join(sourceRoot, "scripts", "reconcile-settings.sh"),
		"--repo",
		repo,
	]);

	const settings = await readJsonObject(join(repo, "settings.json"));
	assert.deepEqual(settings.enabledModels, ["declared"]);
	assert.equal(settings.root, repo);
	assert.deepEqual(settings.commitMessage, {
		yeet: {
			model: "openai-codex/gpt-5.6-luna",
			reasoning: "medium",
		},
	});
});

test("successful agent-home pull reconciles settings without running init", async () => {
	const root = await mkdtemp(join(tmpdir(), "cy-pi-settings-update-"));
	const remote = join(root, "remote.git");
	const repo = join(root, "repo");
	const publisher = join(root, "publisher");
	await execFile("git", ["init", "--bare", remote]);
	await execFile("git", ["init", "-b", "main", repo]);
	await git(repo, ["config", "user.email", "test@example.com"]);
	await git(repo, ["config", "user.name", "Test User"]);
	await mkdir(join(repo, "scripts"), { recursive: true });
	for (const script of ["update-agent-home.sh", "reconcile-settings.sh"]) {
		const destination = join(repo, "scripts", script);
		await writeFile(
			destination,
			await readFile(join(sourceRoot, "scripts", script), "utf8"),
		);
		await chmod(destination, 0o755);
	}
	await writeFile(
		join(repo, "settings.managed.json"),
		JSON.stringify({ nested: { declared: "old" } }),
	);
	await writeFile(
		join(repo, "settings.json"),
		JSON.stringify({ nested: { declared: "local", localOnly: true } }),
	);
	await git(repo, ["add", "scripts", "settings.managed.json"]);
	await git(repo, ["commit", "-m", "initial"]);
	await git(repo, ["remote", "add", "origin", remote]);
	await git(repo, ["push", "-u", "origin", "main"]);

	await execFile("git", ["clone", "--branch", "main", remote, publisher]);
	await git(publisher, ["config", "user.email", "test@example.com"]);
	await git(publisher, ["config", "user.name", "Test User"]);
	await writeFile(
		join(publisher, "settings.managed.json"),
		JSON.stringify({ nested: { declared: "new", pulled: true } }),
	);
	await git(publisher, ["add", "settings.managed.json"]);
	await git(publisher, ["commit", "-m", "update settings"]);
	await git(publisher, ["push"]);

	const result = await execFile(
		"bash",
		[
			join(repo, "scripts", "update-agent-home.sh"),
			"--pull",
			"--repo",
			repo,
			"--machine",
		],
		{ env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
	);
	assert.match(result.stdout, /^status=updated$/m);
	const settings = await readJsonObject(join(repo, "settings.json"));
	assert.deepEqual(settings.nested, {
		declared: "new",
		localOnly: true,
		pulled: true,
	});
});
