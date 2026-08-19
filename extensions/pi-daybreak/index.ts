// pi-daybreak: live account-scoped Codex model discovery for pi.
//
// pi's built-in openai-codex catalog is static. This extension queries the
// ChatGPT Codex backend's model catalog (GET /backend-api/codex/models, the
// same endpoint Codex CLI uses) at session start and exposes any entitled
// models missing from the built-in catalog — e.g. gpt-daybreak-* aliases.
// Discovered models clone metadata from gpt-5.6-sol so cost, context window,
// thinking-level mapping, and tool-compat flags track upstream pi-ai updates
// instead of being copied.
//
// The composed list is cached on disk and re-registered synchronously at
// extension load, which runs before `--model` resolution — so CLI-selected
// discovered models only warn on the first-ever run. The cache also covers
// offline sessions.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const BASE_URL = "https://chatgpt.com/backend-api";
const TEMPLATE_MODEL = "gpt-5.6-sol";
// Catalog contents are gated on client_version; track Codex CLI releases.
const CLIENT_VERSION = "0.148.0";
const FETCH_TIMEOUT_MS = 5000;

const CACHE_FILE = join(
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
	"cache",
	"pi-daybreak",
	"models.json",
);

interface CodexModelInfo {
	slug: string;
	display_name: string;
	visibility?: "list" | "hide" | "none";
	context_window?: number;
	input_modalities?: string[];
}

type ModelDef = ProviderModelConfig;

interface Cache {
	/** Ids contributed by discovery (vs. built-ins), for removal handling. */
	discovered: string[];
	/** Full composed provider model list, as last registered. */
	models: ModelDef[];
}

function readCache(): Cache | undefined {
	try {
		const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Partial<Cache>;
		if (!Array.isArray(raw.models) || !Array.isArray(raw.discovered))
			return undefined;
		return raw as Cache;
	} catch {
		return undefined;
	}
}

function writeCache(cache: Cache): void {
	try {
		mkdirSync(join(CACHE_FILE, ".."), { recursive: true });
		writeFileSync(CACHE_FILE, JSON.stringify(cache));
	} catch {
		// Cache is best-effort; discovery still works without it.
	}
}

function accountIdFrom(token: string): string | undefined {
	try {
		const payload = JSON.parse(atob(token.split(".").at(1) ?? ""));
		return payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
	} catch {
		return undefined;
	}
}

async function fetchCatalog(accessToken: string): Promise<CodexModelInfo[]> {
	const accountId = accountIdFrom(accessToken);
	if (!accountId) return [];
	const res = await fetch(
		`${BASE_URL}/codex/models?client_version=${CLIENT_VERSION}`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"chatgpt-account-id": accountId,
				originator: "pi",
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		},
	);
	if (!res.ok) return [];
	const body = (await res.json()) as { models?: CodexModelInfo[] };
	return body.models ?? [];
}

export default function (pi: ExtensionAPI) {
	// Factory runs before --model resolution; restore the last composed list.
	const cached = readCache();
	if (cached && cached.models.length > 0) {
		pi.registerProvider(PROVIDER, { models: cached.models });
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			// registerProvider's `models` replaces the provider's list, so
			// re-supply every built-in and append discovered extras. Models
			// contributed by a previous discovery run are dropped first, so
			// revoked entitlements and upstream renames don't linger.
			const previous = new Set(cached?.discovered ?? []);
			const current = ctx.modelRegistry
				.getAll()
				.filter((m) => m.provider === PROVIDER && !previous.has(m.id));
			const template = current.find((m) => m.id === TEMPLATE_MODEL) ?? current[0];
			const auth = await ctx.modelRegistry.getProviderAuth(PROVIDER);
			const token = auth?.auth.apiKey;
			if (!template || !token) return;

			const catalog = await fetchCatalog(token);
			const known = new Set(current.map((m) => m.id));
			const discovered = catalog.flatMap((m) => {
				if (m.visibility !== "list" || known.has(m.slug)) return [];
				return [
					{
						...template,
						id: m.slug,
						name: m.display_name || m.slug,
						contextWindow: m.context_window ?? template.contextWindow,
						input: (m.input_modalities?.filter(
							(i) => i === "text" || i === "image",
						) ?? template.input) as ("text" | "image")[],
					},
				];
			});

			const finalIds = [
				...current.map((m) => m.id),
				...discovered.map((m) => m.id),
			];
			if (
				cached &&
				finalIds.join(" ") === cached.models.map((m) => m.id).join(" ")
			)
				return;

			const models = [...current, ...discovered];
			pi.registerProvider(PROVIDER, { models });
			writeCache({ discovered: discovered.map((m) => m.id), models });
		} catch {
			// Offline, expired token, backend change — keep the current list.
		}
	});
}
