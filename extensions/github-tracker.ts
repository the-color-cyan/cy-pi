import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const CONFIG_VERSION = 1;
const CONFIG_PATH = join(homedir(), ".pi", "agent", "github-tracker.json");
const STAGES = ["backlog", "planned", "in-progress", "review", "blocked", "done"] as const;
const STAGE_LABELS = STAGES.map((stage) => `stage:${stage}`);

type Stage = (typeof STAGES)[number];
type RepoConfig = { enabled: boolean };
type Config = { version: 1; repos: Record<string, RepoConfig> };
type CommandResult = { ok: boolean; text: string; details?: unknown };

type GithubWorkflowParams = {
	action: "status" | "enable" | "disable";
};

type GithubIssueParams = {
	action: "list" | "create" | "view" | "stage" | "comment" | "close";
	number?: number;
	title?: string;
	body?: string;
	stage?: Stage;
	text?: string;
	args?: string;
};

function defaultConfig(): Config {
	return { version: CONFIG_VERSION, repos: {} };
}

function loadConfig(): Config {
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		if (parsed?.version === CONFIG_VERSION && typeof parsed?.repos === "object" && parsed.repos !== null) {
			return parsed as Config;
		}
	} catch {
		// Missing or invalid config: start fresh.
	}
	return defaultConfig();
}

