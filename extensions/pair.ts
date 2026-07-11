import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

type InvolvementMode = "navigator" | "mentor" | "reviewer" | "debugger" | "implementer";
type AttentionLevel = "quiet" | "ambient" | "active";
type AutonomyLevel = "observe" | "suggest" | "ask" | "edit" | "agentic";
type ExplanationLevel = "terse" | "normal" | "mentor" | "socratic";

interface PlanStep {
	description: string;
	done: boolean;
}

interface PairState {
	active: boolean;
	mode: InvolvementMode;
	attention: AttentionLevel;
	autonomy: AutonomyLevel;
	explain: ExplanationLevel;
	goal: string;
	plan: PlanStep[];
	currentStep: number;
	openQuestions: string[];
	learningNotes: string[];
}

const CUSTOM_TYPE = "pair-state";
const WIDGET_KEY = "pair-dashboard";

const MODES: InvolvementMode[] = ["navigator", "mentor", "reviewer", "debugger", "implementer"];
const ATTENTIONS: AttentionLevel[] = ["quiet", "ambient", "active"];
const AUTONOMIES: AutonomyLevel[] = ["observe", "suggest", "ask", "edit", "agentic"];
const EXPLANATIONS: ExplanationLevel[] = ["terse", "normal", "mentor", "socratic"];

const DEFAULT_STATE: PairState = {
	active: false,
	mode: "navigator",
	attention: "active",
	autonomy: "ask",
	explain: "normal",
	goal: "",
	plan: [],
	currentStep: 0,
	openQuestions: [],
	learningNotes: [],
};

let state: PairState = cloneState(DEFAULT_STATE);

function cloneState(value: PairState): PairState {
	return {
		...value,
		plan: value.plan.map((step) => ({ ...step })),
		openQuestions: [...value.openQuestions],
		learningNotes: [...value.learningNotes],
	};
}

function persist(pi: ExtensionAPI): void {
	pi.appendEntry(CUSTOM_TYPE, cloneState(state));
}

function restore(entries: SessionEntry[]): void {
	let latest: PairState | undefined;
	for (const entry of entries) {
		if (entry.type === "custom" && (entry as { customType?: string }).customType === CUSTOM_TYPE) {
			const data = (entry as { data?: unknown }).data;
			if (isPairState(data)) {
				latest = cloneState(data);
			}
		}
	}
	if (latest) {
		state = latest;
	} else {
		state = cloneState(DEFAULT_STATE);
	}
}

function isPairState(value: unknown): value is PairState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.active === "boolean" &&
		typeof v.mode === "string" &&
		typeof v.attention === "string" &&
		typeof v.autonomy === "string" &&
		typeof v.explain === "string" &&
		typeof v.goal === "string" &&
		Array.isArray(v.plan) &&
		typeof v.currentStep === "number" &&
		Array.isArray(v.openQuestions) &&
		Array.isArray(v.learningNotes)
	);
}

function stateSummary(): string {
	const lines: string[] = [
		`Pair session: ${state.active ? "active" : "inactive"}`,
		`Mode: ${state.mode} · Attention: ${state.attention} · Autonomy: ${state.autonomy} · Explain: ${state.explain}`,
	];
	if (state.goal) lines.push(`Goal: ${state.goal}`);
	if (state.plan.length > 0) {
		lines.push("Plan:");
		for (let i = 0; i < state.plan.length; i++) {
			const s = state.plan[i]!;
			const marker = s.done ? "[x]" : "[ ]";
			const cursor = i === state.currentStep ? " <-- current" : "";
			lines.push(`  ${i + 1}. ${marker} ${s.description}${cursor}`);
		}
	}
	if (state.openQuestions.length > 0) {
		lines.push("Open questions:");
		for (const q of state.openQuestions) lines.push(`  - ${q}`);
	}
	if (state.learningNotes.length > 0) {
		lines.push("Learning notes:");
		for (const n of state.learningNotes) lines.push(`  - ${n}`);
	}
	return lines.join("\n");
}

