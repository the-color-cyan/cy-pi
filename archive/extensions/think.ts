import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

const ALIASES: Record<string, ThinkingLevel> = {
	"0": "off",
	none: "off",
	off: "off",
	"1": "minimal",
	min: "minimal",
	minimal: "minimal",
	"2": "low",
	lo: "low",
	low: "low",
	"3": "medium",
	med: "medium",
	medium: "medium",
	"4": "high",
	hi: "high",
	high: "high",
	"5": "xhigh",
	extra: "xhigh",
	max: "xhigh",
	x: "xhigh",
	xhigh: "xhigh",
};

function usage(current: ThinkingLevel): string {
	return `Current thinking: ${current}. Usage: /think <off|minimal|low|medium|high|xhigh> (aliases: 0-5, min, med, max).`;
}

function normalizeLevel(args: string): ThinkingLevel | undefined {
	const key = args.trim().toLowerCase();
	if (!key) return undefined;
	return ALIASES[key];
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("think", {
		description: "Set thinking level quickly: off, minimal, low, medium, high, xhigh",
		getArgumentCompletions: (prefix: string) => {
			const normalizedPrefix = prefix.trim().toLowerCase();
			const items = LEVELS.map((level) => ({ value: level, label: level }));
			const filtered = normalizedPrefix
				? items.filter((item) => item.value.startsWith(normalizedPrefix))
				: items;
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const current = pi.getThinkingLevel() as ThinkingLevel;
			const trimmedArgs = args.trim();
			const requested = normalizeLevel(trimmedArgs);

			if (!requested) {
				ctx.ui.notify(usage(current), trimmedArgs ? "error" : "info");
				return;
			}

			pi.setThinkingLevel(requested);
			const actual = pi.getThinkingLevel() as ThinkingLevel;
			if (actual !== requested) {
				ctx.ui.notify(
					`Requested thinking ${requested}, but current model uses ${actual}.`,
					"info",
				);
				return;
			}

			ctx.ui.notify(`Thinking level set to ${actual}.`, "info");
		},
	});
}
