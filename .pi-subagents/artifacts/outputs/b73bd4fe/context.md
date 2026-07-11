# Code Context

## Files Retrieved

1. `package.json` (lines 1-43) - root npm manifest: only `npm` is evidenced, with a v3 `package-lock.json`; the `pi` manifest field declares loadable local resources.
2. `package-lock.json` (lines 1-25) - root npm lockfile is npm lockfile v3 and must accompany any root-manifest dependency change.
3. `npm/package.json` (lines 1-16) - separate, nested npm package dedicated to installed third-party Pi packages.
4. `npm/package-lock.json` (lines 1-24) - lockfile for that nested Pi-package directory.
5. `settings.example.json` (lines 1-51) - Pi loads packaged extensions/skills through its `packages` array; this is the integration point for a *published Pi package*, not ordinary CLIs.
6. `scripts/init-agent-home.sh` (lines 1-11, 194-225, 235-246) - initialization targets `npm/` specifically and runs `npm ci` (falling back to `npm install`) there.
7. `README.md` (lines 3-55, 109-111) - direct-home operating model, launch commands, and warning against adding this checkout itself to `settings.json`.
8. `scripts/pi-home.sh` (lines 1-47) - exports `PI_CODING_AGENT_DIR` to this checkout before launching Pi.
9. `AGENTS.md` (lines 3-13) - resource-placement constraints: only Pi-understood resources in `package.json.pi`; extension runtime dependencies belong in root `dependencies`.
10. `extensions/sh.ts` (lines 1-104) - existing `/sh <command>` command executes shell commands in Pi's current working directory.
11. `extensions/plan-mode.ts` (lines 45-124) - its review/plan policy classifies `npm install`/`ci` as destructive and npm metadata commands as safe.
12. `justfile` (lines 1-20) - conventional recipes: `just init-agent-home`, `just pi-home`, `just test`.
13. `.gitignore` (lines 1-31) - runtime state such as generated `settings.json`, `bin/`, and `node_modules/` remains untracked.

## Key Code

### Package-manager convention

- This is an npm repository: root `package.json` has `npm test`, both lockfiles are `lockfileVersion: 3`, and the available toolchain is npm `10.9.8` / Node `v22.23.1`.
- There are **two intentionally separate dependency scopes**:
  - Root (`package.json` + `package-lock.json`) supports this TypeScript agent-home source and has `typebox` as its sole runtime dependency. Per `AGENTS.md:13`, add a dependency here only when a checked-in extension imports it at runtime.
  - Nested `npm/` (`npm/package.json` + `npm/package-lock.json`) holds Pi packages such as `pi-subagents` and `pi-lens`. The bootstrap script installs exactly this directory. It is the appropriate location only for Pi's packaged-extension/skill mechanism.

### Pi integration

```json
// package.json:21-34
"pi": {
  "extensions": ["./extensions"],
  "skills": ["./skills"],
  "prompts": ["./prompts"],
  "themes": ["./themes"]
}
```

- Local Pi resources are auto-loaded from the repository via the `pi` field when launched with `PI_CODING_AGENT_DIR` (README lines 34-52; `scripts/pi-home.sh:6`). New custom integrations should be a TypeScript extension under `extensions/` or a skill under `skills/`, not a new unsupported `pi` entry.
- `settings.example.json:2-12` provides the second integration route: package specifiers in `packages`; it currently uses `npm:<Pi-package>` entries. No existing OpenSpec setting, command, extension, or skill was found.
- `/sh` is already a Pi UI command for invoking a CLI in the current workspace (`extensions/sh.ts:87-104`), so no adapter is needed merely to run `openspec` after it is installed/on PATH.

### OpenSpec package verification

Read-only npm-registry query succeeded:

```text
npm view @fission-ai/openspec version bin description --json
# version 1.6.0; bin: { "openspec": "bin/openspec.js" }
```

Thus the verified npm package is `@fission-ai/openspec`, with executable `openspec`.

## Recommended Files and Commands

### Preferred: install/use OpenSpec in the *target software project*, not this Pi agent-home

OpenSpec is a development CLI rather than a Pi extension. From the software project that needs specs:

```bash
npm install --save-dev @fission-ai/openspec@1.6.0
npx openspec --help
```

This changes that target project's `package.json` and lockfile only. Pi can invoke it through the existing `/sh npx openspec ...` command while its current working directory is that project.

For a no-persistent-install trial, use:

```bash
npx --yes @fission-ai/openspec@1.6.0 --help
```

Confirm the package's current initialization syntax from its help before invoking it; this scout verified the package/bin but did not run a mutating initializer.

