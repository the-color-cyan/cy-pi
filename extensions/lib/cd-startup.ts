import { resolve } from "node:path";

export type StartupCwdRequest = {
	requester: string;
	targetCwd: string;
	requiresFreshSession?: boolean;
};

export type StartupCwdResolution =
	| { kind: "none" }
	| { kind: "migrate"; targetCwd: string; requests: StartupCwdRequest[] }
	| { kind: "conflict"; targets: string[]; requests: StartupCwdRequest[] };

export class StartupCwdCoordinator {
	private phase: "collecting" | "consumed" = "collecting";
	private readonly requests: StartupCwdRequest[] = [];
	private failureMessage: string | undefined;

	request(
		requester: string,
		targetCwd: string,
		options: { requiresFreshSession?: boolean } = {},
	): void {
		if (this.phase !== "collecting") {
			throw new Error("Startup cwd requests are closed");
		}
		const normalized = resolve(targetCwd);
		this.requests.push({
			requester,
			targetCwd: normalized,
			requiresFreshSession: options.requiresFreshSession,
		});
	}

	wasConsumed(): boolean {
		return this.phase === "consumed";
	}

	fail(message: string): void {
		this.failureMessage = message;
	}

	failure(): string | undefined {
		return this.failureMessage;
	}

	consume(): StartupCwdResolution {
		if (this.phase !== "collecting") {
			throw new Error("Startup cwd requests have already been consumed");
		}
		this.phase = "consumed";
		if (this.requests.length === 0) return { kind: "none" };

		const targets = [
			...new Set(this.requests.map((request) => request.targetCwd)),
		];
		if (targets.length === 1) {
			return {
				kind: "migrate",
				targetCwd: targets[0],
				requests: [...this.requests],
			};
		}

		return {
			kind: "conflict",
			targets,
			requests: [...this.requests],
		};
	}
}

const STARTUP_CWD_COORDINATOR_KEY = Symbol.for("cy-pi.cd-startup-coordinator");

type StartupCwdGlobal = typeof globalThis & {
	[STARTUP_CWD_COORDINATOR_KEY]?: StartupCwdCoordinator;
};

function getStartupCwdCoordinator(): StartupCwdCoordinator {
	const shared = globalThis as StartupCwdGlobal;
	shared[STARTUP_CWD_COORDINATOR_KEY] ??= new StartupCwdCoordinator();
	return shared[STARTUP_CWD_COORDINATOR_KEY];
}

export function requestStartupCwd(
	requester: string,
	targetCwd: string,
	options: { requiresFreshSession?: boolean } = {},
): void {
	getStartupCwdCoordinator().request(requester, targetCwd, options);
}

export function consumeStartupCwdRequests(): StartupCwdResolution {
	return getStartupCwdCoordinator().consume();
}

export function startupCwdRequestsWereConsumed(): boolean {
	return getStartupCwdCoordinator().wasConsumed();
}

export function markStartupCwdMigrationFailed(message: string): void {
	getStartupCwdCoordinator().fail(message);
}

export function getStartupCwdMigrationFailure(): string | undefined {
	return getStartupCwdCoordinator().failure();
}

export function resetStartupCwdRequestsForTests(): void {
	(globalThis as StartupCwdGlobal)[STARTUP_CWD_COORDINATOR_KEY] =
		new StartupCwdCoordinator();
}