function dashboardLines(): string[] {
	if (!state.active) return ["Pair: inactive"];
	const lines: string[] = [
		`🤝 Pair · ${state.mode} · ${state.attention} · ${state.autonomy} · ${state.explain}`,
	];
	if (state.goal) lines.push(`Goal: ${state.goal}`);
	if (state.plan.length > 0) {
		for (let i = 0; i < state.plan.length; i++) {
			const s = state.plan[i]!;
			const marker = s.done ? "✓" : "○";
			const cursor = i === state.currentStep ? " ▸" : "";
			lines.push(`  ${marker} ${s.description}${cursor}`);
		}
	}
	return lines;
}

function updateWidget(ctx: ExtensionCommandContext): void {
	if (!ctx.hasUI) return;
	if (state.active) {
		ctx.ui.setWidget(WIDGET_KEY, dashboardLines(), { placement: "aboveEditor" });
	} else {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}
}

function buildStateContext(): string {
	return [
		`Pair session: ${state.active ? "active" : "inactive"}`,
		`Mode: ${state.mode}`,
		`Attention: ${state.attention}`,
		`Autonomy: ${state.autonomy}`,
		`Explanation: ${state.explain}`,
		state.goal ? `Goal: ${state.goal}` : "Goal: (none set)",
		state.plan.length
			? `Plan:\n${state.plan.map((s, i) => `${i + 1}. ${s.done ? "[x]" : "[ ]"} ${s.description}${i === state.currentStep ? " <-- current" : ""}`).join("\n")}`
			: "Plan: (none)",
		state.openQuestions.length ? `Open questions:\n${state.openQuestions.map((q) => `- ${q}`).join("\n")}` : "",
		state.learningNotes.length ? `Learning notes:\n${state.learningNotes.map((n) => `- ${n}`).join("\n")}` : "",
	].filter(Boolean).join("\n");
}

function autonomyGuidance(): string {
	switch (state.autonomy) {
		case "observe":
			return "Only observe, ask clarifying questions, and point out risks. Do not suggest code or actions.";
		case "suggest":
			return "Offer ideas and alternatives, but wait for the user's go-ahead before any concrete action.";
		case "ask":
			return "Propose concrete next actions and ask for confirmation before executing anything.";
		case "edit":
			return "Propose code changes and explain what you will do, then wait for explicit confirmation.";
		case "agentic":
			return "Drive the work forward, making changes as needed, but keep the user informed and pause if uncertain.";
	}
}

function attentionGuidance(): string {
	switch (state.attention) {
		case "quiet":
			return "Attention level: quiet. Stay out of the way; respond only to the requested pairing task and avoid unsolicited scope expansion.";
		case "ambient":
			return "Attention level: ambient. Offer occasional checkpoints, risks, and useful questions, but keep interruptions low.";
		case "active":
			return "Attention level: active. Proactively guide the flow with next-step suggestions, checkpoints, and learning callouts while respecting autonomy.";
	}
}

function explanationGuidance(): string {
	switch (state.explain) {
		case "terse":
			return "Keep responses short and to the point. Use bullets, avoid fluff.";
		case "normal":
			return "Provide balanced explanations with enough detail to be useful but concise.";
		case "mentor":
			return "Teach underlying concepts, trade-offs, and best practices as you go.";
		case "socratic":
			return "Guide the user to answers through thoughtful questions rather than direct answers.";
	}
}

async function sendPlanPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const prompt = [
		"You are my pair-programming partner. Do not jump straight to code changes. Think with me and help shape a solid plan.",
		"",
		"Current context:",
		buildStateContext(),
		"",
		attentionGuidance(),
		autonomyGuidance(),
		explanationGuidance(),
		"",
		"Please propose a concrete step-by-step plan to achieve the goal. Break it into small, verifiable steps. Number them 1..N. If a plan already exists, review and refine it based on what we've learned.",
	].join("\n");
	await ctx.waitForIdle();
	pi.sendUserMessage(prompt);
}

