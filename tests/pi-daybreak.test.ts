import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const pi = join(sourceRoot, "node_modules", ".bin", "pi");
const extension = join(sourceRoot, "extensions", "pi-daybreak");

const NEW_UPSTREAM_MODEL = {
	id: "gpt-test-upstream-catalog-model",
	name: "GPT Test Upstream Catalog Model",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
};

async function createAgentHome() {
	const agentHome = await mkdtemp(join(tmpdir(), "cy-pi-daybreak-test-"));
	await mkdir(join(agentHome, "cache", "pi-daybreak"), { recursive: true });
	await writeFile(
		join(agentHome, "settings.json"),
		JSON.stringify({ extensions: [extension], quietStartup: true }),
	);
	await writeFile(
		join(agentHome, "models.json"),
		JSON.stringify({ providers: { "openai-codex": { apiKey: "test-key" } } }),
	);
	await writeFile(
		join(agentHome, "models-store.json"),
		JSON.stringify({
			"openai-codex": {
				models: [NEW_UPSTREAM_MODEL],
				checkedAt: Date.now(),
				lastModified: Number.MAX_SAFE_INTEGER,
			},
		}),
	);
	await writeFile(
		join(agentHome, "cache", "pi-daybreak", "models.json"),
		JSON.stringify({
			discovered: ["gpt-test-daybreak-discovery"],
			source: "stale",
			models: [
				{
					...NEW_UPSTREAM_MODEL,
					id: "gpt-test-daybreak-discovery",
					name: "GPT Test Daybreak Discovery",
				},
			],
		}),
	);
	return agentHome;
}

test("pi --list-models preserves a refreshed openai-codex model when the pi-daybreak cache is stale", async (t) => {
	const agentHome = await createAgentHome();
	t.after(() => rm(agentHome, { recursive: true, force: true }));

	const { stdout } = await execFile(
		pi,
		["--offline", "--list-models", "openai-codex"],
		{
			cwd: sourceRoot,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentHome },
		},
	);

	assert.match(stdout, /openai-codex\s+gpt-test-upstream-catalog-model\b/);
});
