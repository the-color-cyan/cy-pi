import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EVANESCENT_SCHEMA_VERSION = 1;
export const METADATA_FILE = "evanescent-run.json";
export const ACTIVE_MARKER_FILE = ".active";

export type EvanescentMetadata = {
	schemaVersion: number;
	id: string;
	createdAt: string;
	workspacePath: string;
	materialized: boolean;
	materializedPath: string | null;
	pid: number;
};

export type EvanescentRun = {
	root: string;
	workspace: string;
	metadata: EvanescentMetadata;
};

export function defaultTempRoot(): string {
	return join(tmpdir(), "pi-evanescent");
}

export function resolveCradlePath(input?: string, home = homedir()): string {
	if (!input || input.trim() === "") return join(home, "cradle");
	if (input === "~") return home;
	if (input.startsWith("~/")) return join(home, input.slice(2));
	return resolve(input);
}

export async function createEvanescentRun(
	options: { tempRoot?: string; now?: Date; pid?: number; id?: string } = {},
): Promise<EvanescentRun> {
	const id =
		options.id ??
		`${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
	const root = join(options.tempRoot ?? defaultTempRoot(), id);
	const workspace = join(root, "workspace");
	await mkdir(workspace, { recursive: true });
	await writeFile(
		join(root, ACTIVE_MARKER_FILE),
		String(options.pid ?? process.pid),
		"utf8",
	);
	const metadata: EvanescentMetadata = {
		schemaVersion: EVANESCENT_SCHEMA_VERSION,
		id,
		createdAt: (options.now ?? new Date()).toISOString(),
		workspacePath: workspace,
		materialized: false,
		materializedPath: null,
		pid: options.pid ?? process.pid,
	};
	await writeMetadata(root, metadata);
	return { root, workspace, metadata };
}

export async function readMetadata(root: string): Promise<EvanescentMetadata> {
	return JSON.parse(
		await readFile(join(root, METADATA_FILE), "utf8"),
	) as EvanescentMetadata;
}

export async function writeMetadata(
	root: string,
	metadata: EvanescentMetadata,
): Promise<void> {
	await writeFile(
		join(root, METADATA_FILE),
		`${JSON.stringify(metadata, null, 2)}\n`,
		"utf8",
	);
}

export function isPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export type CleanupPolicy = {
	maxAgeMs?: number;
	maxRetainedRuns?: number;
	now?: Date;
	currentRunRoot?: string;
	isPidAlive?: (pid: number) => boolean;
};

async function listRuns(tempRoot: string): Promise<EvanescentRun[]> {
	if (!existsSync(tempRoot)) return [];
	const names = await readdir(tempRoot);
	const runs: EvanescentRun[] = [];
	for (const name of names) {
		const root = join(tempRoot, name);
		try {
			if (!(await stat(root)).isDirectory()) continue;
			const metadata = await readMetadata(root);
			runs.push({ root, workspace: metadata.workspacePath, metadata });
		} catch {
			// Ignore non-run directories.
		}
	}
	return runs;
}

export async function planEvanescentCleanup(
	tempRoot: string,
	policy: CleanupPolicy,
): Promise<EvanescentRun[]> {
	const now = policy.now ?? new Date();
	const alive = policy.isPidAlive ?? isPidAlive;
	const current = policy.currentRunRoot
		? resolve(policy.currentRunRoot)
		: undefined;
	const runs = await listRuns(tempRoot);
	const eligible: EvanescentRun[] = [];
	for (const run of runs) {
		if (current && resolve(run.root) === current) continue;
		if (run.metadata.materialized) continue;
		if (alive(run.metadata.pid)) continue;
		if (existsSync(join(run.root, ACTIVE_MARKER_FILE))) continue;
		eligible.push(run);
	}

	const selected = new Map<string, EvanescentRun>();
	if (policy.maxAgeMs !== undefined) {
		for (const run of eligible) {
			if (
				now.getTime() - new Date(run.metadata.createdAt).getTime() >
				policy.maxAgeMs
			)
				selected.set(run.root, run);
		}
	}
	if (policy.maxRetainedRuns !== undefined) {
		const newestFirst = [...eligible].sort(
			(a, b) =>
				new Date(b.metadata.createdAt).getTime() -
				new Date(a.metadata.createdAt).getTime(),
		);
		for (const run of newestFirst.slice(policy.maxRetainedRuns))
			selected.set(run.root, run);
	}
	return [...selected.values()].sort((a, b) => a.root.localeCompare(b.root));
}

export async function cleanupEvanescentRuns(
	tempRoot: string,
	policy: CleanupPolicy,
): Promise<string[]> {
	const candidates = await planEvanescentCleanup(tempRoot, policy);
	for (const run of candidates)
		await rm(run.root, { recursive: true, force: true });
	return candidates.map((run) => run.root);
}

export async function materializeRun(
	runRoot: string,
	cradlePath: string,
	name?: string,
): Promise<{
	destinationRoot: string;
	workspacePath: string;
	metadata: EvanescentMetadata;
}> {
	const metadata = await readMetadata(runRoot);
	const destinationName = name?.trim() || metadata.id;
	if (!/^[A-Za-z0-9._-]+$/.test(destinationName))
		throw new Error(`Invalid materialization name: ${destinationName}`);
	const cradle = resolveCradlePath(cradlePath);
	await mkdir(cradle, { recursive: true });
	const destinationRoot = join(cradle, destinationName);
	if (existsSync(destinationRoot))
		throw new Error(
			`Materialization destination already exists: ${destinationRoot}`,
		);
	await rm(join(runRoot, ACTIVE_MARKER_FILE), { force: true });
	await rename(runRoot, destinationRoot);
	const workspacePath = join(destinationRoot, "workspace");
	const updated: EvanescentMetadata = {
		...metadata,
		workspacePath,
		materialized: true,
		materializedPath: destinationRoot,
	};
	await writeMetadata(destinationRoot, updated);
	return { destinationRoot, workspacePath, metadata: updated };
}
