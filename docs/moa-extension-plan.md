# Mixture-of-Agents extension plan

## Status

Planning complete; implementation has not started.

Selected MVP policy:

- pure Pi extension with a virtual `moa` provider;
- named presets are ordinary selectable models (`moa/<preset>`);
- reference calls are private, tool-free, and receive only flattened
  user/assistant text;
- the acting aggregator retains Pi's normal stream and tool loop;
- references run once per user turn and fail open individually;
- built-in Pi usage represents the aggregator only; exact reference usage is
  stored separately in durable, LLM-hidden MoA trace entries;
- every preset must declare its virtual context metadata explicitly.

## Decision

No Pi core change is required for the MVP.

Pi can register a provider with custom `streamSimple` behavior during extension
loading. A local smoke extension registered `moa-smoke/default`, and
`scripts/pi-home.sh -e /tmp/moa-provider-smoke.ts --list-models moa-smoke`
listed it as a normal reasoning-capable model. Pi also flushes provider
registrations before model use, while `session_start` provides the model
registry before the first user request.

The extension should therefore expose the MoA as a **virtual provider**, not as
a slash-command wrapper and not as a new upstream API protocol. The provider
uses `api: "moa"`, `baseUrl: "moa://local"`, and a fixed dummy API key so Pi
recognizes it as configured; none of those virtual request values may reach a
child provider.

## Why this shape

The paper's useful invariant is that every model in a reference layer sees the
outputs from the preceding layer, after which a final model synthesizes the
result. The Together examples implement each layer as parallel calls and reserve
a final aggregator call for synthesis.

For Pi, only the final aggregator should be allowed to act:

1. Pi gives the virtual provider the real conversation, tool schemas, active
   abort signal, and stream options.
2. The extension runs each configured reference layer without tools.
3. The extension privately appends the final reference set to a cloned copy of
   the real context.
4. The configured aggregator is streamed through its real Pi provider.
5. Pi receives that native stream, executes any tool calls, and invokes the
   virtual provider again for the next agent iteration.

This preserves Pi's existing agent loop instead of reimplementing it inside the
extension.

## Architecture

```text
User turn
   |
   v
Pi agent loop -> moa/<preset>.streamSimple(real Context + tools)
                    |
                    +-> flatten safe advisor context
                    |
                    +-> reference layer 1 (parallel, no tools)
                    |       ref A ----+
                    |       ref B ----+--> ordered successful outputs
                    |       ref C ----+
                    |
                    +-> optional reference layer N (parallel, no tools)
                    |       every call sees all preceding-layer outputs
                    |
                    +-> clone real Context
                    |       append private, delimited reference guidance at tail
                    |
                    +-> real aggregator provider.streamSimple(full tools)
                            |
                            +-> native text/thinking/tool-call events
                            +-> native provider/model identity
                            +-> aggregator-only built-in usage
```

### Extension boundary

Proposed files:

- `extensions/moa.ts` — settings load, provider registration, lifecycle
  wiring, status UI, trace append;
- `extensions/lib/moa-config.ts` — configuration types, parsing, defaults, and
  validation;
- `extensions/lib/moa-orchestrator.ts` — context projection, reference layers,
  caching, model dispatch, and final stream delegation;
- `tests/moa-config.test.ts`;
- `tests/moa-orchestrator.test.ts`;
- `tests/moa-extension.test.ts` if provider-registration behavior needs a
  separate harness.

Do not introduce a generic orchestration framework or a second provider
abstraction in the MVP.

## Configuration

Configuration lives under `moa` in `settings.json`; this repository records the
portable form in `settings.managed.json`.

Proposed shape:

```jsonc
{
  "moa": {
    "presets": {
      "balanced": {
        "name": "Balanced MoA",
        "contextWindow": 200000,
        "maxTokens": 32768,
        "input": ["text"],
        "referenceLayers": [
          [
            {
              "provider": "provider-a",
              "model": "model-a",
              "thinking": "medium",
              "maxTokens": 1200
            },
            {
              "provider": "provider-b",
              "model": "model-b",
              "thinking": "medium",
              "maxTokens": 1200
            }
          ]
        ],
        "aggregator": {
          "provider": "provider-c",
          "model": "model-c",
          "thinking": "high"
        },
        "limits": {
          "referenceTimeoutMs": 120000,
          "advisorInputChars": 48000,
          "outputCharsPerReference": 16000,
          "injectedReferenceChars": 48000
        }
      }
    }
  }
}
```

