/**
 * cavepony — combined mode control for the caveman + ponytail skills.
 *
 * Commands:
 *   /caveman [off|lite|full|ultra|stop]   Toggle or set caveman level
 *   /ponytail [off|lite|full|ultra|stop]  Toggle or set ponytail level
 *
 * Config lives in settings.json under the "cavepony" key (canonical source:
 * settings.managed.json), e.g.:
 *   "cavepony": {
 *     "caveman":  { "default": "full", "status": true },
 *     "ponytail": { "default": "full", "status": true }
 *   }
 *
 * `default` is the level applied to new sessions; `status` toggles that
 * mode's half of the combined "cave:x pony:y" status indicator.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Levels + config
// ---------------------------------------------------------------------------

const LEVELS = ["off", "lite", "full", "ultra"] as const;
type Level = (typeof LEVELS)[number];
type ModeName = "caveman" | "ponytail";

interface ModeConfig {
	default: Level;
	status: boolean;
}

interface CaveponyConfig {
	caveman: ModeConfig;
	ponytail: ModeConfig;
}

const DEFAULT_CONFIG: CaveponyConfig = {
	caveman: { default: "full", status: true },
	ponytail: { default: "full", status: true },
};

function normalizeLevel(value: unknown): Level | null {
	return typeof value === "string" &&
		(LEVELS as readonly string[]).includes(value)
		? (value as Level)
		: null;
}

export function parseCaveponyConfig(raw: unknown): CaveponyConfig {
	const parseMode = (value: unknown, fallback: ModeConfig): ModeConfig => {
		const obj = (value ?? {}) as Record<string, unknown>;
		return {
			default: normalizeLevel(obj.default) ?? fallback.default,
			status: typeof obj.status === "boolean" ? obj.status : fallback.status,
		};
	};
	const root = (raw ?? {}) as Record<string, unknown>;
	return {
		caveman: parseMode(root.caveman, DEFAULT_CONFIG.caveman),
		ponytail: parseMode(root.ponytail, DEFAULT_CONFIG.ponytail),
	};
}

export function loadCaveponyConfig(settingsPath: string): CaveponyConfig {
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<
			string,
			unknown
		>;
		return parseCaveponyConfig(settings.cavepony);
	} catch {
		return parseCaveponyConfig(undefined);
	}
}

// ---------------------------------------------------------------------------
// Command parsing
// ---------------------------------------------------------------------------

export type ModeCommand =
	| { type: "set"; level: Level }
	| { type: "toggle" }
	| { type: "invalid" };

export function parseModeCommand(args: string | undefined): ModeCommand {
	const arg = (args ?? "").trim().toLowerCase();
	if (!arg) return { type: "toggle" };
	if (arg === "stop" || arg === "quit") return { type: "set", level: "off" };
	const level = normalizeLevel(arg);
	return level ? { type: "set", level } : { type: "invalid" };
}

// ---------------------------------------------------------------------------
// Ponytail skill body, filtered to the active level (drops other levels'
// intensity-table rows and worked examples; plain rules stay verbatim)
// ---------------------------------------------------------------------------

export function filterSkillBodyForMode(body: string, mode: Level): string {
	const effective: Level = mode === "off" ? "full" : mode;
	const withoutFrontmatter = String(body).replace(/^---[\s\S]*?---\s*/, "");
	return withoutFrontmatter
		.split(/\r?\n/)
		.filter((line) => {
			const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
			if (tableLabel) {
				const labelMode = normalizeLevel(tableLabel[1]!.trim());
				if (labelMode) return labelMode === effective;
			}
			const exampleLabel = line.match(/^-\s*([^:]+):\s*/);
			if (exampleLabel) {
				const labelMode = normalizeLevel(exampleLabel[1]!.trim());
				if (labelMode) return labelMode === effective;
			}
			return true;
		})
		.join("\n");
}

const PONYTAIL_SKILL_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"skills",
	"productivity",
	"ponytail",
	"SKILL.md",
);

// ---------------------------------------------------------------------------
// Caveman prompt fragments
// ---------------------------------------------------------------------------

const CAVE_BASE = `\
IMPORTANT: You are in CAVEMAN MODE. Respond terse like smart caveman. \
All technical substance stay. Only fluff die.

Rules:
- Drop articles (a/an/the), filler (just/really/basically/actually/simply), \
pleasantries, hedging
- Fragments OK. Short synonyms preferred. Technical terms exact
- Code blocks unchanged. Errors quoted exact
- Pattern: [thing] [action] [reason]. [next step].

Bad: "Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by..."
Good: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"`;

const CAVE_INTENSITY: Record<Exclude<Level, "off">, string> = {
	lite: `\
No filler/hedging. Keep articles + full sentences. Professional but tight.
Example: "Your component re-renders because you create a new object reference each render. Wrap it in \`useMemo\`."`,

	full: `\
Drop articles, fragments OK, short synonyms.
Example: "New object ref each render. Inline object prop = new ref = re-render. Wrap in \`useMemo\`."`,

	ultra: `\
Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y).
Example: "Inline obj prop → new ref → re-render. \`useMemo\`."`,
};

const CAVE_SAFETY = `\
Auto-clarity: drop caveman for security warnings, irreversible action confirmations, \
or when user is confused. Resume after.
Boundaries: write normal code. Only compress explanations. "stop caveman" or "normal mode" reverts.`;

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

