#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$repo_root/scripts/pi-dev.sh"

test_count=0

fail() {
	echo "not ok - $1" >&2
	exit 1
}

pass() {
	test_count=$((test_count + 1))
	echo "ok $test_count - $1"
}

assert_file() {
	[ -e "$1" ] || fail "expected file to exist: $1"
}

assert_symlink_target() {
	local path="$1"
	local target="$2"
	[ -L "$path" ] || fail "expected symlink: $path"
	[ "$(readlink "$path")" = "$target" ] || fail "expected $path -> $target, got $(readlink "$path")"
}

assert_json() {
	local file="$1"
	local expr="$2"
	python3 - "$file" "$expr" <<'PY' || fail "json assertion failed: $expr"
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
expr = sys.argv[2]
data = json.loads(path.read_text())
scope = {"__builtins__": {}, "data": data, "isinstance": isinstance, "dict": dict, "any": any}
if not eval(expr, scope, scope):
    raise SystemExit(1)
PY
}

make_fake_pi() {
	local bin_dir="$1"
	cat >"$bin_dir/pi" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
log="${FAKE_PI_LOG:?}"
echo "$*" >> "$log"
settings="${PI_CODING_AGENT_DIR:?}/settings.json"
mkdir -p "$(dirname "$settings")"
[ -f "$settings" ] || echo '{}' > "$settings"
cmd="${1:-}"
shift || true
case "$cmd" in
  install)
    source="${1:?}"
    python3 - "$settings" "$source" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
source = sys.argv[2]
try:
    data = json.loads(path.read_text())
    if not isinstance(data, dict): data = {}
except Exception:
    data = {}
packages = data.get("packages") or []
if not isinstance(packages, list): packages = []
def src(entry): return entry.get("source") if isinstance(entry, dict) else entry
packages = [entry for entry in packages if src(entry) != source]
packages.append(source)
data["packages"] = packages
path.write_text(json.dumps(data, indent=2) + "\n")
PY
    if [[ "$source" == *"the-color-cyan/cy-pi"* ]]; then
      ref="${source##*@}"
      [ "$ref" != "$source" ] || ref="main"
      checkout="${PI_CODING_AGENT_DIR}/git/cy-pi-${ref//[^A-Za-z0-9_.-]/-}"
      if [ -e "$checkout" ]; then
        exit 0
      fi
      mkdir -p "$checkout/agents" "$checkout/extensions" "$checkout/skills" "$checkout/prompts" "$checkout/themes"
      printf '{"name":"cy-pi"}\n' > "$checkout/package.json"
      printf 'append\n' > "$checkout/APPEND_SYSTEM.md"
      printf 'playbook\n' > "$checkout/SUBAGENTS_ASYNC_PLAYBOOK.md"
      printf 'prompt\n' > "$checkout/commit-message-prompt.md"
    fi
    ;;
  remove)
    ;;
  *)
    ;;
esac
SH
	chmod +x "$bin_dir/pi"
}

with_fixture() {
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' EXIT
	mkdir -p "$tmp/bin" "$tmp/home/.pi/agent" "$tmp/dev/agent"
	export HOME="$tmp/home"
	export PI_SOURCE_AGENT_DIR="$tmp/home/.pi/agent"
	export PI_DEV_AGENT_DIR="$tmp/dev/agent"
	export FAKE_PI_LOG="$tmp/pi.log"
	export PATH="$tmp/bin:$PATH"
	: >"$FAKE_PI_LOG"
	make_fake_pi "$tmp/bin"
}

