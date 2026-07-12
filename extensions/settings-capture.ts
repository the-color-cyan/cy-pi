import { constants } from "node:fs";
import {
	access,
	chmod,
	mkdtemp,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type JsonObject = Record<string, unknown>;

export type SettingsCaptureSummary = {
	added: number;
	changed: number;
	removed: number;
	unchanged: number;
};

export type SettingsCaptureResult =
	| { status: "captured"; summary: SettingsCaptureSummary }
	| { status: "cancelled"; summary?: SettingsCaptureSummary }
	| { status: "no-ui" };

type CaptureOptions = {
	agentHome: string;
	hasUI: boolean;
	confirm: (title: string, message: string) => Promise<boolean>;
};

function isJsonObject(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readJsonObject(
	path: string,
	label: string,
): Promise<JsonObject> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Cannot read valid JSON from ${label} (${path}): ${String(error)}`,
		);
	}
	if (!isJsonObject(parsed)) {
		throw new Error(`${label} must contain a JSON object: ${path}`);
	}
	return parsed;
}

export function summarizeSettingsReplacement(
	local: JsonObject,
	managed: JsonObject,
): SettingsCaptureSummary {
	const summary: SettingsCaptureSummary = {
		added: 0,
		changed: 0,
		removed: 0,
		unchanged: 0,
	};
	for (const key of Object.keys(local)) {
		if (!(key in managed)) summary.added += 1;
		else if (isDeepStrictEqual(local[key], managed[key]))
			summary.unchanged += 1;
		else summary.changed += 1;
	}
	for (const key of Object.keys(managed)) {
		if (!(key in local)) summary.removed += 1;
	}
	return summary;
}

function dematerializeAgentHome(value: unknown, agentHome: string): unknown {
	if (Array.isArray(value)) {
		return value.map((child) => dematerializeAgentHome(child, agentHome));
	}
	if (isJsonObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [
				key,
				dematerializeAgentHome(child, agentHome),
			]),
		);
	}
	if (typeof value === "string") {
		if (value === agentHome) return "$PI_CODING_AGENT_DIR";
		if (value.startsWith(`${agentHome}${sep}`)) {
			return `$PI_CODING_AGENT_DIR${value.slice(agentHome.length)}`;
		}
	}
	return value;
}

function formatSummary(summary: SettingsCaptureSummary): string {
	return [
		"Replace settings.managed.json with the complete local settings.json snapshot?",
		"",
		`Top-level keys: ${summary.added} added, ${summary.changed} changed, ${summary.removed} removed, ${summary.unchanged} unchanged.`,
		"This promotes every current local setting into the tracked canonical file.",
	].join("\n");
}

export async function atomicWriteSettingsFile(
	path: string,
	content: string,
): Promise<void> {
	const parent = dirname(path);
	const temporaryDirectory = await mkdtemp(join(parent, ".settings-capture-"));
	const temporaryPath = join(temporaryDirectory, "settings.managed.json");
	try {
		let mode = 0o644;
		try {
			mode = (await stat(path)).mode & 0o777;
		} catch {
			// Use normal tracked-file permissions when the managed file is new.
		}
		await writeFile(temporaryPath, content, { encoding: "utf8", mode });
		await chmod(temporaryPath, mode);
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

export async function captureLocalSettings(
	options: CaptureOptions,
): Promise<SettingsCaptureResult> {
	if (!options.hasUI) return { status: "no-ui" };

	const localPath = join(options.agentHome, "settings.json");
	const managedPath = join(options.agentHome, "settings.managed.json");
	await access(localPath, constants.R_OK);
	const localBefore = await readFile(localPath, "utf8");
	const managedBefore = await readFile(managedPath, "utf8");
	const local = dematerializeAgentHome(
		await readJsonObject(localPath, "local settings"),
		options.agentHome,
	) as JsonObject;
	const managed = await readJsonObject(managedPath, "managed settings");
	const summary = summarizeSettingsReplacement(local, managed);

	if (
		!(await options.confirm(
			"Capture local Pi settings",
			formatSummary(summary),
		))
	) {
		return { status: "cancelled", summary };
	}

	if (
		(await readFile(localPath, "utf8")) !== localBefore ||
		(await readFile(managedPath, "utf8")) !== managedBefore
	) {
		throw new Error(
			"Settings changed while confirmation was open; review and retry capture",
		);
	}

	const rendered = `${JSON.stringify(local, null, 2)}\n`;
	await atomicWriteSettingsFile(managedPath, rendered);
	return { status: "captured", summary };
}

function agentHome(): string {
	return (
		process.env.PI_CODING_AGENT_DIR ??
		join(dirname(fileURLToPath(import.meta.url)), "..")
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("capture", {
		description:
			"Replace managed settings with the current local settings snapshot",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			try {
				const result = await captureLocalSettings({
					agentHome: agentHome(),
					hasUI: ctx.hasUI,
					confirm: (title, message) => ctx.ui.confirm(title, message),
				});
				if (result.status === "captured") {
					ctx.ui.notify(
						"Captured settings.json into settings.managed.json",
						"info",
					);
				} else if (result.status === "cancelled") {
					ctx.ui.notify("Settings capture cancelled", "info");
				}
			} catch (error) {
				ctx.ui.notify(`Settings capture failed: ${String(error)}`, "error");
			}
		},
	});
}
