import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

let lastParentSessionFile: string | null = null;

type SubagentStatus = {
	runId?: string;
	state?: string;
	mode?: string;
	cwd?: string;
	startedAt?: number;
	lastUpdate?: number;
	endedAt?: number;
	currentStep?: number;
	currentTool?: string;
	activityState?: string;
	lastActivityAt?: number;
	outputFile?: string;
	sessionFile?: string;
	sessionDir?: string;
	steps?: Array<{
		agent?: string;
		status?: string;
		currentTool?: string;
		activityState?: string;
		lastActivityAt?: number;
		durationMs?: number;
		error?: string;
	}>;
};

type PaneState = {
	token: number;
	handle?: OverlayHandle;
	done?: () => void;
	interval?: ReturnType<typeof setInterval>;
	cleanup?: () => void;
};

function uniqueExistingDirs(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const candidate of paths) {
		const resolved = path.resolve(candidate);
		if (seen.has(resolved)) continue;
		seen.add(resolved);
		if (fs.existsSync(resolved)) result.push(resolved);
	}
	return result;
}

function getAsyncRoots(): string[] {
	if (process.env.PI_SUBAGENTS_ASYNC_DIR) {
		return uniqueExistingDirs([path.resolve(process.env.PI_SUBAGENTS_ASYNC_DIR)]);
	}

	const tmp = process.env.PI_TMP_DIR || os.tmpdir();
	const candidates = [
		path.join(tmp, "pi-subagents-project", "async-subagent-runs"),
		path.join(tmp, "pi-subagents-user", "async-subagent-runs"),
	];

	try {
		for (const entry of fs.readdirSync(tmp, { withFileTypes: true })) {
			if (!entry.isDirectory() || !entry.name.startsWith("pi-subagents-")) continue;
			candidates.push(path.join(tmp, entry.name, "async-subagent-runs"));
		}
	} catch {
		// Best-effort discovery only.
	}

	return uniqueExistingDirs(candidates);
}

function findRunDirs(idOrPrefix: string): string[] {
	const matches: string[] = [];
	for (const root of getAsyncRoots()) {
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			if (entry.name === idOrPrefix || entry.name.startsWith(idOrPrefix)) {
				matches.push(path.join(root, entry.name));
			}
		}
	}
	return matches;
}

function isPaneTestRunDir(runDir: string): boolean {
	return path.basename(runDir).startsWith("pane-test-");
}

function findAllRuns(): Array<{ dir: string; mtimeMs: number }> {
	const allRuns: Array<{ dir: string; mtimeMs: number }> = [];
	for (const root of getAsyncRoots()) {
		for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(root, entry.name);
			try {
				const statusPath = path.join(dir, "status.json");
				const stat = fs.existsSync(statusPath) ? fs.statSync(statusPath) : fs.statSync(dir);
				allRuns.push({ dir, mtimeMs: stat.mtimeMs });
			} catch {
				// ignore unreadable entries
			}
		}
	}
	allRuns.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return allRuns;
}

function findLatestRunDir(): string | undefined {
	const runs = findAllRuns();
	return (runs.find(({ dir }) => !isPaneTestRunDir(dir)) ?? runs[0])?.dir;
}

function readRunSessionFile(runDir: string): string | undefined {
	const status = readStatus(runDir);
	return typeof status?.sessionFile === "string" ? status.sessionFile : undefined;
}

function readStatus(runDir: string): SubagentStatus | undefined {
	try {
		return JSON.parse(fs.readFileSync(path.join(runDir, "status.json"), "utf-8")) as SubagentStatus;
	} catch {
		return undefined;
	}
}

function resolveRunPath(runDir: string, maybePath: string | undefined): string | undefined {
	if (!maybePath) return undefined;
	return path.isAbsolute(maybePath) ? maybePath : path.join(runDir, maybePath);
}

function formatDuration(ms: number): string {
	const safe = Math.max(0, ms);
	const seconds = Math.floor(safe / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

function shortenPath(value: string, max = 48): string {
	const home = os.homedir();
	const shortened = value.startsWith(home) ? `~${value.slice(home.length)}` : value;
	return shortened.length > max ? `…${shortened.slice(-(max - 1))}` : shortened;
}

function tailFileLines(filePath: string | undefined, maxLines: number, maxBytes = 64 * 1024): string[] {
	if (!filePath) return [];
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) return [];
		const start = Math.max(0, stat.size - maxBytes);
		const fd = fs.openSync(filePath, "r");
		try {
			const buffer = Buffer.alloc(stat.size - start);
			const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, start);
			return buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/).filter((line) => line.trim()).slice(-maxLines);
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return [];
	}
}

