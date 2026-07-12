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
import { completeSimple } from "@earendil-works/pi-ai/compat";
import type {
	Api,
	AssistantMessage,
	Model,
	ThinkingLevel,
} from "@earendil-works/pi-ai/compat";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";

const PROMPT_FILE_NAME = "commit-message-prompt.md";
const DEFAULT_YEET_SETTINGS: YeetSettings = {
	model: "inherit",
	reasoning: "medium",
};
const THINKING_LEVELS = new Set<ThinkingLevel>([
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
const DEFAULT_PROMPT = `You are writing a git commit message for the changes below.

Requirements:
- Return only the commit message, with no markdown fences or commentary.
- Use standard scoped Conventional Commit format for the subject: type(scope): imperative summary.
- Choose a clear type such as feat, fix, docs, refactor, test, chore, build, ci, perf, or style.
- Choose a concise lowercase scope that names the affected area.
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

type CommitWorktreeOptions = {
	dryRun: boolean;
	push: boolean;
	includeUntracked: boolean;
	guidance: string;
};

type WorktreeFile = {
	path: string;
	status: string;
	tracked: boolean;
	stagePaths: string[];
};

type CommitGroup = {
	files: string[];
	reason: string;
};

export type YeetSettings = {
	model: "inherit" | `${string}/${string}`;
	reasoning: ThinkingLevel;
};

type CompletionOptions = {
	model?: Model<Api>;
	reasoning?: ThinkingLevel;
};

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function isYeetModel(value: string): value is YeetSettings["model"] {
	return value === "inherit" || /^[^/\s]+\/[^/\s]+$/.test(value);
}

export function readYeetSettings(globalDir = agentDir()): YeetSettings {
	const path = join(globalDir, "settings.json");
	if (!existsSync(path)) return DEFAULT_YEET_SETTINGS;

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Invalid /yeet settings in ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`Invalid /yeet settings in ${path}: expected an object.`);
	}

	const commitMessage = (parsed as { commitMessage?: unknown }).commitMessage;
	if (commitMessage === undefined) return DEFAULT_YEET_SETTINGS;
	if (
		!commitMessage ||
		typeof commitMessage !== "object" ||
		Array.isArray(commitMessage)
	) {
		throw new Error(`Invalid /yeet settings in ${path}: commitMessage must be an object.`);
	}
	const settings = (commitMessage as { yeet?: unknown }).yeet;
	if (settings === undefined) return DEFAULT_YEET_SETTINGS;
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
		throw new Error(`Invalid /yeet settings in ${path}: commitMessage.yeet must be an object.`);
	}

	const { model = DEFAULT_YEET_SETTINGS.model, reasoning = DEFAULT_YEET_SETTINGS.reasoning } = settings as {
		model?: unknown;
		reasoning?: unknown;
	};
	if (typeof model !== "string" || !isYeetModel(model)) {
		throw new Error(
			`Invalid /yeet settings in ${path}: model must be "inherit" or provider/model.`,
		);
	}
	if (
		typeof reasoning !== "string" ||
		!THINKING_LEVELS.has(reasoning as ThinkingLevel)
	) {
		throw new Error(
			`Invalid /yeet settings in ${path}: reasoning must be a supported thinking level.`,
		);
	}

	return { model, reasoning: reasoning as ThinkingLevel };
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

function parseCommitWorktreeOptions(args: string): CommitWorktreeOptions {
	const dryRunFlag = /(^|\s)--dry-run(?=\s|$)/;
	const noPushFlag = /(^|\s)--no-push(?=\s|$)/;
	const trackedOnlyFlag = /(^|\s)(--tracked-only|--no-untracked)(?=\s|$)/;
	const guidance = args
		.replace(
			/(^|\s)(--dry-run|--no-push|--yes|--tracked-only|--no-untracked|include-untracked|untracked)(?=\s|$)/g,
			" ",
		)
		.replace(/\s+/g, " ")
		.trim();
	return {
		dryRun: dryRunFlag.test(args),
		push: !noPushFlag.test(args),
		includeUntracked: !trackedOnlyFlag.test(args),
		guidance,
	};
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

function resolveYeetModel(
	ctx: ExtensionCommandContext,
	settings: YeetSettings,
): Model<Api> {
	if (settings.model === "inherit") {
		if (!ctx.model) throw new Error("No active model selected.");
		return ctx.model;
	}

	const [provider, modelId] = settings.model.split("/");
	if (!provider || !modelId)
		throw new Error(`Configured /yeet model not found: ${settings.model}.`);
	const model = ctx.modelRegistry.find(provider, modelId);
	if (!model)
		throw new Error(`Configured /yeet model not found: ${settings.model}.`);
	return model;
}

async function getModelAuth(ctx: ExtensionCommandContext, model = ctx.model) {
	if (!model) throw new Error("No active model selected.");

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	if (!auth.apiKey) {
		throw new Error(`No API key available for ${model.provider}/${model.id}.`);
	}

	return { model, auth };
}

export function completionText(
	response: Pick<AssistantMessage, "content" | "errorMessage" | "stopReason">,
): string {
	if (response.stopReason === "error") {
		throw new Error(response.errorMessage || "Model completion failed.");
	}

	return response.content
		.filter(
			(part): part is { type: "text"; text: string } => part.type === "text",
		)
		.map((part) => part.text)
		.join("\n");
}

async function completeText(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompt: string,
	options: CompletionOptions = {},
): Promise<string> {
	const { model, auth } = await getModelAuth(ctx, options.model);
	const thinkingLevel = options.reasoning ?? pi.getThinkingLevel();
	const response = await completeSimple(
		model,
		{
			messages: [
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			env: auth.env,
			reasoning: thinkingLevel === "off" ? undefined : thinkingLevel,
			sessionId: ctx.sessionManager.getSessionId(),
		},
	);

	return completionText(response);
}

function parseStatusLine(
	line: string,
	includeUntracked: boolean,
): WorktreeFile | undefined {
	const status = line.slice(0, 2);
	const rawPath = line.slice(3).trim();
	if (!rawPath) return undefined;
	const renameParts = rawPath.includes(" -> ")
		? rawPath.split(" -> ").map((part) => part.trim())
		: undefined;
	const path = renameParts ? renameParts[renameParts.length - 1]! : rawPath;
	const tracked = !status.includes("?");
	if (!tracked && !includeUntracked) return undefined;
	return { path, status, tracked, stagePaths: renameParts ?? [path] };
}

async function getWorktreeFiles(
	pi: ExtensionAPI,
	root: string,
	includeUntracked: boolean,
): Promise<WorktreeFile[]> {
	const stagedResult = await git(pi, root, ["diff", "--cached", "--quiet"]);
	if (stagedResult.code !== 0) {
		throw new Error(
			"yeet requires no pre-staged changes; commit or unstage them first.",
		);
	}

	const statusResult = await git(pi, root, ["status", "--short"]);
	if (statusResult.code !== 0) throw new Error(statusResult.stderr.trim());
	return statusResult.stdout
		.split("\n")
		.map((line) => parseStatusLine(line, includeUntracked))
		.filter((file): file is WorktreeFile => Boolean(file));
}

function groupPrompt(
	root: string,
	files: WorktreeFile[],
	guidance: string,
): string {
	return [
		"Group the current git working tree files into one or more commits.",
		"Group files together only when they are part of the same logical change.",
		'Return only JSON: {"groups":[{"files":["path"],"reason":"short reason"}]}',
		"Every listed file must appear exactly once. Do not invent files.",
		guidance ? `Additional user guidance: ${guidance}` : undefined,
		"",
		`Repository: ${root}`,
		"Files:",
		...files.map((file) => `- ${file.status} ${file.path}`),
	]
		.filter((part): part is string => typeof part === "string")
		.join("\n");
}

function parseGroups(text: string, files: WorktreeFile[]): CommitGroup[] {
	const allowed = new Set(files.map((file) => file.path));
	try {
		const jsonText = text
			.trim()
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/\s*```$/i, "");
		const parsed = JSON.parse(jsonText) as { groups?: CommitGroup[] };
		const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
		const seen = new Set<string>();
		const normalized = groups
			.map((group) => ({
				files: Array.isArray(group.files)
					? group.files.filter((file) => {
							if (!allowed.has(file) || seen.has(file)) return false;
							seen.add(file);
							return true;
						})
					: [],
				reason:
					typeof group.reason === "string" ? group.reason : "Logical change",
			}))
			.filter((group) => group.files.length > 0);
		const missing = files
			.map((file) => file.path)
			.filter((file) => !seen.has(file));
		if (missing.length)
			normalized.push({ files: missing, reason: "Remaining changes" });
		return normalized;
	} catch {
		return [
			{ files: files.map((file) => file.path), reason: "Working tree changes" },
		];
	}
}

