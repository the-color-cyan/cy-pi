import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

const FRAME_INTERVAL_MS = 120;
const BOOT_FRAMES = 8;
const SHIMMER_FRAMES = 12;
const MAX_ANIMATED_FRAMES = BOOT_FRAMES + SHIMMER_FRAMES;

const BOOT_LINES = ["$ init context", "$ mount tools", "$ open tui"];
const FIXED_HEADER_HEIGHT = 2 + BOOT_LINES.length;
const SPINNER = ["-", "∙", "•", "∙"];
const DEFAULT_HEADER_LINES = ["   π", "───────", "  p i"];
const CONFIG_PATH = join(
	process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
	"config",
	"ascii-header.json",
);
const HEADER_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"ascii-header.txt",
);

type Config = { animationsEnabled?: boolean };

export function loadHeaderLines(path = HEADER_PATH): string[] {
	try {
		const lines = readFileSync(path, "utf8")
			.replace(/\r\n?/g, "\n")
			.replace(/\n$/, "")
			.split("\n");
		return lines.length === DEFAULT_HEADER_LINES.length
			? lines
			: DEFAULT_HEADER_LINES;
	} catch {
		return DEFAULT_HEADER_LINES;
	}
}

const HEADER_LINES = loadHeaderLines();

function loadAnimationsEnabled(): boolean {
	try {
		if (!existsSync(CONFIG_PATH)) return true;
		const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
		return config.animationsEnabled !== false;
	} catch {
		return true;
	}
}

function saveAnimationsEnabled(enabled: boolean): void {
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(
		CONFIG_PATH,
		`${JSON.stringify({ animationsEnabled: enabled }, null, 2)}\n`,
		"utf8",
	);
}

class StartupHeader implements Component {
	private frame = 0;
	private readonly timer?: NodeJS.Timeout;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly animate: boolean,
	) {
		if (!this.animate) return;

		this.timer = setInterval(() => {
			this.frame += 1;
			this.tui.requestRender();

			if (this.frame >= MAX_ANIMATED_FRAMES) {
				clearInterval(this.timer);
			}
		}, FRAME_INTERVAL_MS);
	}

	render(width: number): string[] {
		const lines = !this.animate
			? this.renderSigil()
			: this.frame >= BOOT_FRAMES
				? this.renderSigil(this.frame - BOOT_FRAMES)
				: this.renderBootSequence();

		return this.fixedHeight(
			lines.map((line) => truncateToWidth(line, width, "")),
			FIXED_HEADER_HEIGHT,
		);
	}

	private renderBootSequence(): string[] {
		const revealedLines = Math.min(
			BOOT_LINES.length,
			Math.floor(this.frame / 3) + 1,
		);
		const spinner = SPINNER[this.frame % SPINNER.length] ?? "·";
		const lines = ["", `  ${this.theme.fg("accent", "[ cy-pi ]")}`];

		for (const [index, line] of BOOT_LINES.entries()) {
			if (index < revealedLines) {
				lines.push(`  ${this.theme.fg("borderAccent", line)}`);
			}
		}

		lines.push(`  ${this.theme.fg("dim", spinner)}`, "");
		return lines;
	}

	private renderSigil(shimmerFrame = SHIMMER_FRAMES): string[] {
		const [sigilText, ruleText, titleText] = HEADER_LINES;
		const sigil = this.shimmer(sigilText!, shimmerFrame, "accent");
		const rule = this.shimmer(ruleText!, shimmerFrame - 2, "borderAccent");
		const title = this.shimmer(titleText!, shimmerFrame - 4, "dim");

		return ["", `  ${sigil}`, `  ${rule}`, `  ${title}`, ""];
	}

	private shimmer(text: string, frame: number, baseColor: ThemeColor): string {
		const shimmerIndex = frame - 1;

		return Array.from(text)
			.map((char, index) => {
				if (index === shimmerIndex) {
					return this.theme.fg("accent", char);
				}

				if (index === shimmerIndex - 1 || index === shimmerIndex + 1) {
					return this.theme.fg("borderAccent", char);
				}

				return this.theme.fg(baseColor, char);
			})
			.join("");
	}

	private fixedHeight(output: string[], height: number): string[] {
		return output
			.slice(0, height)
			.concat(Array(Math.max(0, height - output.length)).fill(""));
	}

	invalidate(): void {
		// Render is computed fresh each time so theme changes need no cache reset.
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
	}
}

export default function (pi: ExtensionAPI) {
	let animationsEnabled = loadAnimationsEnabled();

	pi.registerFlag("ascii-header-static", {
		description:
			"Show the ASCII startup header without boot or shimmer animation",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("ascii-header-animation", {
		description: "Toggle ASCII header boot and shimmer animation",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("ASCII header animation requires the TUI.", "error");
				return;
			}

			animationsEnabled = !animationsEnabled;
			saveAnimationsEnabled(animationsEnabled);
			ctx.ui.setHeader(
				(tui, theme) => new StartupHeader(tui, theme, animationsEnabled),
			);
			ctx.ui.notify(
				`ASCII header animation ${animationsEnabled ? "enabled" : "disabled"}.`,
				"info",
			);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		animationsEnabled = pi.getFlag("ascii-header-static")
			? false
			: loadAnimationsEnabled();
		ctx.ui.setHeader(
			(tui, theme) => new StartupHeader(tui, theme, animationsEnabled),
		);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setHeader(undefined);
	});
}
