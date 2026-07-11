import { homedir } from "node:os";
import { Box, Text } from "@earendil-works/pi-tui";
import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CUSTOM_TYPE = "sh-result";
const PREVIEW_LINES = 24;

type ShResultDetails = {
	command: string;
	cwd: string;
	ok: boolean;
	output: string;
	durationMs: number;
};

function usage(cwd: string): string {
	return `Current directory: ${displayPath(cwd)}\nUsage: /sh <command>`;
}

function displayPath(path: string): string {
	const home = homedir();
	if (path === home) return "~";
	if (path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
	return path;
}

function displayCommand(command: string): string {
	const singleLine = command.replace(/\s+/g, " ").trim();
	return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine;
}

function textFromContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return (
				Boolean(part) &&
				typeof part === "object" &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string"
			);
		})
		.map((part) => part.text)
		.join("\n");
}

function previewOutput(output: string, expanded: boolean): string {
	const normalized = output.trimEnd() || "(no output)";
	if (expanded) return normalized;

	const lines = normalized.split("\n");
	if (lines.length <= PREVIEW_LINES) return normalized;

	const skipped = lines.length - PREVIEW_LINES;
	return [
		`... (${skipped} earlier line${skipped === 1 ? "" : "s"}; expand for full output)`,
		...lines.slice(-PREVIEW_LINES),
	].join("\n");
}

function formatDuration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function (pi: ExtensionAPI) {
	pi.registerMessageRenderer(CUSTOM_TYPE, (message, { expanded }, theme) => {
		const details = message.details as ShResultDetails | undefined;
		const command = details?.command ?? "";
		const cwd = details?.cwd ?? "";
		const ok = details?.ok ?? true;
		const output = details?.output ?? "";
		const duration = details?.durationMs ?? 0;

		const status = ok ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const header = `${status} ${theme.fg("toolTitle", theme.bold(`$ ${displayCommand(command)}`))}`;
		const meta = theme.fg(
			"muted",
			`${displayPath(cwd)} · ${formatDuration(duration)} · output hidden from model context`,
		);
		const body = theme.fg("customMessageText", previewOutput(output, expanded));

		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${header}\n${meta}\n\n${body}`, 0, 0));
		return box;
	});

	pi.registerCommand("sh", {
		description: "Run a shell command in pi's current working directory",
		handler: async (args, ctx) => {
			const command = args.trim();
			if (!command) {
				const message = usage(ctx.cwd);
				if (ctx.hasUI) ctx.ui.notify(message, "info");
				else process.stdout.write(`${message}\n`);
				return;
			}

			await ctx.waitForIdle();

			const startedAt = Date.now();
			let ok = true;
			let output = "";

			ctx.ui.setStatus("sh", `$ ${displayCommand(command)}`);
			try {
				const bash = createBashToolDefinition(ctx.cwd);
				const result = await bash.execute(`sh-${startedAt}`, { command }, undefined, undefined, ctx);
				output = textFromContent(result.content);
			} catch (error) {
				ok = false;
				output = error instanceof Error ? error.message : String(error);
			} finally {
				ctx.ui.setStatus("sh", undefined);
			}

			const details: ShResultDetails = {
				command,
				cwd: ctx.cwd,
				ok,
				output,
				durationMs: Date.now() - startedAt,
			};

			if (!ctx.hasUI) {
				const stream = ok ? process.stdout : process.stderr;
				stream.write(output);
				if (!output.endsWith("\n")) stream.write("\n");
			}

			pi.sendMessage({
				customType: CUSTOM_TYPE,
				content: "",
				display: true,
				details,
			});
		},
	});
}
