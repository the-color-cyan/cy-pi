#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="pull"
machine="false"

log() {
	[[ "$machine" == "true" ]] && return
	printf '%s\n' "$*" >&2
}

is_truthy() {
	local value="${1-}"
	value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
	case "$value" in
	1 | true | yes | on)
		return 0
		;;
	*)
		return 1
		;;
	esac
}

emit_status() {
	local status="$1"
	local behind="${2:-0}"
	local ahead="${3:-0}"
	local branch="${4:-}"
	local upstream="${5:-}"
	local reason="${6:-}"

	if [[ "$machine" == "true" ]]; then
		printf 'status=%s\n' "$status"
		printf 'behind=%s\n' "$behind"
		printf 'ahead=%s\n' "$ahead"
		printf 'branch=%s\n' "$branch"
		printf 'upstream=%s\n' "$upstream"
		if [ -n "$reason" ]; then
			printf 'reason=%s\n' "$reason"
		fi
	elif [ -n "$reason" ]; then
		log "Agent-home update status: $status ($reason)"
	else
		log "Agent-home update status: $status"
	fi
}

usage() {
	cat <<'EOF'
Usage: update-agent-home.sh [--check|--pull] [--repo <path>] [--machine]

Options:
  --check      Check for remote commit updates and report status.
  --pull       Fetch and attempt a fast-forward pull if remote commits are available (default).
  --repo PATH  Use PATH as the repo root instead of script location.
  --machine    Output status in key=value lines only.
  --help       Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--check)
		mode="check"
		;;
	--pull)
		mode="pull"
		;;
	--machine)
		machine="true"
		;;
	--repo)
		shift
		repo_root="${1:?--repo requires an argument}"
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		log "Unknown argument: $1"
		usage
		exit 2
		;;
	esac
	shift
done

if ! command -v git >/dev/null 2>&1; then
	emit_status "error" 0 0 "" "" "git is required"
	exit 1
fi

if [ ! -d "$repo_root/.git" ] || ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	emit_status "not_a_repo" 0 0 "" ""
	exit 0
fi

branch="$(git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ -z "$branch" ]; then
	emit_status "detached" 0 0 "$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || true)" ""
	exit 0
fi

upstream="$(git -C "$repo_root" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || true)"
if [ -z "$upstream" ]; then
	emit_status "no_upstream" 0 0 "$branch" ""
	exit 0
fi

if is_truthy "${PI_OFFLINE:-}"; then
	emit_status "offline" 0 0 "$branch" "$upstream" "PI_OFFLINE is set"
	exit 0
fi

upstream_remote="${upstream%%/*}"
if ! git -C "$repo_root" fetch --prune --quiet "$upstream_remote"; then
	emit_status "offline" 0 0 "$branch" "$upstream" "network unavailable while fetching"
	exit 0
fi

behind="$(git -C "$repo_root" rev-list --count "$upstream" --not HEAD 2>/dev/null || echo 0)"
ahead="$(git -C "$repo_root" rev-list --count HEAD --not "$upstream" 2>/dev/null || echo 0)"

status="up_to_date"
if [[ "$behind" -gt 0 && "$ahead" -gt 0 ]]; then
	status="diverged"
elif [[ "$behind" -gt 0 ]]; then
	status="behind"
elif [[ "$ahead" -gt 0 ]]; then
	status="ahead"
fi

if [[ "$mode" == "check" ]]; then
	emit_status "$status" "$behind" "$ahead" "$branch" "$upstream"
	exit 0
fi

if [[ "$status" == "behind" ]]; then
	if ! git -C "$repo_root" diff --quiet --ignore-submodules || ! git -C "$repo_root" diff --cached --quiet --ignore-submodules; then
		emit_status "dirty" "$behind" "$ahead" "$branch" "$upstream" "working tree has tracked changes"
		exit 0
	fi

	pull_args=(pull --ff-only)
	if [[ "$machine" == "true" ]]; then
		pull_args+=(--quiet)
	fi

	if git -C "$repo_root" "${pull_args[@]}"; then
		behind="$(git -C "$repo_root" rev-list --count "$upstream" --not HEAD 2>/dev/null || echo 0)"
		ahead="$(git -C "$repo_root" rev-list --count HEAD --not "$upstream" 2>/dev/null || echo 0)"
		if [[ "$behind" -eq 0 && "$ahead" -eq 0 ]]; then
			emit_status "updated" "$behind" "$ahead" "$branch" "$upstream"
			log "Pulled latest agent-home updates into $repo_root"
			if [ -f "$repo_root/npm/package-lock.json" ] && command -v npm >/dev/null 2>&1; then
				(
					cd "$repo_root/npm"
					npm ci >/dev/null 2>&1
				)
			fi
			exit 0
		fi
		emit_status "update_failed" "$behind" "$ahead" "$branch" "$upstream" "pull did not apply a clean fast-forward"
		exit 0
	fi

	emit_status "update_failed" "$behind" "$ahead" "$branch" "$upstream" "git pull --ff-only failed"
	exit 0
else
	emit_status "$status" "$behind" "$ahead" "$branch" "$upstream"
	exit 0
fi
