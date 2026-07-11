#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$repo_root}"
export PATH="$repo_root/node_modules/.bin:$PATH"

evanescent=false
args=()
for arg in "$@"; do
	case "$arg" in
	--evanescent)
		evanescent=true
		;;
	--evanescent=0 | --evanescent=false | --evanescent=no | --evanescent=off | --no-evanescent)
		evanescent=false
		;;
	*)
		args+=("$arg")
		;;
	esac
done

if [[ "$evanescent" == true ]]; then
	temp_root="${PI_EVANESCENT_TEMP_ROOT:-${TMPDIR:-/tmp}/pi-evanescent}"
	created_at="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
	stamp="${created_at//:/-}"
	stamp="${stamp//./-}"
	if command -v uuidgen >/dev/null 2>&1; then
		uuid="$(uuidgen | tr '[:upper:]' '[:lower:]')"
	elif [[ -r /proc/sys/kernel/random/uuid ]]; then
		uuid="$(cat /proc/sys/kernel/random/uuid)"
	else
		uuid="$$-$RANDOM"
	fi
	id="$stamp-$uuid"
	run_root="$temp_root/$id"
	workspace="$run_root/workspace"
	mkdir -p "$workspace"
	printf '%s' "$$" >"$run_root/.active"
	cat >"$run_root/evanescent-run.json" <<JSON
{"schemaVersion":1,"id":"$id","createdAt":"$created_at","workspacePath":"$workspace","materialized":false,"materializedPath":null,"pid":$$}
JSON
	cd "$workspace"
fi

pi_executable="$repo_root/bin/pi"
if [ ! -x "$pi_executable" ]; then
	pi_executable="pi"
fi

exec "$pi_executable" "${args[@]}"
