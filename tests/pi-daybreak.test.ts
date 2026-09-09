import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

const execFile = promisify(execFileCallback);
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const pi = join(sourceRoot, "node_modules", ".bin", "pi");
const extension = join(sourceRoot, "extensions", "pi-daybreak");

const PROVIDER = "openai-codex";

const NEW_UPSTREAM_MODEL = {
	id: "gpt-test-upstream-catalog-model",
	name: "GPT Test Upstream Catalog Model",
	api: "openai-codex-responses",
	provider: PROVIDER,
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
};

const CACHED_DISCOVERED_MODEL = {
	...NEW_UPSTREAM_MODEL,
	id: "gpt-test-daybreak-discovery",
	name: "GPT Test Daybreak Discovery",
};

function currentCacheSource(): string {
	return createHash("sha256")
		.update(JSON.stringify([getBuiltinModels(PROVIDER), [NEW_UPSTREAM_MODEL]]))
		.digest("hex");
}

async function createAgentHome(completeCache = false) {
	const agentHome = await mkdtemp(join(tmpdir(), "cy-pi-daybreak-test-"));
	await mkdir(join(agentHome, "cache", "pi-daybreak"), { recursive: true });
	await writeFile(
		join(agentHome, "settings.json"),
		JSON.stringify({ extensions: [extension], quietStartup: true }),
	);
	await writeFile(
		join(agentHome, "models.json"),
		JSON.stringify({ providers: { [PROVIDER]: { apiKey: "test-key" } } }),
	);
	await writeFile(
		join(agentHome, "models-store.json"),
		JSON.stringify({
			[PROVIDER]: {
				models: [NEW_UPSTREAM_MODEL],
				checkedAt: Date.now(),
				lastModified: Number.MAX_SAFE_INTEGER,
			},
		}),
	);
	await writeFile(
		join(agentHome, "cache", "pi-daybreak", "models.json"),
		JSON.stringify({
			discovered: [CACHED_DISCOVERED_MODEL.id],
			source: currentCacheSource(),
			models: completeCache
				? [...getBuiltinModels(PROVIDER), NEW_UPSTREAM_MODEL, CACHED_DISCOVERED_MODEL]
				: [CACHED_DISCOVERED_MODEL],
		}),
	);
	return agentHome;
}

test("pi --list-models preserves a refreshed openai-codex model when a source-matched pi-daybreak cache is incomplete", async (t) => {
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

test("pi --list-models retains a discovered model from a complete source-matched pi-daybreak cache", async (t) => {
	const agentHome = await createAgentHome(true);
	t.after(() => rm(agentHome, { recursive: true, force: true }));

	const { stdout } = await execFile(
		pi,
		["--offline", "--list-models", PROVIDER],
		{
			cwd: sourceRoot,
			env: { ...process.env, PI_CODING_AGENT_DIR: agentHome },
		},
	);

	assert.match(stdout, /openai-codex\s+gpt-test-daybreak-discovery\b/);
});