### Required preset metadata

`contextWindow`, `maxTokens`, and `input` are required because Pi needs virtual
model metadata before `session_start`. The aggregator can be an
extension-defined or credential-dependent model that is not reliably
discoverable while the `moa` provider is first registered. Guessing these values
can cause premature compaction or overflow the real aggregator.

For the text-only MVP, validation accepts only `input: ["text"]`.

### Model slots

A model slot contains:

- required `provider` and `model`;
- optional `thinking`;
- optional reference `maxTokens`;
- optional `temperature` only if a concrete use case requires it during
  implementation.

Repeating a slot is the explicit way to sample the same model more than once. A
slot whose provider is `moa` is rejected to prevent recursive orchestration.

### Validation limits

Reject the entire preset at load time when it violates any invariant:

- no aggregator;
- no reference layer or an empty layer;
- recursive `moa` slot;
- unsupported virtual input type;
- non-positive token/context/timeout limits;
- more than 3 reference layers;
- more than 8 calls in one layer;
- more than 16 reference calls in the whole preset;
- unsafe preset/model identifiers.

A bad preset must not prevent valid presets or unrelated extensions from
loading. Report the invalid preset through extension diagnostics and omit only
its virtual model.

Settings changes take effect on `/reload`; no custom live configuration editor
is planned. In this repository, `settings.managed.json` remains the canonical
portable source and `settings.json` is only its runtime-reconciled form.

## Request processing

### 1. Capture runtime services

The extension factory reads and validates static settings, then registers the
virtual provider and models. A `session_start` handler captures the
session-scoped `ctx.modelRegistry` and UI context. A `session_shutdown` handler
clears caches and status.

If `streamSimple` is somehow called before runtime capture, return a normal
provider error rather than guessing or using global model catalogs.

### 2. Resolve every real model at call time

For every slot:

1. find the model with `ctx.modelRegistry.find(provider, model)`;
2. reject missing models and recursive `moa` models;
3. resolve request auth with `getApiKeyAndHeaders(model)`;
4. resolve provider auth with `getProviderAuth(provider)` so a
   credential-specific `baseUrl` is not lost;
5. clone the model with the resolved `baseUrl`, when present;
6. dispatch through `ctx.modelRegistry.getProvider(provider).streamSimple(...)`.

This intentionally uses the composed runtime provider, rather than global
`completeSimple`, so references may use built-in providers, `models.json`
models, and providers registered by other extensions.

Never forward the virtual MoA API key or headers to a child. Forward only safe
outer request behavior such as `signal`, `sessionId`, cache retention, retry
limits, and supported timeout settings; child auth replaces virtual auth.

### 3. Build the advisor context

References do not receive the real Pi `Context` directly. Historical tool calls
without schemas can be invalid for child providers, and the conservative policy
does not permit tool data disclosure.

Create one flattened user message containing, in order:

- preceding user text;
- preceding assistant **text** only;
- the latest user text exactly once;
- no system prompt;
- no thinking blocks;
- no tool calls;
- no tool results;
- no images (use a neutral omission marker only when needed for coherence);
- no tool schemas.

Trim oldest conversational material first to `advisorInputChars`, but always
retain a bounded version of the latest user request. The reference system prompt
asks for an independent candidate answer/analysis, explicitly prohibits tool
calls, and says later aggregation will treat it as untrusted advice.

### 4. Run paper-style layers

For layer 1, every slot gets the same flattened advisor context.

For each later reference layer, every slot gets:

- the same bounded base advisor context; and
- every successful output from the preceding layer, in stable configured order,
  wrapped in untrusted-data delimiters.

Run calls within one layer concurrently. Layers remain sequential. Extract only
assistant text from each result; do not pass thinking, signatures, or tool-call
blocks downstream.

