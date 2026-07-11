#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_name="@earendil-works/pi-coding-agent"

if ! command -v npm >/dev/null 2>&1; then
	printf 'npm is required to update the repo-pinned Pi runtime.\n' >&2
	exit 1
fi

version="${CY_PI_RUNTIME_VERSION:-}"
if [ -z "$version" ]; then
	version="$(npm view "$package_name" version)"
fi
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
	printf 'Could not determine a valid Pi runtime version: %s\n' "$version" >&2
	exit 1
fi

packages=(
	"@earendil-works/pi-ai@$version"
	"@earendil-works/pi-coding-agent@$version"
	"@earendil-works/pi-tui@$version"
)

(
	cd "$repo_root"
	npm install --save-dev --save-exact "${packages[@]}"
)

printf 'Repo-pinned Pi runtime is now %s.\n' "$version"
printf 'Commit and push package.json and package-lock.json to synchronize other machines.\n'
