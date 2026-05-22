import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type AgentHomeStatus = {
	status: string;
	branch?: string;
	upstream?: string;
	behind?: string;
	ahead?: string;
	reason?: string;
};

function parseAgentHomeStatus(output: string): AgentHomeStatus {
	const status: AgentHomeStatus = { status: "unknown" };
	for (const raw of output.split("\n")) {
		const line = raw.trim();
		const eq = line.indexOf("=");
		if (eq < 0) continue;

		const key = line.slice(0, eq);
		const value = line.slice(eq + 1);
		switch (key) {
			case "status":
				status.status = value;
				break;
			case "branch":
				status.branch = value;
				break;
			case "upstream":
				status.upstream = value;
				break;
			case "behind":
				status.behind = value;
				break;
			case "ahead":
				status.ahead = value;
				break;
			case "reason":
				status.reason = value;
				break;
		}
	}
	return status;
}

function commitMessage(count: number): string {
	return count === 1 ? "1 commit" : `${count} commits`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (event, ctx) => {
		if (event.reason !== "startup" || !ctx.hasUI) return;
		const repoRoot = process.env.PI_CODING_AGENT_DIR;
		if (!repoRoot) return;

		const checkScript = join(repoRoot, "scripts", "update-agent-home.sh");
		if (!existsSync(checkScript)) return;

		void (async () => {
			let result: { code: number; stdout: string; stderr: string };
			try {
				result = await pi.exec("bash", [checkScript, "--check", "--machine"], {
					cwd: repoRoot,
					timeout: 20_000,
				});
			} catch {
				return;
			}

			if (result.code !== 0) return;
			const parsed = parseAgentHomeStatus(result.stdout || "");
			const behind = Number(parsed.behind || 0);
			const ahead = Number(parsed.ahead || 0);

			if (parsed.status === "behind" && Number.isFinite(behind) && behind > 0) {
				const source = parsed.upstream || parsed.branch || "origin";
				ctx.ui.notify(
					`Agent home has ${commitMessage(behind)} available on ${source}. Run "pi update" to pull the latest agent-home changes.`,
					"warning",
				);
				return;
			}

			if (
				parsed.status === "diverged" &&
				Number.isFinite(behind) &&
				Number.isFinite(ahead) &&
				(behind > 0 || ahead > 0)
			) {
				ctx.ui.notify(
					`Agent home has diverged from its tracked branch (${ahead} local, ${behind} remote). Consider resolving the divergence before running pi update.`,
					"warning",
				);
			}
		})();
	});
}