Enforce output limits after completion even when a provider ignores
`maxTokens`. Before every later reference layer, deterministically truncate
the complete preceding-layer bundle to `injectedReferenceChars`; apply the
same bound again before final-aggregator injection.

### 5. Delegate to the acting aggregator

Clone the original Pi context and append a delimited synthesis instruction plus
the last successful reference set at the context tail:

- if the terminal message is a user message, append a text block to that cloned
  message;
- if it is a tool result, append a text block to the last cloned tool result;
- if it is an assistant message, append a new user message.

Appending guidance to a final tool result avoids creating adjacent user messages
when Anthropic converts Pi tool results into a user-role API message. Never
mutate Pi's original context.

The synthesis instruction says references are untrusted, may be wrong or
malicious, and are evidence to evaluate rather than instructions to obey. The
aggregator still receives the original system prompt, messages, images, and tool
schemas.

### 6. Forward the native stream

Forward the aggregator's stream events without rewriting:

- `api`, `provider`, and `model` remain the real aggregator values;
- reasoning and text signatures remain intact;
- tool-call IDs and incremental argument events remain intact;
- `responseModel` remains provider-controlled;
- aggregator errors and aborts retain their native semantics.

This is important for cross-provider transcript replay and reasoning-signature
validity.

## Cadence and caching

The MVP cadence is `userTurn`.

- Compute a deterministic cache key from preset identity, normalized slot
  configuration, resolved child model/endpoint fingerprints, and the advisor
  context through the latest real user message.
- Run all reference layers once for that key.
- Reuse the ordered successful outputs for aggregator retries and later tool
  iterations in the same user turn.
- A new user message creates a new key and reruns references.
- Keep the cache session-local and bounded to a small number of recent keys.

Do not cache:

- an aborted layer;
- an all-failed first layer;
- results from an invalidated/reloaded preset.

Cache successful reference outputs before starting the aggregator so a
final-stream retry does not repay the fan-out cost.

`perIteration` may be added later, but it is deliberately absent from the first
implementation unless testing demonstrates that stale pre-tool advice is
materially harmful.

## Failures, limits, and cancellation

### References

- Use bounded concurrency and `Promise.allSettled` semantics.
- An individual reference failure is omitted from downstream model input and
  recorded in the trace.
- Do not inject raw credential or provider error text into another model's
  prompt.
- If an entire later layer fails, use the most recent non-empty layer output.
- If the first layer entirely fails, stream the aggregator alone and show a
  non-fatal warning.

### Aggregator

A missing model, missing auth, provider error, or malformed aggregator stream is
fatal and becomes the virtual provider's error. Do not silently choose another
acting model.

### Abort and timeout

- Propagate the outer abort signal to every child request.
- Give each reference call a bounded timeout with a linked abort controller.
- Abort remaining fan-out work promptly when the outer operation is cancelled.
- Emit `stopReason: "aborted"` when setup is interrupted before an inner stream
  exists.
- Always clear MoA status UI in `finally` paths.

## Usage and trace accounting

Do **not** add reference usage to the aggregator assistant message.

Pi uses the last assistant message's `usage.totalTokens` as the current context
size and interprets its cache fields as one request. Combining fan-out usage
there would corrupt compaction thresholds and cache-miss statistics. Pi's
built-in per-model breakdown also attributes one assistant message to one model.

Instead:

- preserve the aggregator's usage unchanged in the assistant message;
- append a versioned `moa-trace` custom session entry that does not participate
  in LLM context;
- store no reference response text in the MVP trace;
- record preset, cache key hash, cadence, timestamps, layer/slot labels,
  provider/model, status, duration, token buckets, and cost for each reference
  call;
- distinguish fresh and cache-reused references;
- register a compact renderer showing reference call count, failures, latency,
  tokens, and total auxiliary cost.

The built-in footer and built-in session totals will therefore under-report the
reference calls. The trace is the authoritative auxiliary total. Exact
integration into Pi's native totals would require a Pi core concept for
auxiliary usage that is excluded from context/cache calculations but included in
per-model cost breakdowns; that is explicitly out of MVP scope.

## UI behavior

Keep UI modest:

