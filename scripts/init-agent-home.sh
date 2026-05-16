#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
settings_src="$repo_root/settings.example.json"
settings_dst="$repo_root/settings.json"

mkdir -p \
	"$repo_root/sessions" \
	"$repo_root/git" \
	"$repo_root/bin" \
	"$repo_root/github-tracker-runs"

if [ ! -f "$settings_dst" ]; then
	if [ -f "$settings_src" ]; then
		cp "$settings_src" "$settings_dst"
		printf 'Created %s from settings.example.json\n' "$settings_dst"
	else
		printf '{}\n' >"$settings_dst"
		printf 'Created empty %s\n' "$settings_dst"
	fi
else
	printf 'Keeping existing %s\n' "$settings_dst"
fi

cat <<EOF

This checkout is ready to use as a Pi agent home:

  PI_CODING_AGENT_DIR="$repo_root" pi

or:

  "$repo_root/scripts/pi-home.sh"

Runtime state created here is ignored by git. auth.json is not copied; sign in or copy it manually only if you intend to keep this checkout as your live agent home.
EOF