function formatEventLine(raw: string): string | undefined {
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const ts = typeof parsed.ts === "number" ? new Date(parsed.ts).toISOString().slice(11, 19) : undefined;
		const type = typeof parsed.type === "string" ? parsed.type : "event";
		const agent = typeof parsed.agent === "string" ? parsed.agent : typeof parsed.subagentAgent === "string" ? parsed.subagentAgent : undefined;
		const status = typeof parsed.status === "string" ? parsed.status : undefined;
		const msg = typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : undefined;
		return [ts, type, agent, status, msg].filter(Boolean).join(" | ");
	} catch {
		return raw.trim() || undefined;
	}
}

function recentEvents(runDir: string, limit: number): string[] {
	return tailFileLines(path.join(runDir, "events.jsonl"), limit).map(formatEventLine).filter((line): line is string => Boolean(line));
}

function statusColor(theme: Theme, state: string | undefined): string {
	const label = state ?? "unknown";
	if (label === "running") return theme.fg("warning", label);
	if (label === "queued") return theme.fg("accent", label);
	if (label === "complete") return theme.fg("success", label);
	if (label === "failed") return theme.fg("error", label);
	if (label === "paused") return theme.fg("warning", label);
	return label;
}

class SubagentPane implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private theme: Theme,
		private runDir: string,
	) {}

	refresh(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	invalidate(): void {
		this.refresh();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const status = readStatus(this.runDir);
		const th = this.theme;
		const inner = Math.max(1, width - 2);
		const border = (text: string) => th.fg("border", text);
		const pad = (text: string) => {
			const truncated = truncateToWidth(text, inner, "…", true);
			return truncated + " ".repeat(Math.max(0, inner - visibleWidth(truncated)));
		};
		const id = status?.runId ?? path.basename(this.runDir);
		const stepCount = status?.steps?.length ?? 0;
		const stepLabel = status?.currentStep !== undefined ? `step ${status.currentStep + 1}/${Math.max(1, stepCount)}` : `${stepCount || 1} step(s)`;
		const activity = status?.lastActivityAt ? `active ${formatDuration(Date.now() - status.lastActivityAt)} ago` : undefined;

		const body: string[] = [
			border(`╭${"─".repeat(inner)}╮`),
			border("│") + pad(`${th.fg("accent", `Subagent ${id.slice(0, 8)}`)} · ${statusColor(th, status?.state)} · ${status?.mode ?? "?"}`) + border("│"),
			border("│") + pad([stepLabel, activity, status?.currentTool ? `tool ${status.currentTool}` : undefined].filter(Boolean).join(" · ")) + border("│"),
		];

		const cwd = status?.cwd ?? this.runDir;
		body.push(border("│") + pad(`cwd ${shortenPath(cwd)}`) + border("│"));
		body.push(border("├") + border("─".repeat(inner)) + border("┤"));

		const steps = status?.steps ?? [];
		if (steps.length === 0) {
			body.push(border("│") + pad(th.fg("dim", "No step details yet.")) + border("│"));
		} else {
			for (const [index, step] of steps.slice(0, 5).entries()) {
				const line = `${index + 1}. ${step.agent ?? "agent"} · ${step.status ?? "pending"}${step.currentTool ? ` · ${step.currentTool}` : ""}`;
				body.push(border("│") + pad(line) + border("│"));
				if (step.error) body.push(border("│") + pad(th.fg("error", `  ${step.error}`)) + border("│"));
			}
		}

		const events = recentEvents(this.runDir, 5);
		body.push(border("├") + border("─".repeat(inner)) + border("┤"));
		if (events.length > 0) {
			for (const event of events) body.push(border("│") + pad(event) + border("│"));
		} else {
			const outputPath = resolveRunPath(this.runDir, status?.outputFile) ?? path.join(this.runDir, `subagent-log-${id}.md`);
			const outputTail = tailFileLines(outputPath, 5);
			if (outputTail.length > 0) {
				for (const line of outputTail) body.push(border("│") + pad(line) + border("│"));
			} else {
				body.push(border("│") + pad(th.fg("dim", "No events/output yet.")) + border("│"));
			}
		}

		body.push(border("├") + border("─".repeat(inner)) + border("┤"));
		body.push(border("│") + pad(th.fg("dim", "/subpane hide · /subattach " + id.slice(0, 8))) + border("│"));
		body.push(border(`╰${"─".repeat(inner)}╯`));

		this.cachedWidth = width;
		this.cachedLines = body;
		return body;
	}
}

function listRunSummary(): string {
	const runs = findAllRuns().slice(0, 10);
	if (runs.length === 0) return "No async subagent runs found.";
	return runs.map(({ dir }) => {
		const status = readStatus(dir);
		const id = status?.runId ?? path.basename(dir);
		const agents = status?.steps?.map((step) => step.agent).filter(Boolean).join("+") || "subagent";
		const kind = isPaneTestRunDir(dir) ? " smoke" : "";
		return `${id.slice(0, 12)}  ${status?.state ?? "unknown"}${kind}  ${agents}  ${shortenPath(status?.cwd ?? dir, 64)}`;
	}).join("\n");
}