async function sendStepPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const prompt = [
		"You are my pair-programming partner. We're working through the current step together.",
		"",
		"Current context:",
		buildStateContext(),
		"",
		attentionGuidance(),
		autonomyGuidance(),
		explanationGuidance(),
		"",
		"Please help me with the current step. Engage at the attention and autonomy levels described above. Do not write large blocks of code unless the user asks."
	].join("\n");
	await ctx.waitForIdle();
	pi.sendUserMessage(prompt);
}

async function sendReviewDiffPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	await ctx.waitForIdle();
	ctx.ui.setStatus("pair-review", "Fetching diff for review…");
	let diff = "";
	try {
		const staged = await pi.exec("git", ["diff", "--cached"], { cwd: ctx.cwd, timeout: 15_000 });
		const unstaged = await pi.exec("git", ["diff"], { cwd: ctx.cwd, timeout: 15_000 });
		const parts: string[] = [];
		if (staged.stdout.trim()) {
			parts.push("=== Staged ===\n" + staged.stdout.trim());
		}
		if (unstaged.stdout.trim()) {
			parts.push("=== Unstaged ===\n" + unstaged.stdout.trim());
		}
		diff = parts.join("\n\n");
	} catch (error) {
		ctx.ui.setStatus("pair-review", undefined);
		ctx.ui.notify(`Failed to read diff: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	} finally {
		ctx.ui.setStatus("pair-review", undefined);
	}

	if (!diff.trim()) {
		ctx.ui.notify("No diff found. There are no staged or unstaged changes to review.", "warning");
		return;
	}

	const prompt = [
		"You are my pair-programming partner. Please review the current code diff as a thoughtful reviewer.",
		"",
		"Current context:",
		buildStateContext(),
		"",
		`Mode guidance: ${state.mode}.`,
		attentionGuidance(),
		"- navigator: focus on architecture, design fit, and long-term maintainability.",
		"- mentor: teach concepts and patterns relevant to the changes.",
		"- reviewer: catch bugs, edge cases, and style issues.",
		"- debugger: trace logic, look for failure modes, and validate assumptions.",
		"- implementer: check completeness and verify the change matches the intent.",
		"",
		explanationGuidance(),
		"",
		"Here is the diff:",
		"```diff",
		diff,
		"```",
		"",
		"Provide specific, actionable feedback. If you see issues, explain why and suggest fixes.",
	].join("\n");

	pi.sendUserMessage(prompt);
}

async function sendSummaryPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const prompt = [
		"You are my pair-programming partner. Please summarize our session progress.",
		"",
		"Current context:",
		buildStateContext(),
		"",
		"Summarize:",
		"- What we've accomplished so far",
		"- What remains",
		"- Any blockers or risks",
		"- Suggested next actions",
	].join("\n");
	await ctx.waitForIdle();
	pi.sendUserMessage(prompt);
}

function usage(): string {
	return [
		"Usage: /pair <subcommand> [args]",
		"",
		"Subcommands:",
		"  start [goal]          Start a pair session (optionally with a goal)",
		"  stop                  Stop the pair session",
		"  status, dashboard     Show current pair state",
		"  mode <mode>           Set involvement mode: navigator, mentor, reviewer, debugger, implementer",
		"  attention <level>     Set attention: quiet, ambient, active",
		"  explain <level>       Set explanation: terse, normal, mentor, socratic",
		"  autonomy <level>      Set autonomy: observe, suggest, ask, edit, agentic",
		"  goal <text>           Set the current goal",
		"  plan [steps]          Ask LLM to create/revise plan, or set plan directly (use | to separate steps)",
		"  step <n|next|prev|done>  Manage current step; without args asks LLM for help",
		"  checkpoint            Alias for step (LLM-facing checkpoint)",
		"  review-diff           Ask LLM to review staged + unstaged diff",
		"  summary               Ask LLM for session summary",
		"  help                  Show this help",
	].join("\n");
}

function notifyState(ctx: ExtensionCommandContext, message: string): void {
	ctx.ui.notify(message, "info");
}

