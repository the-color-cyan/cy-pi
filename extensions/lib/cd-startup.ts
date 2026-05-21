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

let startupCwdCoordinator = new StartupCwdCoordinator();

export function requestStartupCwd(
	requester: string,
	targetCwd: string,
	options: { requiresFreshSession?: boolean } = {},
): void {
	startupCwdCoordinator.request(requester, targetCwd, options);
}

export function consumeStartupCwdRequests(): StartupCwdResolution {
	return startupCwdCoordinator.consume();
}

export function startupCwdRequestsWereConsumed(): boolean {
	return startupCwdCoordinator.wasConsumed();
}

export function resetStartupCwdRequestsForTests(): void {
	startupCwdCoordinator = new StartupCwdCoordinator();
}