test_refresh_uses_normal_packages_and_forces_cy_pi_main() {
	with_fixture
	cat >"$PI_SOURCE_AGENT_DIR/settings.json" <<'JSON'
{
  "defaultProvider": "openai-codex",
  "theme": "rose-pine",
  "packages": [
    "npm:pi-subagents",
    {"source":"npm:pi-web-access","enabled":true},
    "git:github.com/the-color-cyan/cy-pi@v0.1.0"
  ],
  "subagents": {"defaultSessionDir":"~/.pi/agent/sessions/subagent", "parallel":{"concurrency":4}}
}
JSON
	cat >"$PI_DEV_AGENT_DIR/settings.json" <<'JSON'
{"packages":["npm:dev-only","git:github.com/the-color-cyan/cy-pi@old"],"subagents":{"defaultSessionDir":"bad"}}
JSON

	"$script" --refresh --no-launch

	assert_json "$PI_DEV_AGENT_DIR/settings.json" "data['defaultProvider'] == 'openai-codex'"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "data['theme'] == 'rose-pine'"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "data['subagents']['defaultSessionDir'] == '~/.pi-dev/agent/sessions/subagent'"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "'npm:dev-only' in [p.get('source') if isinstance(p, dict) else p for p in data['packages']]"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "'npm:pi-subagents' in [p.get('source') if isinstance(p, dict) else p for p in data['packages']]"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "'git:git@github.com:the-color-cyan/cy-pi@main' in [p.get('source') if isinstance(p, dict) else p for p in data['packages']]"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "not any('cy-pi@old' in (p.get('source') if isinstance(p, dict) else p) or 'cy-pi@v0.1.0' in (p.get('source') if isinstance(p, dict) else p) for p in data['packages'])"
	grep -q '^install npm:pi-subagents$' "$FAKE_PI_LOG" || fail "third-party package was not installed"
	grep -q '^install git:git@github.com:the-color-cyan/cy-pi@main$' "$FAKE_PI_LOG" || fail "cy-pi main was not installed"
	assert_symlink_target "$PI_DEV_AGENT_DIR/agents" "$PI_DEV_AGENT_DIR/git/cy-pi-main/agents"
	[ ! -L "$PI_DEV_AGENT_DIR/extensions" ] || fail "package mode should not symlink package-discovered resources"
	pass "refresh uses normal packages and forces cy-pi main"
}

test_refresh_replaces_stale_cy_pi_checkout() {
	with_fixture
	echo '{"packages":[]}' >"$PI_SOURCE_AGENT_DIR/settings.json"
	mkdir -p "$PI_DEV_AGENT_DIR/git/cy-pi-main/agents"
	printf '{"name":"cy-pi"}\n' >"$PI_DEV_AGENT_DIR/git/cy-pi-main/package.json"
	echo stale >"$PI_DEV_AGENT_DIR/git/cy-pi-main/OLD_REF"

	"$script" --refresh --no-launch

	[ ! -e "$PI_DEV_AGENT_DIR/git/cy-pi-main/OLD_REF" ] || fail "stale cy-pi checkout was reused"
	assert_symlink_target "$PI_DEV_AGENT_DIR/agents" "$PI_DEV_AGENT_DIR/git/cy-pi-main/agents"
	pass "refresh replaces stale cy-pi checkout"
}

test_local_refresh_uses_checkout_symlinks_and_removes_cy_pi_packages() {
	with_fixture
	cat >"$PI_SOURCE_AGENT_DIR/settings.json" <<'JSON'
{"packages":["npm:pi-subagents","git:github.com/the-color-cyan/cy-pi@v0.1.0"]}
JSON
	"$script" --local --refresh --no-launch

	assert_json "$PI_DEV_AGENT_DIR/settings.json" "not any('the-color-cyan/cy-pi' in (p.get('source') if isinstance(p, dict) else p) for p in data.get('packages', []))"
	assert_symlink_target "$PI_DEV_AGENT_DIR/extensions" "$repo_root/extensions"
	assert_symlink_target "$PI_DEV_AGENT_DIR/APPEND_SYSTEM.md" "$repo_root/APPEND_SYSTEM.md"
	pass "local refresh uses checkout symlinks and removes cy-pi packages"
}

test_local_refresh_backs_up_existing_resource_directories() {
	with_fixture
	echo '{"packages":[]}' >"$PI_SOURCE_AGENT_DIR/settings.json"
	mkdir -p "$PI_DEV_AGENT_DIR/extensions"
	echo user-data >"$PI_DEV_AGENT_DIR/extensions/custom.txt"

	"$script" --local --refresh --no-launch

	assert_symlink_target "$PI_DEV_AGENT_DIR/extensions" "$repo_root/extensions"
	backup_file="$(find "$PI_DEV_AGENT_DIR" -maxdepth 2 -path "$PI_DEV_AGENT_DIR/extensions.backup.*/custom.txt" -print -quit)"
	[ -n "$backup_file" ] || fail "existing resource directory was not backed up"
	grep -q user-data "$backup_file" || fail "backup did not preserve existing resource contents"
	pass "local refresh backs up existing resource directories"
}

test_copy_auth_is_explicit() {
	with_fixture
	echo '{"packages":[]}' >"$PI_SOURCE_AGENT_DIR/settings.json"
	echo secret >"$PI_SOURCE_AGENT_DIR/auth.json"
	"$script" --refresh --no-launch
	[ ! -e "$PI_DEV_AGENT_DIR/auth.json" ] || fail "auth copied without --copy-auth"
	"$script" --refresh --copy-auth --no-launch
	assert_file "$PI_DEV_AGENT_DIR/auth.json"
	mode="$(
		python3 - "$PI_DEV_AGENT_DIR/auth.json" <<'PY'
import os, stat, sys
print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))
PY
	)"
	[ "$mode" = "0o600" ] || fail "auth mode should be 600, got $mode"
	pass "copy auth is explicit"
}