async function pathDiff(
	pi: ExtensionAPI,
	root: string,
	files: string[],
): Promise<string> {
	const diff = await git(pi, root, ["diff", "--", ...files]);
	const cached = await git(pi, root, ["diff", "--cached", "--", ...files]);
	const untracked = await git(pi, root, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"--",
		...files,
	]);
	const untrackedSummary = untracked.stdout.trim()
		? `\n\n<untracked-files>\n${untracked.stdout.trim()}\n</untracked-files>`
		: "";
	return (
		[cached.stdout.trim(), diff.stdout.trim()].filter(Boolean).join("\n") +
		untrackedSummary
	);
}

async function generateWorktreeCommitMessage(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	root: string,
	prompt: string,
	status: string,
	files: string[],
	guidance: string,
	completionOptions: CompletionOptions,
): Promise<string> {
	const diff = await pathDiff(pi, root, files);
	const message = cleanCommitMessage(
		await completeText(
			pi,
			ctx,
			buildPrompt(
				prompt,
				{
					root,
					status,
					diff,
					diffKind: "working tree",
					untracked: "",
				},
				guidance,
			),
			completionOptions,
		),
	);
	if (!message)
		throw new Error(`Model returned an empty message for ${files.join(", ")}.`);
	return message;
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
	pi.registerCommand("yeet", {
		description:
			"Generate commit messages, split working tree changes, commit them, and push",
		handler: async (args, ctx) => {
			const options = parseCommitWorktreeOptions(args);
			await ctx.waitForIdle();

			try {
				const yeetSettings = readYeetSettings();
				const completionOptions: CompletionOptions = {
					model: resolveYeetModel(ctx, yeetSettings),
					reasoning: yeetSettings.reasoning,
				};
				const rootResult = await git(pi, ctx.cwd, [
					"rev-parse",
					"--show-toplevel",
				]);
				if (rootResult.code !== 0)
					throw new Error("Not inside a git repository.");
				const root = rootResult.stdout.trim();
				const files = await getWorktreeFiles(
					pi,
					root,
					options.includeUntracked,
				);
				if (!files.length) {
					throw new Error("No committable git changes found.");
				}

				ctx.ui.notify("Grouping working tree changes...", "info");
				const groups = parseGroups(
					await completeText(
						pi,
						ctx,
						groupPrompt(root, files, options.guidance),
						completionOptions,
					),
					files,
				);
				const status = files
					.map((file) => `${file.status} ${file.path}`)
					.join("\n");
				const promptInfo = readPromptFile({
					root,
					status,
					diff: "",
					diffKind: "working tree",
					untracked: "",
				});

				const planned: Array<{ group: CommitGroup; message: string }> = [];
				for (const group of groups) {
					ctx.ui.notify(
						`Generating message for ${group.files.join(", ")}...`,
						"info",
					);
					planned.push({
						group,
						message: await generateWorktreeCommitMessage(
							pi,
							ctx,
							root,
							promptInfo.prompt,
							status,
							group.files,
							[group.reason, options.guidance].filter(Boolean).join("; "),
							completionOptions,
						),
					});
				}

				const summary = planned
					.map(({ group, message }, index) =>
						[
							`Commit ${index + 1} message:`,
							message,
							"",
							`Plan reason: ${group.reason}`,
							`Files to stage: ${group.files.join(", ")}`,
						].join("\n"),
					)
					.join("\n\n---\n\n");

				if (options.dryRun) {
					ctx.ui.notify(summary, "info");
					ctx.ui.notify(
						"Dry run complete; no files were staged, committed, or pushed.",
						"info",
					);
					return;
				}

				const filesByPath = new Map(files.map((file) => [file.path, file]));
				for (const { group, message } of planned) {
					const stagePaths = group.files.flatMap(
						(file) => filesByPath.get(file)?.stagePaths ?? [file],
					);
					const addResult = await git(pi, root, [
						"add",
						"-A",
						"--",
						...stagePaths,
					]);
					if (addResult.code !== 0) throw new Error(addResult.stderr.trim());

					const tempDir = mkdtempSync(join(tmpdir(), "pi-commit-worktree-"));
					const messagePath = join(tempDir, "COMMIT_MESSAGE");
					writeFileSync(messagePath, `${message.trim()}\n`, "utf8");
					try {
						const commitResult = await git(pi, root, [
							"commit",
							"-F",
							messagePath,
						]);
						if (commitResult.code !== 0)
							throw new Error(commitResult.stderr.trim());
					} finally {
						rmSync(tempDir, { recursive: true, force: true });
					}
				}

				if (options.push) {
					const pushResult = await git(pi, root, ["push"]);
					if (pushResult.code !== 0) throw new Error(pushResult.stderr.trim());
					ctx.ui.notify(
						`Committed ${planned.length} group(s) and pushed.`,
						"info",
					);
				} else {
					ctx.ui.notify(
						`Committed ${planned.length} group(s); push skipped.`,
						"info",
					);
				}
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
			}
		},
	});

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

			const { prompt, source } = readPromptFile(gitContext);
			ctx.ui.notify("Generating commit message...", "info");

			let message: string;
			try {
				message = cleanCommitMessage(
					await completeText(
						pi,
						ctx,
						buildPrompt(prompt, gitContext, options.guidance),
					),
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					"error",
				);
				return;
			}

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