function createPaneTestRun(): { runDir: string; cleanup: () => void } {
	const roots = getAsyncRoots();
	const root = roots[0] ?? path.join(process.env.PI_TMP_DIR || os.tmpdir(), "pi-subagents-pane-test", "async-subagent-runs");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const runId = `pane-test-${stamp}`;
	const runDir = path.join(root, runId);
	fs.mkdirSync(runDir, { recursive: true });
	const outputFile = path.join(runDir, "output.md");
	let tick = 0;
	const write = () => {
		const now = Date.now();
		fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify({
			runId,
			state: "running",
			mode: "single",
			cwd: process.cwd(),
			startedAt: now - tick * 1000,
			lastUpdate: now,
			lastActivityAt: now,
			currentStep: 0,
			currentTool: tick % 2 === 0 ? "bash" : "edit",
			outputFile,
			steps: [{ agent: "pane-test", status: "running", currentTool: tick % 2 === 0 ? "bash" : "edit", lastActivityAt: now }],
		}, null, 2) + "\n", "utf8");
		fs.appendFileSync(path.join(runDir, "events.jsonl"), JSON.stringify({ ts: now, type: "subagent.test", agent: "pane-test", status: "running", message: `simulated event ${tick}` }) + "\n", "utf8");
		fs.appendFileSync(outputFile, `simulated subagent output ${tick}\n`, "utf8");
		tick += 1;
	};
	write();
	const interval = setInterval(write, 1000);
	let cleaned = false;
	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		clearInterval(interval);
		try {
			const now = Date.now();
			const status = readStatus(runDir) ?? { runId };
			fs.writeFileSync(path.join(runDir, "status.json"), JSON.stringify({
				...status,
				state: "complete",
				endedAt: now,
				lastUpdate: now,
				lastActivityAt: status.lastActivityAt ?? now,
				currentTool: undefined,
				steps: status.steps?.map((step) => ({
					...step,
					status: step.status === "running" ? "complete" : step.status,
					currentTool: undefined,
				})),
			}, null, 2) + "\n", "utf8");
		} catch {
			// Best-effort test cleanup only.
		}
	};
	return { runDir, cleanup };
}

