#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
timestamp="$(date +%Y%m%d%H%M%S)"

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

# pi package resources that can also be loaded by global discovery.
for src in "$repo_root"/extensions/*.ts; do
  [ -e "$src" ] || continue
  link_one "$src" "$HOME/.pi/agent/extensions/$(basename "$src")"
done

for src in "$repo_root"/skills/*; do
  [ -d "$src" ] || continue
  link_one "$src" "$HOME/.agents/skills/$(basename "$src")"
done

# pi-subagents resources are not part of pi package discovery, so link them explicitly.
for src in "$repo_root"/agents/*.md; do
  [ -e "$src" ] || continue
  link_one "$src" "$HOME/.pi/agent/agents/$(basename "$src")"
done

# Global prompt/context files.
link_one "$repo_root/APPEND_SYSTEM.md" "$HOME/.pi/agent/APPEND_SYSTEM.md"
link_one "$repo_root/SUBAGENTS_ASYNC_PLAYBOOK.md" "$HOME/.pi/agent/SUBAGENTS_ASYNC_PLAYBOOK.md"

echo "Done. Run /reload in pi or restart pi to pick up changes."