function restoreAndRender(ctx: ExtensionContext): void {
	restore(ctx.sessionManager.getBranch());
	if (ctx.hasUI) updateWidget(ctx as ExtensionCommandContext);
}

function setMode(args: string, ctx: ExtensionCommandContext): boolean {
	const val = args.trim().toLowerCase() as InvolvementMode;
	if (!MODES.includes(val)) {
		ctx.ui.notify(`Invalid mode. Choose one of: ${MODES.join(", ")}.`, "error");
		return false;
	}
	state.mode = val;
	return true;
}

function setAttention(args: string, ctx: ExtensionCommandContext): boolean {
	const val = args.trim().toLowerCase() as AttentionLevel;
	if (!ATTENTIONS.includes(val)) {
		ctx.ui.notify(`Invalid attention level. Choose one of: ${ATTENTIONS.join(", ")}.`, "error");
		return false;
	}
	state.attention = val;
	return true;
}

function setExplain(args: string, ctx: ExtensionCommandContext): boolean {
	const val = args.trim().toLowerCase() as ExplanationLevel;
	if (!EXPLANATIONS.includes(val)) {
		ctx.ui.notify(`Invalid explanation level. Choose one of: ${EXPLANATIONS.join(", ")}.`, "error");
		return false;
	}
	state.explain = val;
	return true;
}

function setAutonomy(args: string, ctx: ExtensionCommandContext): boolean {
	const val = args.trim().toLowerCase() as AutonomyLevel;
	if (!AUTONOMIES.includes(val)) {
		ctx.ui.notify(`Invalid autonomy level. Choose one of: ${AUTONOMIES.join(", ")}.`, "error");
		return false;
	}
	state.autonomy = val;
	return true;
}

function setGoal(args: string): void {
	state.goal = args.trim();
}

function setPlan(args: string): void {
	const trimmed = args.trim();
	if (!trimmed) {
		state.plan = [];
		state.currentStep = 0;
		return;
	}
	const steps = trimmed.split("|").map((s) => s.trim()).filter(Boolean);
	if (steps.length === 0) {
		state.plan = [];
		state.currentStep = 0;
		return;
	}
	state.plan = steps.map((description) => ({ description, done: false }));
	state.currentStep = 0;
}

