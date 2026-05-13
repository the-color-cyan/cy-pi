# Archive

Files in this directory are parked for reference only.

They are intentionally not active pi resources:

- `package.json` does not include `archive/` in package `files`.
- `package.json -> pi` does not declare `archive/` as a resource root.
- Local setup/link scripts skip this directory and remove repo-owned archived/stale agent links.

Move a resource back to the appropriate top-level directory (`extensions/`, `skills/`, `prompts/`, `themes/`, or active `agents/`) before using it again.