- footer status while fan-out runs, such as `MoA balanced · layer 1 · 2/3`;
- one warning when all references fail and the aggregator runs alone;
- durable compact trace entry after fresh reference work;
- no display of raw reference answers;
- no `/moa` command because `/model` already selects presets;
- no trace browser, benchmark UI, or configuration editor.

The stream remains usable in TUI, print, JSON, and RPC modes. UI methods must be
guarded for modes where they are unavailable or no-ops.

## Agent-mixture alternative

A mixture of full Pi agents is viable, but it is a different product shape from
the model-level MoA described in the paper.

### What it could improve

Each reference agent could use a normal Pi system prompt and read-only tools to
inspect the repository independently. That can produce much stronger coding
advice than a one-call advisor that receives only conversation text.

### Why it should not be the MVP backend

- A full agent may make several model calls and tool calls, so cost and latency
  become less predictable than layer width suggests.
- Multiple normal agents sharing one checkout cannot safely write concurrently.
  Reference agents must be read-only, sequential, or isolated in worktrees.
- Child sessions need explicit context handoff, tool policy, cancellation,
  timeout, session cleanup, and output extraction.
- Hidden nested Pi sessions inside a provider stream create re-entrancy and
  resource-contention risks.
- If child outputs return through a parent tool call, they enter the parent
  transcript and are no longer private references.
- It is better expressed as an orchestration command/chain than as a transparent
  model provider.

### Recommended follow-up experiment

After the model-level MVP is measured, prototype an **agent ensemble**
separately using the existing `pi-subagents` machinery:

1. run 2–3 fresh-context, read-only agents in parallel;
2. give each the same focused task and repository scope;
3. collect only final reports;
4. let one parent/aggregator synthesize;
5. compare quality, latency, cost, cancellation, and workspace safety against
   `moa/<preset>`.

Do not add a backend abstraction to the MVP in anticipation of this experiment.
If the agent ensemble clearly wins for coding tasks, expose it as a separate
command or chain rather than silently changing virtual-provider semantics.

## Verification plan

### Automated tests

Configuration tests:

- parses one and multiple presets;
- rejects recursion, missing aggregator, empty layers, bad metadata, unsupported
  input, and amplification limits;
- omits one bad preset without suppressing valid presets;
- produces stable model metadata and cache keys.

Context tests:

- includes user/assistant text in order;
- excludes system prompt, thinking, tools, tool calls, tool results, and images;
- retains a bounded latest user turn under truncation;
- escapes/delimits untrusted reference text;
- clones and tail-injects user/tool-result/assistant terminal contexts without
  mutating originals.

Orchestrator tests with fake providers and registry:

- layer calls run concurrently while layers run sequentially;
- every later slot sees all successful preceding outputs in configured order;
- only the aggregator receives tool schemas and the original context;
- user-turn cache prevents reruns after tool results and aggregator retries;
- a new user message invalidates the cache;
- partial and total reference failures follow fail-open policy;
- aggregator failure is fatal;
- recursion is rejected again at runtime;
- auth, credential-specific base URL, and safe stream options reach children;
- virtual credentials never reach children;
- abort and timeout signals terminate fan-out;
- stream events and aggregator identity/usage are unchanged;
- trace usage is exact and reference text is absent.

### Repository checks

```bash
npm exec tsc -- --noEmit
node --test --experimental-strip-types tests/moa-*.test.ts
npm test
scripts/pi-home.sh --list-models moa
```

Run `lsp_diagnostics` before the full test suite and `lens_diagnostics mode=all`
before declaring completion.

### Manual smoke tests

With an explicitly approved real preset:

1. select `moa/<preset>` through the normal model picker;
2. answer a no-tool question and confirm native streaming;
3. ask the aggregator to read a file and confirm its tool call executes
   normally;
4. confirm tool continuation does not rerun references under `userTurn` cadence;
5. invalidate one reference credential and confirm fail-open behavior;
6. abort during fan-out and during aggregation;
7. resume the session and verify assistant identity/signatures replay correctly;
8. inspect the durable trace and compare reference usage with provider
   responses;
9. verify built-in context usage tracks only the acting aggregator;
10. verify print and RPC modes do not depend on TUI rendering.

## Delivery phases

