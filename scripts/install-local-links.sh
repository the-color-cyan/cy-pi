#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
timestamp="$(date +%Y%m%d%H%M%S)"
package_resource_mode="auto"

usage() {
  cat <<'EOF'
Usage: scripts/install-local-links.sh [--package-resources|--no-package-resources]

By default, package resources (extensions, skills, prompts, themes) are linked only
when this checkout does not appear to be installed as a pi package. If it is
installed via `pi install`, those repo-owned links are removed to avoid duplicate
resource/skill conflicts. Non-package resources are always linked.

Options:
  --package-resources     Force linking extensions/skills for direct local discovery
  --no-package-resources  Remove repo-owned extension/skill links; use pi package loading
  -h, --help              Show this help
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --package-resources)
      package_resource_mode="yes"
      ;;
    --no-package-resources)
      package_resource_mode="no"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

backup_if_needed() {
  local dest="$1"
  local src="$2"

  if [ ! -e "$dest" ] && [ ! -L "$dest" ]; then
    return 0
  fi

  if [ -L "$dest" ]; then
    local current
    current="$(readlink "$dest")"
    if [ "$current" = "$src" ]; then
      return 0
    fi
  fi

  mv "$dest" "$dest.backup.$timestamp"
}

link_one() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  backup_if_needed "$dest" "$src"
  ln -sfn "$src" "$dest"
  echo "linked $dest -> $src"
}

remove_repo_link() {
  local dest="$1"
  if [ ! -L "$dest" ]; then
    return 0
  fi

  local current
  current="$(readlink "$dest")"
  case "$current" in
    "$repo_root"/*)
      rm "$dest"
      echo "removed duplicate repo link $dest"
      ;;
  esac
}

repo_appears_installed_package() {
  # `pi list` prints resolved package paths, which covers local, git, and npm
  # installs. Fall back to a light settings check for local path installs.
  if command -v pi >/dev/null 2>&1; then
    local package_list
    package_list="$(pi list 2>/dev/null || true)"
    if printf '%s\n' "$package_list" | grep -F -q "$repo_root"; then
      return 0
    fi
    # Git/npm installs resolve to pi's package cache rather than this checkout.
    # The installed directory normally keeps the package.json name as the final
    # path segment, so treat an installed pi-agent package as equivalent.
    if printf '%s\n' "$package_list" | grep -E -q '(^|/)pi-agent($|[[:space:]])'; then
      return 0
    fi
  fi

  python3 - "$repo_root" <<'PY'
import json, os, pathlib, sys
repo = pathlib.Path(sys.argv[1]).resolve()
settings_files = [
    pathlib.Path.home() / ".pi" / "agent" / "settings.json",
    repo / ".pi" / "settings.json",
]
for settings in settings_files:
    try:
        data = json.loads(settings.read_text())
    except Exception:
        continue
    for package in data.get("packages", []) or []:
        source = package.get("source") if isinstance(package, dict) else package
        if not isinstance(source, str):
            continue
        if source.startswith(("/", "./", "../")):
            try:
                base = settings.parent
                resolved = pathlib.Path(source)
                if not resolved.is_absolute():
                    resolved = base / resolved
                if resolved.resolve() == repo:
                    raise SystemExit(0)
            except SystemExit:
                raise
            except Exception:
                pass
raise SystemExit(1)
PY
}

link_package_resources="yes"
if [ "$package_resource_mode" = "yes" ]; then
  link_package_resources="yes"
elif [ "$package_resource_mode" = "no" ]; then
  link_package_resources="no"
elif repo_appears_installed_package; then
  link_package_resources="no"
else
  link_package_resources="yes"
fi

if [ "$link_package_resources" = "yes" ]; then
  echo "Linking package resources for direct local discovery."

  for src in "$repo_root"/extensions/*.ts; do
    [ -e "$src" ] || continue
    link_one "$src" "$HOME/.pi/agent/extensions/$(basename "$src")"
  done

  for src in "$repo_root"/skills/*; do
    [ -d "$src" ] || continue
    link_one "$src" "$HOME/.agents/skills/$(basename "$src")"
  done
else
  echo "Using pi package discovery for extensions/skills; removing duplicate repo-owned global links."

  for src in "$repo_root"/extensions/*.ts; do
    [ -e "$src" ] || continue
    remove_repo_link "$HOME/.pi/agent/extensions/$(basename "$src")"
  done

  for src in "$repo_root"/skills/*; do
    [ -d "$src" ] || continue
    remove_repo_link "$HOME/.agents/skills/$(basename "$src")"
  done
fi

# pi-subagents resources are not part of pi package discovery, so link them explicitly.
for src in "$repo_root"/agents/*.md; do
  [ -e "$src" ] || continue
  link_one "$src" "$HOME/.pi/agent/agents/$(basename "$src")"
done

# Global prompt/context files.
link_one "$repo_root/APPEND_SYSTEM.md" "$HOME/.pi/agent/APPEND_SYSTEM.md"
link_one "$repo_root/SUBAGENTS_ASYNC_PLAYBOOK.md" "$HOME/.pi/agent/SUBAGENTS_ASYNC_PLAYBOOK.md"

echo "Done. Run /reload in pi or restart pi to pick up changes."
