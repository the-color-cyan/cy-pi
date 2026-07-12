import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import {
	completionText,
	readYeetSettings,
} from "../extensions/commit-message.ts";

function response(
	overrides: Partial<
		Pick<AssistantMessage, "content" | "errorMessage" | "stopReason">
	>,
): Pick<AssistantMessage, "content" | "errorMessage" | "stopReason"> {
	return {
		content: [],
		stopReason: "stop",
		...overrides,
	};
}

function withAgentHome(callback: (agentHome: string) => void): void {
	const agentHome = mkdtempSync(join(tmpdir(), "commit-message-settings-"));
	try {
		callback(agentHome);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
}

test("readYeetSettings reads managed runtime settings", () => {
	withAgentHome((agentHome) => {
		writeFileSync(
			join(agentHome, "settings.json"),
			JSON.stringify({
				commitMessage: {
					yeet: {
						model: "openai-codex/gpt-5.6-luna",
						reasoning: "medium",
					},
				},
			}),
		);

		assert.deepEqual(readYeetSettings(agentHome), {
			model: "openai-codex/gpt-5.6-luna",
			reasoning: "medium",
		});
	});
});

test("readYeetSettings defaults to inherited model and medium reasoning without managed configuration", () => {
	withAgentHome((agentHome) => {
		assert.deepEqual(readYeetSettings(agentHome), {
			model: "inherit",
			reasoning: "medium",
		});
	});
});

test("readYeetSettings defaults omitted managed values", () => {
	withAgentHome((agentHome) => {
		writeFileSync(join(agentHome, "settings.json"), "{}");

		assert.deepEqual(readYeetSettings(agentHome), {
			model: "inherit",
			reasoning: "medium",
		});
	});
});

test("completionText surfaces provider errors instead of treating them as empty", () => {
	assert.throws(
		() =>
			completionText(
				response({
					stopReason: "error",
					errorMessage: "Model not found gpt-5.6-luna",
				}),
			),
		{ message: "Model not found gpt-5.6-luna" },
	);
});

test("completionText extracts and joins successful text blocks", () => {
	assert.equal(
		completionText(
			response({
				content: [
					{ type: "thinking", thinking: "internal reasoning" },
					{ type: "text", text: "fix(commit): surface provider errors" },
					{ type: "text", text: "Additional details." },
				],
			}),
		),
		"fix(commit): surface provider errors\nAdditional details.",
	);
});
