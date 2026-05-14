import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { complete } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { copyToClipboard } from "@mariozechner/pi-coding-agent";

const PROMPT_FILE_NAME = "commit-message-prompt.md";
const DEFAULT_PROMPT = `You are writing a git commit message for the changes below.

Requirements:
- Return only the commit message, with no markdown fences or commentary.
- Use Conventional Commit style when it fits.
- Keep the subject line imperative, specific, and under 72 characters when possible.
- Add a concise body only if it helps explain the why or notable details.`;

type GitContext = {
	root: string;
	status: string;
	diff: string;
	diffKind: "staged" | "working tree";
	untracked: string;
};

type CommandOptions = {
	useLazygit: boolean;
	guidance: string;
};

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function readPromptFile(ctx: GitContext): { prompt: string; source: string } {
	const repoPrompt = join(ctx.root, ".pi", PROMPT_FILE_NAME);
	if (existsSync(repoPrompt)) {
		return { prompt: readFileSync(repoPrompt, "utf8"), source: repoPrompt };
	}

	const globalPrompt = join(agentDir(), PROMPT_FILE_NAME);
	if (existsSync(globalPrompt)) {
		return { prompt: readFileSync(globalPrompt, "utf8"), source: globalPrompt };
	}

	return { prompt: DEFAULT_PROMPT, source: "built-in default" };
}

function normalizeSubjectBodyGap(message: string): string {
	const lines = message.replace(/\r\n?/g, "\n").split("\n");
	if (lines.length <= 1) return message.replace(/\r\n?/g, "\n");

	const subject = lines[0].trimEnd();
	const firstBodyLine = lines.findIndex(
		(line, index) => index > 0 && line.trim().length > 0,
	);
	if (firstBodyLine === -1) return subject;

	return [subject, "", ...lines.slice(firstBodyLine)].join("\n");
}

function cleanCommitMessage(text: string): string {
	return normalizeSubjectBodyGap(
		text
			.replace(/\r\n?/g, "\n")
			.trim()
			.replace(/^```(?:gitcommit|text)?\s*/i, "")
			.replace(/\s*```$/i, "")
			.trim(),
	);
}

function formatForLazygitPaste(message: string): string {
	const lines = message.replace(/\r\n?/g, "\n").trim().split("\n");
	if (lines.length <= 1) return lines[0] ?? "";

	const subject = lines[0].trimEnd();
	const firstBodyLine = lines.findIndex(
		(line, index) => index > 0 && line.trim().length > 0,
	);
	if (firstBodyLine === -1) return subject;

	return [subject, ...lines.slice(firstBodyLine)].join("\n");
}

