#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PI_CODING_AGENT_DIR="${PI_CODING_AGENT_DIR:-$repo_root}"
exec pi "$@"