/** Matches the custom entry types written by the standalone extensions. */
const ENTRY_KEYS: Record<ModeName, { customType: string; dataKey: string }> = {
	caveman: { customType: "caveman-level", dataKey: "level" },
	ponytail: { customType: "ponytail-mode", dataKey: "mode" },
};

export default function cavepony(pi: ExtensionAPI) {
	const agentHome =
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	let config = loadCaveponyConfig(join(agentHome, "settings.json"));
	const level: Record<ModeName, Level> = {
		caveman: config.caveman.default,
		ponytail: config.ponytail.default,
	};
	let lastCtx: ExtensionContext | null = null;
	let ponytailSkillBody: string | null = null;

	function syncStatus(ctx?: Pick<ExtensionContext, "ui">) {
		const c = (ctx as ExtensionContext | undefined) ?? lastCtx;
		if (!c?.ui) return;
		lastCtx = c;
		const theme = c.ui.theme;
		const parts: string[] = [];
		for (const name of ["caveman", "ponytail"] as const) {
			if (level[name] === "off" || !config[name].status) continue;
			const short = name === "caveman" ? "cave" : "pony";
			parts.push(
				theme.fg("muted", `${short}:`) + theme.fg("text", level[name]),
			);
		}
		c.ui.setStatus("cavepony", parts.join("  "));
	}

	function setLevel(name: ModeName, next: Level, ctx?: ExtensionContext) {
		level[name] = next;
		const { customType, dataKey } = ENTRY_KEYS[name];
		pi.appendEntry(customType, { [dataKey]: next });
		syncStatus(ctx);
		ctx?.ui.notify(
			next === "off" ? `${name} off.` : `${name}: ${next}`,
			"info",
		);
	}

	function restoreLevel(entries: unknown[], name: ModeName): Level | null {
		const { customType, dataKey } = ENTRY_KEYS[name];
		let found: Level | null = null;
		for (const entry of entries) {
			const e = entry as {
				type?: string;
				customType?: string;
				data?: Record<string, unknown>;
			};
			if (e?.type === "custom" && e?.customType === customType) {
				const restored = normalizeLevel(e?.data?.[dataKey]);
				if (restored) found = restored;
			}
		}
		return found;
	}

	function ponytailInstructions(): string {
		if (ponytailSkillBody === null) {
			try {
				ponytailSkillBody = readFileSync(PONYTAIL_SKILL_PATH, "utf8");
			} catch {
				ponytailSkillBody = "";
			}
		}
		const body = ponytailSkillBody
			? filterSkillBodyForMode(ponytailSkillBody, level.ponytail)
			: "Behavior defined by the ponytail skill.";
		return `PONYTAIL MODE ACTIVE — level: ${level.ponytail}\n\n${body}`;
	}

	// -- Session lifecycle (no startup notifications by design) --

	pi.on("session_start", async (_event, ctx) => {
		config = loadCaveponyConfig(join(agentHome, "settings.json"));
		const entries = ctx.sessionManager.getEntries() as unknown[];
		for (const name of ["caveman", "ponytail"] as const) {
			level[name] = restoreLevel(entries, name) ?? config[name].default;
		}
		syncStatus(ctx);
	});

	pi.on("session_shutdown", async () => {
		lastCtx = null;
	});

	// -- Deactivation phrases typed as plain messages --

	pi.on("input", async (event, ctx) => {
		if (event?.source === "extension") return;
		const text = String(event?.text ?? "")
			.trim()
			.toLowerCase()
			.replace(/[.!?\s]+$/, "");
		if (text === "stop caveman" || text === "normal mode")
			setLevel("caveman", "off", ctx);
		if (text === "stop ponytail" || text === "normal mode")
			setLevel("ponytail", "off", ctx);
	});

	// -- Commands --

	for (const name of ["caveman", "ponytail"] as const) {
		pi.registerCommand(name, {
			description: `Toggle ${name} mode or set level (off|lite|full|ultra|stop)`,
			getArgumentCompletions: (prefix: string) => {
				const normalized = prefix.trim().toLowerCase();
				const items = [...LEVELS, "stop"]
					.filter((value) => value.startsWith(normalized))
					.map((value) => ({ value, label: value }));
				return items.length > 0 ? items : null;
			},
			handler: async (args, ctx) => {
				const command = parseModeCommand(args);
				if (command.type === "invalid") {
					ctx.ui.notify(
						`Unknown: "${args}". Use: ${LEVELS.join(", ")}, stop`,
						"error",
					);
					return;
				}
				const fallback =
					config[name].default === "off" ? "full" : config[name].default;
				const next =
					command.type === "toggle"
						? level[name] === "off"
							? fallback
							: "off"
						: command.level;
				setLevel(name, next, ctx);
			},
		});
	}

	// -- Prompt injection --

	pi.on("before_agent_start", async (event) => {
		let systemPrompt = event.systemPrompt;
		if (level.caveman !== "off") {
			systemPrompt += `\n\n${CAVE_BASE}\n\n${CAVE_INTENSITY[level.caveman]}\n\n${CAVE_SAFETY}`;
		}
		if (level.ponytail !== "off") {
			systemPrompt += `\n\n${ponytailInstructions()}`;
		}
		if (systemPrompt === event.systemPrompt) return;
		return { systemPrompt };
	});
}