test_refresh_fails_on_invalid_dev_settings() {
	with_fixture
	echo '{"packages":[]}' >"$PI_SOURCE_AGENT_DIR/settings.json"
	echo '{invalid json' >"$PI_DEV_AGENT_DIR/settings.json"

	if "$script" --refresh --no-launch >"$tmp/out" 2>"$tmp/err"; then
		fail "refresh succeeded with invalid dev settings"
	fi
	grep -qi 'invalid' "$tmp/err" || fail "invalid settings error was not explained"
	grep -q '{invalid json' "$PI_DEV_AGENT_DIR/settings.json" || fail "invalid dev settings were clobbered"
	pass "refresh fails on invalid dev settings"
}

test_reset_refresh_archives_and_prunes_old_backups() {
	with_fixture
	echo '{"packages":[]}' >"$PI_SOURCE_AGENT_DIR/settings.json"
	echo current >"$PI_DEV_AGENT_DIR/current.txt"
	for i in $(seq -w 1 12); do
		mkdir -p "$tmp/dev/agent.backup.202401010000$i"
	done
	ln -s "$tmp/dev/missing-backup-target" "$tmp/dev/agent.backup.broken-symlink"

	"$script" --reset-refresh --no-launch

	[ ! -e "$PI_DEV_AGENT_DIR/current.txt" ] || fail "dev home was not rebuilt"
	backup_count=$(find "$tmp/dev" -maxdepth 1 -type d -name 'agent.backup.*' | wc -l | tr -d ' ')
	[ "$backup_count" -le 10 ] || fail "expected at most 10 backups, got $backup_count"
	[ ! -L "$tmp/dev/agent.backup.broken-symlink" ] || fail "broken backup symlink was not cleaned up"
	archived_current="$(find "$tmp/dev" -maxdepth 2 -path "$tmp/dev/agent.backup.*/current.txt" -print -quit)"
	[ -n "$archived_current" ] || fail "backup created by reset was pruned"
	grep -q current "$archived_current" || fail "backup created by reset did not preserve dev home"
	pass "reset refresh archives and prunes old backups"
}

test_plain_launch_passes_args_without_refreshing() {
	with_fixture
	echo '{}' >"$PI_DEV_AGENT_DIR/settings.json"
	"$script" --model k2p6 --cwd /tmp/example

	grep -q '^--model k2p6 --cwd /tmp/example$' "$FAKE_PI_LOG" || fail "pi args not passed through"
	[ "$(wc -l <"$FAKE_PI_LOG" | tr -d ' ')" = "1" ] || fail "plain launch performed extra pi operations"
	pass "plain launch passes args without refreshing"
}

test_plain_launch_does_not_copy_normal_settings() {
	with_fixture
	cat >"$PI_SOURCE_AGENT_DIR/settings.json" <<'JSON'
{"packages":["npm:normal-only"],"theme":"normal-theme"}
JSON
	rm -f "$PI_DEV_AGENT_DIR/settings.json"

	"$script" --model k2p6

	grep -q '^--model k2p6$' "$FAKE_PI_LOG" || fail "pi args not passed through for empty dev home"
	assert_json "$PI_DEV_AGENT_DIR/settings.json" "data == {}"
	pass "plain launch does not copy normal settings"
}

test_refresh_uses_env_cy_pi_source_override() {
	with_fixture
	echo '{"packages":[]}' >"$PI_SOURCE_AGENT_DIR/settings.json"
	CY_PI_DEV_SOURCE='git:git@github.com:the-color-cyan/cy-pi@feature' "$script" --refresh --no-launch
	grep -q '^install git:git@github.com:the-color-cyan/cy-pi@feature$' "$FAKE_PI_LOG" || fail "env cy-pi source override was not installed"
	assert_symlink_target "$PI_DEV_AGENT_DIR/agents" "$PI_DEV_AGENT_DIR/git/cy-pi-feature/agents"
	pass "refresh uses env cy-pi source override"
}

test_refresh_uses_normal_packages_and_forces_cy_pi_main
test_refresh_replaces_stale_cy_pi_checkout
test_local_refresh_uses_checkout_symlinks_and_removes_cy_pi_packages
test_local_refresh_backs_up_existing_resource_directories
test_copy_auth_is_explicit
test_refresh_fails_on_invalid_dev_settings
test_reset_refresh_archives_and_prunes_old_backups
test_plain_launch_passes_args_without_refreshing
test_plain_launch_does_not_copy_normal_settings
test_refresh_uses_env_cy_pi_source_override

echo "1..$test_count"