### If a repo-local installation in `cy-pi` is explicitly desired

Use the **root** manifest and root lockfile, not `npm/`, because OpenSpec is not evidenced as a Pi package:

```bash
npm install --save-dev @fission-ai/openspec@1.6.0
npx openspec --help
npm test
```

Expected changed tracked files: `package.json` and `package-lock.json`. Do not add it to `settings.example.json.packages` unless OpenSpec separately publishes a Pi-compatible package and its documented integration requires that mechanism.

### Existing agent-home lifecycle

```bash
just init-agent-home   # initializes settings and runs npm ci in npm/
just pi-home           # launches with PI_CODING_AGENT_DIR set to this checkout
just test
```

Do not rely on `init-agent-home` to install a root OpenSpec dependency: `scripts/init-agent-home.sh:194-225` only installs `npm/`.

## Architecture

`PI_CODING_AGENT_DIR` makes this checkout the active Pi home. Pi loads local TypeScript extensions/skills from the root `pi` manifest, while `settings.json` (generated from `settings.example.json`) loads separately installed Pi packages. `scripts/init-agent-home.sh` provisions the latter into `npm/node_modules`; `scripts/pi-home.sh` starts Pi in direct-home mode. A generic executable such as `openspec` needs neither route unless the product requirement is a dedicated Pi command/skill; it can be run in a project workspace through the existing `/sh` extension.

## Start Here

Open `package.json` first. It establishes the root npm/lockfile pairing and the allowed Pi-local resource loading surface. Then inspect `npm/package.json` before choosing the nested Pi-package path.

## Review Findings

- **Info — `package.json:21-34` / `AGENTS.md:8-11`:** `package.json.pi` only supports extensions, skills, prompts, and themes. Placing an OpenSpec CLI package there would violate repository guidance and will not establish a CLI integration.
- **Medium — `scripts/init-agent-home.sh:194-225`:** bootstrap only installs `npm/`; a root `npm install --save-dev` OpenSpec dependency will not be provisioned by `just init-agent-home` on a fresh clone unless the script is deliberately changed.
- **Medium — `settings.example.json:2-12`:** `packages` is a Pi package list. Adding `npm:@fission-ai/openspec` without verified Pi-package compatibility is likely ineffective or incompatible.
- **Info — working tree:** `git status --short` showed only untracked `.pi-subagents/` runtime artifacts before this report; no staged files were present.

## Residual Risks

- The registry lookup confirmed the package name, version, and `openspec` binary, but the attempted full README query timed out. Validate the intended `init`/Pi-specific installation syntax via `npx openspec --help` immediately before implementation.
- Whether OpenSpec should live in this agent-home or in each target codebase is a product decision. The recommended target-project installation avoids coupling a generic project CLI to Pi's portable agent-home configuration.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete npm scopes, Pi load points, exact paths, commands, and severity-labelled findings are documented above."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/b73bd4fe/context.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git diff --check && npm --version && node --version && command -v pi && command -v openspec",
      "result": "passed",
      "summary": "npm 10.9.8 and Node v22.23.1 available; Pi wrapper found; OpenSpec absent; no staged changes."
    },
    {
      "command": "npm view @fission-ai/openspec version bin description --json",
      "result": "passed",
      "summary": "Verified @fission-ai/openspec 1.6.0 exposes the openspec binary."
    },
    {
      "command": "npm view @fission-ai/openspec@1.6.0 readme --json | node ...",
      "result": "timed out",
      "summary": "README-based initialization syntax was not verified."
    }
  ],
  "validationOutput": [
    "Read-only scout completed; no source/config files were edited.",
    "git diff --check produced no output."
  ],
  "residualRisks": [
    "Confirm OpenSpec initialization and any Pi-specific integration syntax from current CLI help; README retrieval timed out.",
    "Choose target-project versus cy-pi root installation deliberately."
  ],
  "noStagedFiles": true,
  "diffSummary": "Only the required ignored subagent findings artifact was written; no repository implementation changes.",
  "reviewFindings": [
    "medium: scripts/init-agent-home.sh:194-225 - it installs only npm/, so it will not provision a new root OpenSpec dependency.",
    "medium: settings.example.json:2-12 - packages is for Pi packages; OpenSpec CLI compatibility with that loader is unverified.",
    "info: package.json:21-34 - pi manifest should remain limited to supported resource directories."
  ],
  "manualNotes": "Recommended default is dev-installing OpenSpec in the target software project and invoking it from Pi through the existing /sh command."
}
```
