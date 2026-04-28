import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

let activeCwd = process.cwd();

const DEFAULT_TIMEOUT_MS = 30_000;
const CLEAN_WORKTREE_TEXT = "Working tree: clean";

type BranchKind = "local" | "remote";

type ParsedBranchArg = {
	branchName: string;
	force: boolean;
};

type BranchCatalog = {
	localBranches: string[];
	remoteBranches: string[];
};

async function git(pi: ExtensionAPI, cwd: string, args: string[]) {
	const result = await pi.exec("git", args, { cwd, timeout: DEFAULT_TIMEOUT_MS });
	if (result.code !== 0) {
		throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
	}
	return result.stdout.trimEnd();
}

async function getBranchCatalog(pi: ExtensionAPI, cwd: string): Promise<BranchCatalog> {
	const [localRaw, remoteRaw] = await Promise.all([
		git(pi, cwd, ["branch", "--format=%(refname:short)"],),
		git(pi, cwd, ["branch", "--remotes", "--format=%(refname:short)"],),
	]);

	const localBranches = localRaw
		.split("\n")
		.map((name) => name.trim())
		.filter((name) => name.length > 0 && name !== "HEAD");
	const remoteBranches = remoteRaw
		.split("\n")
		.map((name) => name.trim())
		.filter((name) => name.length > 0 && !name.endsWith("/HEAD"));

	return { localBranches, remoteBranches };
}

function currentBranchStatus(workingTreeStatus: string): string {
	const statusLines = workingTreeStatus
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (!statusLines.length) {
		return CLEAN_WORKTREE_TEXT;
	}
	return `Working tree: dirty\n${statusLines.join("\n")}`;
}

function branchInfo(cwd: string, branchName: string): string {
	return `Current directory: ${cwd}\nCurrent branch: ${branchName || "(detached)"}`;
}

function usage(branchName: string): string {
	return [
		`Current branch: ${branchName || "(detached)"}`,
		`Usage: /branch <branch> [--force]`,
		"When no branch is provided in an interactive UI, choose from local/remote branches.",
		"Use --force to skip dirty-tree confirmation.",
	].join("\n");
}

function parseArgs(args: string): ParsedBranchArg | undefined {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return undefined;

	let force = false;
	const branchTokens: string[] = [];

	for (const token of tokens) {
		if (token === "--force" || token === "-f" || token === "--yes" || token === "-y") {
			force = true;
			continue;
		}
		if (token.startsWith("-") && token !== "--") {
			continue;
		}
		branchTokens.push(token);
	}

	if (branchTokens.length === 0) return force ? { branchName: "", force } : undefined;
	if (branchTokens.length > 1) {
		throw new Error("Provide only one branch argument.");
	}

	return { branchName: branchTokens[0]!, force };
}

function parseBranchKind(branch: string, catalog: BranchCatalog): BranchKind | undefined {
	if (catalog.localBranches.includes(branch)) return "local";
	if (catalog.remoteBranches.includes(branch)) return "remote";
	return undefined;
}

function localFromRemote(ref: string): string {
	const slashIndex = ref.indexOf("/");
	return slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref;
}

async function showCurrentStatus(pi: ExtensionAPI, cwd: string): Promise<{ branch: string; status: string }> {
	const [branchResult, statusResult] = await Promise.all([
		git(pi, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
		git(pi, cwd, ["status", "--short"]),
	]);
	return {
		branch: branchResult || "(detached)",
		status: currentBranchStatus(statusResult),
	};
}

function branchNotFoundMessage(branch: string): string {
	return `Unknown branch: ${branch}.\nUse /branch with autocomplete to pick an available branch,\nor create it first with git.`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		activeCwd = ctx.cwd;
	});

	pi.registerCommand("branch", {
		description: "Show current git branch status and switch branches",
		getArgumentCompletions: async (prefix: string) => {
			let catalog: BranchCatalog;
			try {
				catalog = await getBranchCatalog(pi, activeCwd);
			} catch {
				return null;
			}

			const normalized = prefix.trim();
			const items = [...catalog.localBranches, ...catalog.remoteBranches]
				.filter((branch, index, arr) => arr.indexOf(branch) === index)
				.map((branch) => ({ value: branch, label: branch }));
			if (!normalized) return items;
			return items.filter((item) => item.value.startsWith(normalized));
		},
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			let branchArg: ParsedBranchArg | undefined;
			try {
				branchArg = parseArgs(args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			let current: { branch: string; status: string };
			let catalog: BranchCatalog;
			try {
				[current, catalog] = await Promise.all([showCurrentStatus(pi, ctx.cwd), getBranchCatalog(pi, ctx.cwd)]);
			} catch {
				ctx.ui.notify("Not inside a git repository.", "error");
				return;
			}

			ctx.ui.notify(`${branchInfo(ctx.cwd, current.branch)}\n${current.status}`, "info");
			let branch = branchArg?.branchName;
			const force = branchArg?.force ?? false;

			if (!branch) {
				ctx.ui.notify(usage(current.branch), "info");
				if (!ctx.hasUI) {
					return;
				}

				const options = [...catalog.localBranches, ...catalog.remoteBranches].filter(
					(branchName, index, self) => self.indexOf(branchName) === index,
				);
				if (options.length === 0) {
					ctx.ui.notify("No branches found in this repository.", "error");
					return;
				}

				const selected = await ctx.ui.select("Switch to git branch", options, {
					timeout: 120_000,
				});
				if (!selected) {
					ctx.ui.notify("No branch selected.", "info");
					return;
				}
				branch = selected;
			}

			if (!branch) {
				ctx.ui.notify(usage(current.branch), "error");
				return;
			}

			const kind = parseBranchKind(branch, catalog);
			if (!kind) {
				ctx.ui.notify(branchNotFoundMessage(branch), "error");
				return;
			}

			const currentBranch = (await git(pi, ctx.cwd, ["rev-parse", "--abbrev-ref", "HEAD"])) || "";
			if (currentBranch === branch || (kind === "remote" && localFromRemote(branch) === currentBranch)) {
				ctx.ui.notify(`Already on ${branch}.`, "info");
				return;
			}

			const statusText = await git(pi, ctx.cwd, ["status", "--short"]);
			const isDirty = statusText.trim().length > 0;
			if (isDirty && !force) {
				if (!ctx.hasUI) {
					ctx.ui.notify("Working tree has uncommitted changes. Use --force to switch anyway.", "error");
					return;
				}

				const confirmed = await ctx.ui.confirm(
					"Switch git branch",
					"Working tree has uncommitted changes. Do you want to switch branches anyway?",
				);
				if (!confirmed) {
					ctx.ui.notify("Branch switch cancelled.", "warning");
					return;
				}
			}

			try {
				if (kind === "local") {
					await git(pi, ctx.cwd, ["switch", branch]);
					ctx.ui.notify(`Switched to branch ${branch}.`, "success");
					return;
				}

				const localName = localFromRemote(branch);
				if (catalog.localBranches.includes(localName)) {
					await git(pi, ctx.cwd, ["switch", localName]);
					ctx.ui.notify(`Switched to local branch ${localName}.`, "success");
					return;
				}

				await git(pi, ctx.cwd, ["switch", "--track", "-c", localName, branch]);
				ctx.ui.notify(`Created tracking branch ${localName} from ${branch}.`, "success");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