function saveConfig(config: Config) {
	mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function isStage(value: string | undefined): value is Stage {
	return STAGES.includes(value as Stage);
}

function splitArgs(input: string): string[] {
	const args: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let escaping = false;

	for (const ch of input) {
		if (escaping) {
			current += ch;
			escaping = false;
			continue;
		}
		if (ch === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = undefined;
			else current += ch;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (/\s/.test(ch)) {
			if (current) {
				args.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current) args.push(current);
	return args;
}

function parseCreateArgs(args: string): { title: string; body: string } | undefined {
	const marker = " --body ";
	const markerIndex = args.indexOf(marker);
	if (markerIndex >= 0) {
		const title = args.slice(0, markerIndex).trim().replace(/^['\"]|['\"]$/g, "");
		const body = args.slice(markerIndex + marker.length).trim().replace(/^['\"]|['\"]$/g, "");
		if (title) return { title, body };
	}

	const parts = splitArgs(args);
	const bodyIndex = parts.indexOf("--body");
	if (bodyIndex >= 0) {
		const title = parts.slice(0, bodyIndex).join(" ").trim();
		const body = parts.slice(bodyIndex + 1).join(" ").trim();
		if (title) return { title, body };
	}

	const title = args.trim().replace(/^['\"]|['\"]$/g, "");
	return title ? { title, body: "" } : undefined;
}

function formatExecFailure(command: string, code: number, stderr: string, stdout = ""): string {
	const output = (stderr || stdout || "unknown error").trim();
	const hint = command === "gh" ? "\nHint: install GitHub CLI and run `gh auth login`." : "";
	return `${command} failed with exit code ${code}: ${output}${hint}`;
}

async function exec(pi: ExtensionAPI, command: string, args: string[], cwd: string) {
	return pi.exec(command, args, { cwd, timeout: 30_000 });
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
	const result = await exec(pi, "git", ["rev-parse", "--show-toplevel"], cwd);
	return result.code === 0 ? result.stdout.trim() : undefined;
}

async function getGhRepo(pi: ExtensionAPI, root: string): Promise<string | undefined> {
	const result = await exec(pi, "gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], root);
	return result.code === 0 ? result.stdout.trim() : undefined;
}

function getRepoConfig(root: string): RepoConfig {
	return loadConfig().repos[root] ?? { enabled: false };
}

function setRepoEnabled(root: string, enabled: boolean) {
	const config = loadConfig();
	config.repos[root] = { ...(config.repos[root] ?? {}), enabled };
	saveConfig(config);
}

async function workflowAction(pi: ExtensionAPI, ctx: ExtensionContext, action: GithubWorkflowParams["action"]): Promise<CommandResult> {
	const root = await getRepoRoot(pi, ctx.cwd);
	if (!root) return { ok: false, text: "Not inside a git repository." };

	if (action === "enable" || action === "disable") {
		setRepoEnabled(root, action === "enable");
	}

	const enabled = getRepoConfig(root).enabled;
	const ghRepo = await getGhRepo(pi, root);
	const ghText = ghRepo ? `GitHub repo: ${ghRepo}` : "GitHub repo: unavailable (run `gh auth login` and ensure this repo has a GitHub remote).";
	return {
		ok: true,
		text: `GitHub tracking is ${enabled ? "enabled" : "disabled"} for ${root}.\n${ghText}\nConfig: ${CONFIG_PATH}`,
		details: { root, enabled, ghRepo, configPath: CONFIG_PATH },
	};
}

async function listIssues(pi: ExtensionAPI, root: string, args?: string): Promise<CommandResult> {
	const ghArgs = ["issue", "list", ...(args ? splitArgs(args) : ["--limit", "20"])] ;
	const result = await exec(pi, "gh", ghArgs, root);
	if (result.code !== 0) return { ok: false, text: formatExecFailure("gh", result.code, result.stderr, result.stdout) };
	return { ok: true, text: result.stdout.trim() || "No issues found." };
}

async function createIssue(pi: ExtensionAPI, root: string, title?: string, body?: string): Promise<CommandResult> {
	if (!title?.trim()) return { ok: false, text: "Issue title is required." };
	const result = await exec(pi, "gh", ["issue", "create", "--title", title.trim(), "--body", body?.trim() || ""], root);
	if (result.code !== 0) return { ok: false, text: formatExecFailure("gh", result.code, result.stderr, result.stdout) };
	return { ok: true, text: result.stdout.trim() || `Created issue: ${title}` };
}

async function viewIssue(pi: ExtensionAPI, root: string, number?: number): Promise<CommandResult> {
	if (!number) return { ok: false, text: "Issue number is required." };
	const result = await exec(pi, "gh", ["issue", "view", String(number), "--comments"], root);
	if (result.code !== 0) return { ok: false, text: formatExecFailure("gh", result.code, result.stderr, result.stdout) };
	return { ok: true, text: result.stdout.trim() };
}

async function setIssueStage(pi: ExtensionAPI, root: string, number?: number, stage?: string): Promise<CommandResult> {
	if (!number) return { ok: false, text: "Issue number is required." };
	if (!isStage(stage)) return { ok: false, text: `Stage must be one of: ${STAGES.join(", ")}.` };

	const warnings: string[] = [];
	for (const label of STAGE_LABELS) {
		const result = await exec(pi, "gh", ["issue", "edit", String(number), "--remove-label", label], root);
		if (result.code !== 0 && !/not found|does not have|missing/i.test(result.stderr)) {
			warnings.push(`Could not remove ${label}: ${(result.stderr || result.stdout).trim()}`);
		}
	}

	const add = await exec(pi, "gh", ["issue", "edit", String(number), "--add-label", `stage:${stage}`], root);
	if (add.code !== 0) return { ok: false, text: formatExecFailure("gh", add.code, add.stderr, add.stdout) };
	return { ok: true, text: [`Issue #${number} moved to stage:${stage}.`, ...warnings].join("\n") };
}

async function commentIssue(pi: ExtensionAPI, root: string, number?: number, text?: string): Promise<CommandResult> {
	if (!number) return { ok: false, text: "Issue number is required." };
	if (!text?.trim()) return { ok: false, text: "Comment text is required." };
	const result = await exec(pi, "gh", ["issue", "comment", String(number), "--body", text.trim()], root);
	if (result.code !== 0) return { ok: false, text: formatExecFailure("gh", result.code, result.stderr, result.stdout) };
	return { ok: true, text: result.stdout.trim() || `Commented on issue #${number}.` };
}

async function closeIssue(pi: ExtensionAPI, root: string, number?: number): Promise<CommandResult> {
	if (!number) return { ok: false, text: "Issue number is required." };
	const result = await exec(pi, "gh", ["issue", "close", String(number)], root);
	if (result.code !== 0) return { ok: false, text: formatExecFailure("gh", result.code, result.stderr, result.stdout) };
	return { ok: true, text: result.stdout.trim() || `Closed issue #${number}.` };
}

async function issueAction(pi: ExtensionAPI, ctx: ExtensionContext, params: GithubIssueParams): Promise<CommandResult> {
	const root = await getRepoRoot(pi, ctx.cwd);
	if (!root) return { ok: false, text: "Not inside a git repository." };

	switch (params.action) {
		case "list": return listIssues(pi, root, params.args);
		case "create": return createIssue(pi, root, params.title, params.body);
		case "view": return viewIssue(pi, root, params.number);
		case "stage": return setIssueStage(pi, root, params.number, params.stage);
		case "comment": return commentIssue(pi, root, params.number, params.text ?? params.body);
		case "close": return closeIssue(pi, root, params.number);
		default: return { ok: false, text: `Unknown issue action: ${(params as { action: string }).action}` };
	}
}

async function initLabels(pi: ExtensionAPI, ctx: ExtensionContext): Promise<CommandResult> {
	const root = await getRepoRoot(pi, ctx.cwd);
	if (!root) return { ok: false, text: "Not inside a git repository." };

	const labels: Array<[string, string, string]> = [
		["stage:backlog", "6e7781", "Work captured but not planned"],
		["stage:planned", "1d76db", "Ready to start"],
		["stage:in-progress", "fbca04", "Currently being worked on"],
		["stage:review", "0e8a16", "Ready for review/validation"],
		["stage:blocked", "d73a4a", "Blocked or needs external input"],
		["stage:done", "5319e7", "Completed"],
		["type:bug", "d73a4a", "Bug fix"],
		["type:feature", "a2eeef", "New feature"],
		["type:docs", "0075ca", "Documentation"],
		["priority:p0", "b60205", "Highest priority"],
		["priority:p1", "d93f0b", "High priority"],
		["priority:p2", "fbca04", "Normal priority"],
	];

	const lines: string[] = [];
	for (const [name, color, description] of labels) {
		const result = await exec(pi, "gh", ["label", "create", name, "--color", color, "--description", description], root);
		if (result.code === 0) lines.push(`created ${name}`);
		else if (/already exists/i.test(result.stderr)) lines.push(`exists ${name}`);
		else lines.push(`failed ${name}: ${(result.stderr || result.stdout).trim()}`);
	}
	return { ok: true, text: lines.join("\n") };
}

function helpText(): string {
	return [
		"GitHub tracker commands:",
		"/gh-track help|status|enable|disable",
		"/gh-issue list [gh issue list args]",
		"/gh-issue create <title> --body <body>",
		"/gh-issue view <number>",
		"/gh-issue stage <number> <backlog|planned|in-progress|review|blocked|done>",
		"/gh-issue comment <number> <text>",
		"/gh-issue close <number>",
		"/gh-labels init",
	].join("\n");
}

function notifyResult(ctx: ExtensionContext, result: CommandResult) {
	ctx.ui.notify(result.text, result.ok ? "info" : "error");
}

const StageEnum = Type.Union(STAGES.map((stage) => Type.Literal(stage)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>]);

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const root = await getRepoRoot(pi, ctx.cwd);
		if (!root || !getRepoConfig(root).enabled) return;

		const ghRepo = await getGhRepo(pi, root);
		const ghStatus = ghRepo
			? `GitHub repository detected: ${ghRepo}.`
			: "GitHub CLI/repository is not currently available. Tell the user if issue tracking is needed and suggest `gh auth login` or checking the GitHub remote.";

		return {
			systemPrompt: `${event.systemPrompt}\n\nGitHub issue tracking workflow is enabled for this repository. ${ghStatus}\nWhen doing substantial repo work, use the github_issue tool or /gh-issue-equivalent workflow to: find or create a tracking issue, set it to stage:planned or stage:in-progress when work begins, comment with important decisions or blockers, move it to stage:review when changes are ready to validate, and move it to stage:done/close only after the user approves or the work is clearly complete. Keep trivial read-only questions out of GitHub unless the user asks to track them. If GitHub CLI/auth is unavailable, clearly mention that tracking could not be updated.`,
		};
	});

	pi.registerTool({
		name: "github_workflow",
		label: "GitHub Workflow",
		description: "Check or toggle per-repository GitHub issue tracking workflow state.",
		promptSnippet: "github_workflow: check or toggle GitHub issue tracking for this repo",
		promptGuidelines: ["Use github_workflow status before relying on GitHub tracking; enable/disable only when requested by the user."],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("status"), Type.Literal("enable"), Type.Literal("disable")]),
		}),
		async execute(_toolCallId, params: GithubWorkflowParams, _signal, _onUpdate, ctx) {
			const result = await workflowAction(pi, ctx, params.action);
			return { content: [{ type: "text", text: result.text }], details: result.details ?? result };
		},
	});

	pi.registerTool({
		name: "github_issue",
		label: "GitHub Issue",
		description: "Manage GitHub issues for the current repository with gh CLI. Actions: list, create, view, stage, comment, close.",
		promptSnippet: "github_issue: list/create/view/stage/comment/close GitHub issues for this repo",
		promptGuidelines: [
			"When GitHub tracking is enabled, use github_issue to create/find a tracking issue for substantial implementation work.",
			"Use stage labels stage:planned, stage:in-progress, stage:review, stage:blocked, and stage:done to reflect progress.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("list"), Type.Literal("create"), Type.Literal("view"), Type.Literal("stage"), Type.Literal("comment"), Type.Literal("close")]),
			number: Type.Optional(Type.Number({ description: "Issue number for view/stage/comment/close" })),
			title: Type.Optional(Type.String({ description: "Issue title for create" })),
			body: Type.Optional(Type.String({ description: "Issue body for create, or comment fallback" })),
			stage: Type.Optional(StageEnum),
			text: Type.Optional(Type.String({ description: "Comment text" })),
			args: Type.Optional(Type.String({ description: "Extra gh issue list arguments for list action" })),
		}),
		async execute(_toolCallId, params: GithubIssueParams, _signal, _onUpdate, ctx) {
			const result = await issueAction(pi, ctx, params);
			return { content: [{ type: "text", text: result.text }], details: result.details ?? result };
		},
	});

	pi.registerCommand("gh-track", {
		description: "Toggle or inspect GitHub issue tracking workflow for this repo",
		handler: async (args, ctx) => {
			const action = args.trim() || "status";
			if (action === "help") return notifyResult(ctx, { ok: true, text: helpText() });
			if (!["status", "enable", "disable"].includes(action)) return notifyResult(ctx, { ok: false, text: helpText() });
			notifyResult(ctx, await workflowAction(pi, ctx, action as GithubWorkflowParams["action"]));
		},
	});

	pi.registerCommand("gh-issue", {
		description: "List/create/view/stage/comment/close GitHub issues via gh CLI",
		handler: async (args, ctx) => {
			const [action = "list", ...rest] = splitArgs(args);
			const rawRest = args.trim().slice(action.length).trim();
			let result: CommandResult;
			switch (action) {
				case "list": result = await issueAction(pi, ctx, { action: "list", args: rawRest }); break;
				case "create": {
					const parsed = parseCreateArgs(rawRest);
					result = parsed ? await issueAction(pi, ctx, { action: "create", ...parsed }) : { ok: false, text: "Usage: /gh-issue create <title> --body <body>" };
					break;
				}
				case "view": result = await issueAction(pi, ctx, { action: "view", number: Number(rest[0]) }); break;
				case "stage": result = await issueAction(pi, ctx, { action: "stage", number: Number(rest[0]), stage: rest[1] as Stage }); break;
				case "comment": result = await issueAction(pi, ctx, { action: "comment", number: Number(rest[0]), text: rest.slice(1).join(" ") }); break;
				case "close": result = await issueAction(pi, ctx, { action: "close", number: Number(rest[0]) }); break;
				case "help": result = { ok: true, text: helpText() }; break;
				default: result = { ok: false, text: helpText() }; break;
			}
			notifyResult(ctx, result);
		},
	});

	pi.registerCommand("gh-labels", {
		description: "Initialize standard GitHub tracking labels in the current repo",
		handler: async (args, ctx) => {
			if ((args.trim() || "init") !== "init") return notifyResult(ctx, { ok: false, text: "Usage: /gh-labels init" });
			notifyResult(ctx, await initLabels(pi, ctx));
		},
	});
}