function parseCommandOptions(args: string): CommandOptions {
	const clipboardOnlyFlag =
		/(^|\s)(--clipboard-only|--clipboard|--no-lazygit|--no-lg)(?=\s|$)/;
	const useLazygit = !clipboardOnlyFlag.test(args);
	const guidance = args
		.replace(
			/(^|\s)(--clipboard-only|--clipboard|--no-lazygit|--no-lg)(?=\s|$)/g,
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
	return { useLazygit, guidance };
}

function buildPrompt(
	instructions: string,
	git: GitContext,
	extra: string,
): string {
	return [
		instructions.trim(),
		"",
		`Repository: ${git.root}`,
		`Diff kind: ${git.diffKind}`,
		extra ? `Additional user guidance: ${extra}` : undefined,
		"",
		"<git-status>",
		git.status.trim(),
		"</git-status>",
		"",
		git.untracked.trim() ? "<untracked-files>" : undefined,
		git.untracked.trim() || undefined,
		git.untracked.trim() ? "</untracked-files>" : undefined,
		git.untracked.trim() ? "" : undefined,
		"<git-diff>",
		git.diff.trim(),
		"</git-diff>",
	]
		.filter((part): part is string => typeof part === "string")
		.join("\n");
}

async function git(pi: ExtensionAPI, cwd: string, args: string[]) {
	return pi.exec("git", args, { cwd, timeout: 30_000 });
}

async function getGitContext(
	pi: ExtensionAPI,
	cwd: string,
): Promise<GitContext> {
	const rootResult = await git(pi, cwd, ["rev-parse", "--show-toplevel"]);
	if (rootResult.code !== 0) {
		throw new Error("Not inside a git repository.");
	}
	const root = rootResult.stdout.trim();

	const statusResult = await git(pi, root, ["status", "--short"]);
	const status = statusResult.stdout.trim();
	if (!status) {
		throw new Error("No git changes found.");
	}

	const stagedStat = await git(pi, root, ["diff", "--cached", "--stat"]);
	const hasStaged = stagedStat.stdout.trim().length > 0;
	const diffArgs = hasStaged ? ["diff", "--cached"] : ["diff"];
	const diffResult = await git(pi, root, diffArgs);
	const untrackedResult = await git(pi, root, [
		"ls-files",
		"--others",
		"--exclude-standard",
	]);

	const diff = diffResult.stdout.trim() || stagedStat.stdout.trim();
	const untracked = untrackedResult.stdout.trim();
	if (!diff && !untracked) {
		throw new Error(
			"No diff found. Stage changes first, or modify tracked files.",
		);
	}

	return {
		root,
		status,
		diff,
		diffKind: hasStaged ? "staged" : "working tree",
		untracked,
	};
}

async function copyMessage(
	message: string,
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	try {
		await copyToClipboard(message);
		return true;
	} catch (error) {
		ctx.ui.notify(
			`Generated commit message, but clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
		return false;
	}
}

async function showCommitMessage(
	message: string,
	promptSource: string,
	copied: boolean,
	ctx: ExtensionCommandContext,
) {
	if (!ctx.hasUI) return;

	const shown = await ctx.ui.editor(
		`Generated commit message (${copied ? "copied" : "copy failed"}) · prompt: ${promptSource}`,
		message,
	);

	if (
		typeof shown === "string" &&
		shown.trim() &&
		shown.trim() !== message.trim()
	) {
		if (await copyMessage(shown.trim(), ctx)) {
			ctx.ui.notify("Updated commit message copied to clipboard.", "info");
		}
	}
}

function withCommitTemplateEnv(
	templatePath: string,
): Record<string, string | undefined> {
	const env = { ...process.env };
	const parsedCount = Number.parseInt(env.GIT_CONFIG_COUNT ?? "0", 10);
	const index =
		Number.isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : 0;
	env.GIT_CONFIG_COUNT = String(index + 1);
	env[`GIT_CONFIG_KEY_${index}`] = "commit.template";
	env[`GIT_CONFIG_VALUE_${index}`] = templatePath;
	return env;
}

async function launchLazygit(
	gitContext: GitContext,
	message: string,
	copied: boolean,
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!ctx.hasUI) {
		ctx.ui.notify(
			"lazygit requires the interactive TUI; falling back to clipboard only.",
			"warning",
		);
		return false;
	}

	const lazygitCheck = spawnSync("lazygit", ["--version"], { stdio: "ignore" });
	if (lazygitCheck.error || lazygitCheck.status !== 0) {
		ctx.ui.notify(
			"lazygit is not available; commit message copied to clipboard.",
			"warning",
		);
		return false;
	}

	const tempDir = mkdtempSync(join(tmpdir(), "pi-commit-message-"));
	const templatePath = join(tempDir, "COMMIT_MESSAGE");
	writeFileSync(templatePath, `${message.trim()}\n`, "utf8");

	try {
		const exitCode = await ctx.ui.custom<number | null>(
			(tui, _theme, _kb, done) => {
				tui.stop();
				process.stdout.write("\x1b[2J\x1b[H");
				process.stdout.write(
					[
						"Generated commit message:",
						"",
						message,
						"",
						copied
							? "Copied to clipboard."
							: "Clipboard copy failed; the message is still available as a git commit template.",
						"In lazygit, use Commit with editor (C by default) for a prefilled editor, or paste into the inline commit box.",
						"",
					].join("\n"),
				);

				const result = spawnSync(
					"lazygit",
					["--path", gitContext.root, "status"],
					{
						cwd: gitContext.root,
						stdio: "inherit",
						env: withCommitTemplateEnv(templatePath),
					},
				);

				tui.start();
				tui.requestRender(true);
				done(result.status ?? (result.error ? 1 : 0));
				return { render: () => [], invalidate: () => {} };
			},
		);

		if (exitCode && exitCode !== 0) {
			ctx.ui.notify(
				`lazygit exited with code ${exitCode}; commit message is still on the clipboard.`,
				"warning",
			);
			return false;
		}
		return true;
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("commit-message", {
		description:
			"Generate a git commit message, copy it, and open lazygit when available",
		handler: async (args, ctx) => {
			const options = parseCommandOptions(args);
			await ctx.waitForIdle();

			let gitContext: GitContext;
			try {
				gitContext = await getGitContext(pi, ctx.cwd);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}

			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No active model selected.", "error");
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				ctx.ui.notify(auth.error, "error");
				return;
			}
			if (!auth.apiKey) {
				ctx.ui.notify(
					`No API key available for ${model.provider}/${model.id}.`,
					"error",
				);
				return;
			}

			const { prompt, source } = readPromptFile(gitContext);
			ctx.ui.notify("Generating commit message...", "info");

			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user" as const,
							content: [
								{
									type: "text" as const,
									text: buildPrompt(prompt, gitContext, options.guidance),
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{ apiKey: auth.apiKey, headers: auth.headers },
			);

			const message = cleanCommitMessage(
				response.content
					.filter(
						(part): part is { type: "text"; text: string } =>
							part.type === "text",
					)
					.map((part) => part.text)
					.join("\n"),
			);

			if (!message) {
				ctx.ui.notify("Model returned an empty commit message.", "error");
				return;
			}

			const clipboardMessage = options.useLazygit
				? formatForLazygitPaste(message)
				: message;
			const copied = await copyMessage(clipboardMessage, ctx);
			if (copied) {
				ctx.ui.notify("Commit message copied to clipboard.", "info");
			}

			if (options.useLazygit) {
				const launched = await launchLazygit(
					gitContext,
					clipboardMessage,
					copied,
					ctx,
				);
				if (launched) return;
			}

			await showCommitMessage(message, source, copied, ctx);
		},
	});
}
