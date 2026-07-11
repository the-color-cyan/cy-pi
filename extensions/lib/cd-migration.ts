import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	SessionEntry,
	SessionHeader,
} from "@earendil-works/pi-coding-agent";

export const CURRENT_SESSION_VERSION = 3;

export type MigrationSessionManager = {
	getSessionFile(): string | undefined;
	getEntries(): SessionEntry[];
};

export type CreateMigratedSessionOptions = {
	sessionManager: MigrationSessionManager;
	targetCwd: string;
	agentDir?: string;
	now?: Date;
	id?: string;
};

export function defaultSessionDir(cwd: string, agentDir?: string): string {
	const root =
		agentDir ??
		process.env.PI_CODING_AGENT_DIR ??
		join(homedir(), ".pi", "agent");
	const safePath = `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(root, "sessions", safePath);
}

export function createMigratedSessionFile({
	sessionManager,
	targetCwd,
	agentDir,
	now = new Date(),
	id = randomUUID(),
}: CreateMigratedSessionOptions): string {
	const timestamp = now.toISOString();
	const sessionDir = defaultSessionDir(targetCwd, agentDir);
	mkdirSync(sessionDir, { recursive: true });

	const sessionFile = join(
		sessionDir,
		`${timestamp.replace(/[:.]/g, "-")}_${id}.jsonl`,
	);
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id,
		timestamp,
		cwd: targetCwd,
		parentSession: sessionManager.getSessionFile(),
	};

	const lines = [header, ...sessionManager.getEntries()].map((entry) =>
		JSON.stringify(entry),
	);
	writeFileSync(sessionFile, `${lines.join("\n")}\n`, "utf8");
	return sessionFile;
}

export async function isFreshStartupSessionFile(
	sessionFile: string,
): Promise<boolean> {
	const content = await readFile(sessionFile, "utf8");
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length !== 1) return false;
	try {
		const header = JSON.parse(lines[0]) as { type?: string };
		return header.type === "session";
	} catch {
		return false;
	}
}

export async function removeFreshStartupSessionArtifact(
	sessionFile: string,
): Promise<boolean> {
	if (!existsSync(sessionFile)) return false;
	if (!(await isFreshStartupSessionFile(sessionFile))) return false;
	unlinkSync(sessionFile);
	return true;
}