function manageStep(args: string, ctx: ExtensionCommandContext): boolean {
	const trimmed = args.trim().toLowerCase();
	if (!trimmed) {
		return false; // signals LLM-facing action
	}
	if (trimmed === "next") {
		if (state.currentStep < state.plan.length - 1) {
			state.currentStep++;
		} else if (state.plan.length > 0) {
			ctx.ui.notify("Already at the last step.", "warning");
		} else {
			ctx.ui.notify("No plan steps to advance.", "warning");
		}
		return true;
	}
	if (trimmed === "prev") {
		if (state.currentStep > 0) {
			state.currentStep--;
		} else {
			ctx.ui.notify("Already at the first step.", "warning");
		}
		return true;
	}
	if (trimmed === "done") {
		if (state.plan.length === 0) {
			ctx.ui.notify("No plan steps to mark done.", "warning");
			return true;
		}
		const s = state.plan[state.currentStep];
		if (s) s.done = true;
		if (state.currentStep < state.plan.length - 1) {
			state.currentStep++;
			ctx.ui.notify("Step marked done. Advanced to next step.", "info");
		} else {
			ctx.ui.notify("Step marked done.", "info");
		}
		return true;
	}
	const n = Number.parseInt(trimmed, 10);
	if (Number.isFinite(n) && n >= 1 && n <= state.plan.length) {
		state.currentStep = n - 1;
		return true;
	}
	ctx.ui.notify(`Invalid step. Use a number 1..${state.plan.length}, next, prev, or done.`, "error");
	return false;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		restoreAndRender(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		restoreAndRender(ctx);
	});

	pi.registerCommand("pair", {
		description: "Pair-programming session manager: start, stop, plan, step, review-diff, and more",
		getArgumentCompletions: (prefix: string) => {
			const subcommands = [
				"start", "stop", "status", "dashboard", "mode", "attention",
				"explain", "autonomy", "goal", "plan", "step", "checkpoint",
				"review-diff", "summary", "help",
			];
			const normalized = prefix.trim().toLowerCase();
			const filtered = normalized
				? subcommands.filter((s) => s.startsWith(normalized))
				: subcommands;
			return filtered.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const trimmedArgs = args.trim();
			const firstSpace = trimmedArgs.indexOf(" ");
			const sub = (firstSpace >= 0 ? trimmedArgs.slice(0, firstSpace) : trimmedArgs).toLowerCase();
			const rest = firstSpace >= 0 ? trimmedArgs.slice(firstSpace + 1) : "";

			if (!sub || sub === "help") {
				ctx.ui.notify(usage(), "info");
				return;
			}

			switch (sub) {
				case "start": {
					state.active = true;
					if (rest.trim()) state.goal = rest.trim();
					persist(pi);
					updateWidget(ctx);
					notifyState(ctx, `Pair session started.${state.goal ? ` Goal: ${state.goal}` : ""}`);
					return;
				}
				case "stop": {
					state.active = false;
					persist(pi);
					updateWidget(ctx);
					notifyState(ctx, "Pair session stopped.");
					return;
				}
				case "status":
				case "dashboard": {
					ctx.ui.notify(stateSummary(), "info");
					updateWidget(ctx);
					return;
				}
				case "mode": {
					if (!setMode(rest, ctx)) return;
					persist(pi);
					notifyState(ctx, `Mode set to ${state.mode}.`);
					updateWidget(ctx);
					return;
				}
				case "attention": {
					if (!setAttention(rest, ctx)) return;
					persist(pi);
					notifyState(ctx, `Attention set to ${state.attention}.`);
					updateWidget(ctx);
					return;
				}
				case "explain": {
					if (!setExplain(rest, ctx)) return;
					persist(pi);
					notifyState(ctx, `Explanation level set to ${state.explain}.`);
					updateWidget(ctx);
					return;
				}
				case "autonomy": {
					if (!setAutonomy(rest, ctx)) return;
					persist(pi);
					notifyState(ctx, `Autonomy set to ${state.autonomy}.`);
					updateWidget(ctx);
					return;
				}
				case "goal": {
					setGoal(rest);
					persist(pi);
					notifyState(ctx, `Goal set: ${state.goal}`);
					updateWidget(ctx);
					return;
				}
				case "plan": {
					if (rest.trim()) {
						setPlan(rest);
						persist(pi);
						notifyState(ctx, `Plan updated (${state.plan.length} steps).`);
						updateWidget(ctx);
					} else {
						if (!state.active) {
							ctx.ui.notify("Pair session is not active. Start with /pair start", "warning");
							return;
						}
						await sendPlanPrompt(pi, ctx);
						// No persist; LLM will respond and user can update state manually or via future commands
					}
					return;
				}
				case "step":
				case "checkpoint": {
					if (rest.trim()) {
						if (!manageStep(rest, ctx)) return;
						persist(pi);
						const current = state.plan[state.currentStep];
						notifyState(ctx, current ? `Step ${state.currentStep + 1}: ${current.description}` : "Step updated.");
						updateWidget(ctx);
					} else {
						if (!state.active) {
							ctx.ui.notify("Pair session is not active. Start with /pair start", "warning");
							return;
						}
						await sendStepPrompt(pi, ctx);
					}
					return;
				}
				case "review-diff": {
					if (!state.active) {
						ctx.ui.notify("Pair session is not active. Start with /pair start", "warning");
						return;
					}
					await sendReviewDiffPrompt(pi, ctx);
					return;
				}
				case "summary": {
					if (!state.active) {
						ctx.ui.notify("Pair session is not active. Start with /pair start", "warning");
						return;
					}
					await sendSummaryPrompt(pi, ctx);
					return;
				}
				default: {
					ctx.ui.notify(`Unknown subcommand: ${sub}\n${usage()}`, "error");
				}
			}
		},
	});
}
