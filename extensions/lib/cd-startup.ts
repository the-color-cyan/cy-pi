import { resolve } from "node:path";

export type StartupCwdRequest = {
	requester: string;
	targetCwd: string;
};

export type StartupCwdResolution =
	| { kind: "none" }
	| { kind: "migrate"; targetCwd: string; requests: StartupCwdRequest[] }
	| { kind: "conflict"; targets: string[]; requests: StartupCwdRequest[] };

export class StartupCwdCoordinator {
	private phase: "collecting" | "consumed" | "closed" = "collecting";
	private readonly requests: StartupCwdRequest[] = [];

	request(requester: string, targetCwd: string): void {
		if (this.phase !== "collecting") {
			throw new Error("Startup cwd requests are closed");
		}
		const normalized = resolve(targetCwd);
		this.requests.push({ requester, targetCwd: normalized });
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
