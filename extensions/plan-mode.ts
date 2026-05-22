import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

const STATE_TYPE = "plan-mode-state";
const CONTEXT_TYPE = "plan-mode-context";
const STATUS_KEY = "plan-mode";

const SAFE_TOOL_ALLOWLIST = new Set([
	"read",
	"bash",
	"ls",
	"find",
	"grep",
	"ast_grep_search",
	"lsp_diagnostics",
	"lsp_navigation",
	"web_search",
	"code_search",
	"fetch_content",
	"get_search_content",
	"ask_user",
	"questionnaire",
]);

const MUTATING_TOOL_NAMES = new Set([
	"edit",
	"write",
	"ast_grep_replace",
	"materialize",
	"github_workflow",
	"github_work",
	"github_issue",
	"ralph_start",
	"ralph_done",
	"subagent",
	"obsidian_cli",
]);

const DESTRUCTIVE_BASH_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_BASH_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*rg\b/,
	/^\s*find\b/,
	/^\s*fd\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*ps\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|ls-)/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*pnpm\s+(list|view|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*python3\s+--version/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

type PlanModeState = {
	enabled: boolean;
	previousTools: string[] | undefined;
};

function isSafeBashCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;
	if (DESTRUCTIVE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed)))
		return false;
	return SAFE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isPlanModeState(value: unknown): value is PlanModeState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.enabled === "boolean" &&
		(v.previousTools === undefined || Array.isArray(v.previousTools))
	);
}

function planModeToolNames(pi: ExtensionAPI): string[] {
	const available = new Set(pi.getAllTools().map((tool) => tool.name));
	return [...SAFE_TOOL_ALLOWLIST].filter((toolName) => available.has(toolName));
}

function statusText(enabled: boolean): string | undefined {
	return enabled ? "⏸ plan" : undefined;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let previousTools: string[] | undefined;

	function persist(): void {
		pi.appendEntry<PlanModeState>(STATE_TYPE, { enabled, previousTools });
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, statusText(enabled));
	}

	function enable(ctx: ExtensionContext): void {
		if (enabled) {
			ctx.ui.notify("Plan mode is already enabled.", "info");
			updateStatus(ctx);
			return;
		}

		previousTools = pi.getActiveTools();
		enabled = true;
		const tools = planModeToolNames(pi);
		pi.setActiveTools(tools);
		persist();
		updateStatus(ctx);
		ctx.ui.notify(
			`Plan mode enabled. Read-only tools: ${tools.join(", ") || "(none)"}.`,
			"info",
		);
	}

	function disable(ctx: ExtensionContext): void {
		if (!enabled) {
			ctx.ui.notify("Plan mode is already disabled.", "info");
			updateStatus(ctx);
			return;
		}

		enabled = false;
		if (previousTools && previousTools.length > 0) {
			pi.setActiveTools(previousTools);
		}
		previousTools = undefined;
		persist();
		updateStatus(ctx);
		ctx.ui.notify("Plan mode disabled. Previous tool access restored.", "info");
	}

	function showStatus(ctx: ExtensionContext): void {
		const activeTools = pi.getActiveTools();
		ctx.ui.notify(
			[
				`Plan mode: ${enabled ? "enabled" : "disabled"}`,
				`Active tools: ${activeTools.join(", ") || "(none)"}`,
				enabled
					? "Use /plan off when you are ready to implement."
					: "Use /plan on to switch to read-only planning.",
			].join("\n"),
			"info",
		);
	}

	function handleCommand(args: string, ctx: ExtensionContext): void {
		const subcommand = args.trim().toLowerCase();
		switch (subcommand) {
			case "":
			case "toggle":
				enabled ? disable(ctx) : enable(ctx);
				return;
			case "on":
			case "start":
			case "enable":
				enable(ctx);
				return;
			case "off":
			case "stop":
			case "disable":
			case "execute":
				disable(ctx);
				return;
			case "status":
				showStatus(ctx);
				return;
			default:
				ctx.ui.notify("Usage: /plan [on|off|toggle|status].", "error");
		}
	}

	pi.registerFlag("plan", {
		description: "Start in read-only plan mode",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("plan", {
		description: "Toggle read-only plan mode: /plan [on|off|status]",
		getArgumentCompletions: (prefix: string) => {
			const options = ["on", "off", "toggle", "status"];
			const normalized = prefix.trim().toLowerCase();
			return options
				.filter((option) => !normalized || option.startsWith(normalized))
				.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			handleCommand(args, ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: (ctx) => handleCommand("toggle", ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as {
				type?: string;
				customType?: string;
				data?: unknown;
			};
			if (
				entry.type === "custom" &&
				entry.customType === STATE_TYPE &&
				isPlanModeState(entry.data)
			) {
				enabled = entry.data.enabled;
				previousTools = entry.data.previousTools;
				break;
			}
		}

		if (pi.getFlag("plan") === true) enabled = true;
		if (enabled) pi.setActiveTools(planModeToolNames(pi));
		updateStatus(ctx);
	});

	pi.on("context", (event) => {
		if (enabled) return;
		return {
			messages: event.messages.filter((message) => {
				const maybeCustom = message as { customType?: string };
				return maybeCustom.customType !== CONTEXT_TYPE;
			}),
		};
	});

	pi.on("before_agent_start", () => {
		if (!enabled) return;
		return {
			message: {
				customType: CONTEXT_TYPE,
				content: `[PLAN MODE ACTIVE]
You are in read-only plan mode.

Rules:
- Do not edit files, write files, run mutating commands, install dependencies, change git state, create issues, or launch implementation agents.
- Use read-only exploration tools only.
- If you need information that requires a risky or mutating action, ask the user first instead of doing it.
- Produce a concrete implementation plan with verification steps.
- End by asking whether the user wants to leave plan mode and implement.

When ready to implement, the user can run /plan off.`,
				display: false,
			},
		};
	});

	pi.on("tool_call", (event) => {
		if (!enabled) return;

		if (
			MUTATING_TOOL_NAMES.has(event.toolName) ||
			!SAFE_TOOL_ALLOWLIST.has(event.toolName)
		) {
			return {
				block: true,
				reason: `Plan mode blocked tool '${event.toolName}'. Use /plan off before implementation.`,
			};
		}

		if (event.toolName === "bash") {
			const command = String(
				(event.input as { command?: unknown }).command ?? "",
			);
			if (!isSafeBashCommand(command)) {
				return {
					block: true,
					reason: `Plan mode blocked bash command. Use /plan off before mutating operations.\nCommand: ${command}`,
				};
			}
		}
	});
}