1. **Config and registration** — parser, validation, virtual models, static
   metadata, list-model smoke test.
2. **One-layer orchestration** — safe context projection, model/auth
   resolution, parallel references, acting aggregator stream.
3. **Correctness controls** — multiple reference layers, limits, caching,
   failures, aborts, timeouts, tail injection.
4. **Trace and status** — auxiliary usage entries, compact renderer,
   progress/warning UI.
5. **Integration verification** — fake-provider tests, real-provider smoke
   test, session replay, full repository validation.
6. **Optional later experiment** — separate read-only full-agent ensemble
   using `pi-subagents`.

Each phase should leave the extension selectable and testable; do not wait until
the final phase to test native tool calls and replay.

## Acceptance criteria

The MVP is complete when:

- configured presets appear as `moa/*` models without core changes;
- reference layers obey paper-style preceding-layer fan-in and configured-order
  determinism;
- references are text-only, tool-free, private, capped, and run once per user
  turn;
- the final aggregator streams through its real provider and can use Pi tools
  normally;
- native aggregator identity, signatures, stop reason, and usage survive
  unchanged;
- one failed advisor cannot fail the turn, while aggregator failure remains
  visible;
- retries and tool iterations reuse successful references without double
  charging;
- cancellation and timeouts terminate child calls;
- reference usage/cost is durable and attributable in LLM-hidden trace entries;
- invalid or recursive presets fail safely;
- TypeScript, targeted tests, the full test suite, and real-provider smoke
  checks pass.

## Known concerns

1. Built-in Pi cost totals intentionally omit reference calls; the MoA trace
   must be consulted for the true total.
2. Even user/assistant-only context may contain proprietary or sensitive text
   and is sent to every configured reference provider.
3. Fan-out increases first-token latency and can amplify cost quickly despite
   hard limits.
4. Required virtual metadata can drift when the aggregator model changes;
   validation cannot prove a third-party model's real context limits.
5. In-memory reference caches do not survive `/reload` or process restart.
6. Reference outputs remain a prompt-injection channel; delimiting and
   critical-synthesis instructions reduce but cannot eliminate it.
7. Extension-registered child providers need real integration coverage because
   nested stream behavior is provider-specific.
8. A full-agent ensemble may outperform text-only references on repository
   tasks, but it has materially different safety and orchestration requirements.

## Evidence

Primary references:

- Mixture-of-Agents paper: <https://arxiv.org/abs/2406.04692>
- Together's parallel two-layer example:
  <https://github.com/togethercomputer/MoA/blob/1b5cab0f0905d9da821e37322ac6df96ba65e1a7/moa.py#L38-L47>
- Together's repeated intermediate layers:
  <https://github.com/togethercomputer/MoA/blob/1b5cab0f0905d9da821e37322ac6df96ba65e1a7/advanced-moa.py#L66-L84>
- Hermes parallel references and fail-soft behavior:
  <https://github.com/NousResearch/hermes-agent/blob/11ae6bf0e3d334ae74d3b240dfc4c64171c60233/agent/moa_loop.py#L381-L435>
- Hermes recursion guard:
  <https://github.com/NousResearch/hermes-agent/blob/11ae6bf0e3d334ae74d3b240dfc4c64171c60233/hermes_cli/moa_config.py#L98-L130>
- Hermes acting-aggregator streaming:
  <https://github.com/NousResearch/hermes-agent/blob/11ae6bf0e3d334ae74d3b240dfc4c64171c60233/agent/moa_loop.py#L1103-L1142>

Pi 0.81.1 runtime evidence in this checkout:

- custom-provider contract:
  `node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md`;
- extension lifecycle and provider registration:
  `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`;
- provider registration flush:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js`;
- provider composition/custom `streamSimple`:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js`;
- runtime request auth/base-URL preparation:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js`;
- extension model/auth/provider access:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js`;
- compaction's interpretation of assistant usage:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/`
  `compaction.js`;
- cache statistics:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/cache-stats.js`;
- per-model usage attribution:
  `node_modules/@earendil-works/pi-coding-agent/dist/core/usage-totals.js`;
- Anthropic tool-result conversion:
  `node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js`.
