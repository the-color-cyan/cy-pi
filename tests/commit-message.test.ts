import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai/compat";
import { completionText } from "../extensions/commit-message.ts";

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