export default function (pi: ExtensionAPI) {
	let paneState: PaneState | undefined;
	let paneToken = 0;

	const hidePane = (): boolean => {
		const state = paneState;
		if (!state) return false;
		if (state.interval) clearInterval(state.interval);
		state.cleanup?.();
		state.handle?.hide();
		state.done?.();
		paneState = undefined;
		return true;
	};

	const paneVisibilityHint = (): string | undefined => {
		const stdout = process.stdout as typeof process.stdout & { columns?: number; rows?: number };
		const columns = stdout.columns;
		const rows = stdout.rows;
		if ((columns !== undefined && columns < 100) || (rows !== undefined && rows < 24)) {
			return `Pane overlays are hidden below 100x24; current terminal is ${columns ?? "?"}x${rows ?? "?"}.`;
		}
		return undefined;
	};

	const showPane = (ctx: ExtensionContext, runDir: string, cleanup?: () => void): boolean => {
		if (!ctx.hasUI) return false;
		hidePane();
		const token = ++paneToken;
		void ctx.ui.custom<void>((tui: TUI, theme, _kb, done) => {
			const component = new SubagentPane(theme, runDir);
			const interval = setInterval(() => {
				component.refresh();
				tui.requestRender();
			}, 1500);
			paneState = { token, done, interval, cleanup };
			return component;
		}, {
			overlay: true,
			overlayOptions: {
				nonCapturing: true,
				anchor: "top-right",
				width: "42%",
				minWidth: 52,
				maxHeight: "45%",
				margin: { top: 1, right: 1 },
				visible: (termWidth, termHeight) => termWidth >= 100 && termHeight >= 24,
			},
			onHandle: (handle) => {
				if (paneState?.token === token) paneState.handle = handle;
			},
		}).finally(() => {
			if (paneState?.token !== token) return;
			if (paneState.interval) clearInterval(paneState.interval);
			paneState.cleanup?.();
			paneState = undefined;
		});
		return true;
	};

	async function handleSubpane(args: string, ctx: ExtensionContext) {
		const [action = "latest", idOrPrefix] = args.trim() ? args.trim().split(/\s+/, 2) : ["latest", undefined];
		if (["hide", "off"].includes(action)) {
			ctx.ui.notify(hidePane() ? "Subagent pane hidden." : "Subagent pane was not visible.", "info");
			return;
		}
		if (action === "toggle" && paneState) {
			ctx.ui.notify(hidePane() ? "Subagent pane hidden." : "Subagent pane was not visible.", "info");
			return;
		}
		if (action === "list") {
			ctx.ui.notify(listRunSummary(), "info");
			return;
		}
		if (action === "test" || action === "smoke") {
			const test = createPaneTestRun();
			const shown = showPane(ctx, test.runDir, test.cleanup);
			const hint = shown ? paneVisibilityHint() : undefined;
			ctx.ui.notify(shown ? `Subagent pane test started: ${test.runDir}${hint ? `. ${hint}` : ""}` : "Subagent pane requires the interactive TUI.", hint ? "warning" : "info");
			return;
		}

		const target = action === "latest" || action === "show" || action === "toggle"
			? idOrPrefix
			: action;
		let runDir: string | undefined;
		if (!target) {
			runDir = findLatestRunDir();
		} else {
			const matches = findRunDirs(target);
			if (matches.length > 1) {
				ctx.ui.notify(`Ambiguous subagent run '${target}': ${matches.map((dir) => path.basename(dir)).join(", ")}`, "error");
				return;
			}
			runDir = matches[0];
		}
		if (!runDir) {
			ctx.ui.notify(target ? `No async subagent run found for '${target}'.` : "No async subagent runs found.", "error");
			return;
		}
		const shown = showPane(ctx, runDir);
		const hint = shown ? paneVisibilityHint() : undefined;
		ctx.ui.notify(shown ? `Subagent pane shown for ${path.basename(runDir)}.${hint ? ` ${hint}` : ""}` : "Subagent pane requires the interactive TUI.", hint ? "warning" : "info");
	}

	pi.on("session_shutdown", () => {
		hidePane();
	});

	pi.registerCommand("subattach", {
		description: "Attach to a subagent run session by async run id/prefix",
		handler: async (args, ctx) => {
			const idOrPrefix = args.trim();
			if (!idOrPrefix) {
				ctx.ui.notify("Usage: /subattach <asyncRunIdOrPrefix>", "error");
				return;
			}

			const matches = findRunDirs(idOrPrefix);
			if (matches.length === 0) {
				ctx.ui.notify(`No async run found for '${idOrPrefix}'.`, "error");
				return;
			}
			if (matches.length > 1) {
				const options = matches.map((dir) => `${path.basename(dir)} (${dir})`);
				ctx.ui.notify(
					`Ambiguous id '${idOrPrefix}'. Be more specific. Matches: ${options.join(", ")}`,
					"error",
				);
				return;
			}

			const runDir = matches[0]!;
			const sessionFile = readRunSessionFile(runDir);
			if (!sessionFile) {
				ctx.ui.notify(`Run ${path.basename(runDir)} has no sessionFile in status.json yet.`, "error");
				return;
			}
			if (!fs.existsSync(sessionFile)) {
				ctx.ui.notify(`Session file not found: ${sessionFile}`, "error");
				return;
			}

			const current = ctx.sessionManager.getSessionFile();
			lastParentSessionFile = current ?? null;
			await ctx.switchSession(sessionFile);
		},
	});

	pi.registerCommand("subattach-latest", {
		description: "Attach to the most recently updated async subagent run session",
		handler: async (_args, ctx) => {
			const runDir = findLatestRunDir();
			if (!runDir) {
				ctx.ui.notify("No async runs found.", "error");
				return;
			}
			const sessionFile = readRunSessionFile(runDir);
			if (!sessionFile) {
				ctx.ui.notify(`Latest run ${path.basename(runDir)} has no sessionFile in status.json yet.`, "error");
				return;
			}
			if (!fs.existsSync(sessionFile)) {
				ctx.ui.notify(`Session file not found: ${sessionFile}`, "error");
				return;
			}
			const current = ctx.sessionManager.getSessionFile();
			lastParentSessionFile = current ?? null;
			await ctx.switchSession(sessionFile);
		},
	});

	pi.registerCommand("subback", {
		description: "Switch back to the previous session saved by /subattach",
		handler: async (_args, ctx) => {
			if (!lastParentSessionFile) {
				ctx.ui.notify("No previous session recorded. Use /subattach first.", "error");
				return;
			}
			if (!fs.existsSync(lastParentSessionFile)) {
				ctx.ui.notify(`Previous session file no longer exists: ${lastParentSessionFile}`, "error");
				return;
			}
			await ctx.switchSession(lastParentSessionFile);
		},
	});

	pi.registerCommand("subpane", {
		description: "Show a top-right live pane for async subagent runs",
		handler: handleSubpane,
	});

	pi.registerCommand("subagent-pane", {
		description: "Alias for /subpane",
		handler: handleSubpane,
	});
}
