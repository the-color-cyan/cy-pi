#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev_agent_dir="${PI_DEV_AGENT_DIR:-$HOME/.pi-dev/agent}"
source_agent_dir="${PI_SOURCE_AGENT_DIR:-$HOME/.pi/agent}"
cy_pi_source="${CY_PI_DEV_SOURCE:-git:git@github.com:the-color-cyan/cy-pi@main}"
backup_keep_count="${PI_DEV_BACKUP_KEEP_COUNT:-10}"
backup_max_days="${PI_DEV_BACKUP_MAX_DAYS:-30}"

refresh="no"
reset_refresh="no"
copy_auth="no"
launch="yes"
local_mode="no"
pi_args=()

usage() {
	cat <<'EOF'
Usage: scripts/pi-dev.sh [pi-dev options] [--] [pi args...]

Launch an isolated Pi dev home at ~/.pi-dev/agent. Plain launch does not mutate
packages or settings. Use --refresh to make dev match normal Pi settings/packages
while forcing cy-pi to the selected dev source.

Options:
  --refresh        Merge normal Pi settings/packages into dev and force cy-pi@main
  --reset-refresh  Archive/rebuild the dev home, then refresh
  --local          Use this checkout via symlinks instead of installing cy-pi@main
  --copy-auth      Explicitly copy normal ~/.pi/agent/auth.json into dev
  --no-launch      Refresh/reset only; do not launch pi afterwards
  -h, --help       Show this help

Environment:
  CY_PI_DEV_SOURCE       cy-pi package source for package mode
                         default: git:git@github.com:the-color-cyan/cy-pi@main
  PI_DEV_AGENT_DIR       dev Pi home, default: ~/.pi-dev/agent
  PI_SOURCE_AGENT_DIR    normal Pi home, default: ~/.pi/agent

Examples:
  scripts/pi-dev.sh
  scripts/pi-dev.sh --refresh
  scripts/pi-dev.sh --refresh --model k2p6
  scripts/pi-dev.sh --local --refresh --no-launch
EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--refresh)
		refresh="yes"
		;;
	--reset-refresh)
		reset_refresh="yes"
		refresh="yes"
		;;
	--copy-auth)
		copy_auth="yes"
		;;
	--no-launch)
		launch="no"
		;;
	--local)
		local_mode="yes"
		;;
	-h | --help)
		usage
		exit 0
		;;
	--)
		shift
		pi_args+=("$@")
		break
		;;
	*)
		pi_args+=("$1")
		;;
	esac
	shift
done

ensure_settings() {
	mkdir -p "$dev_agent_dir" "$dev_agent_dir/sessions"
	if [ ! -f "$dev_agent_dir/settings.json" ]; then
		if [ -f "$source_agent_dir/settings.json" ]; then
			cp -p "$source_agent_dir/settings.json" "$dev_agent_dir/settings.json"
		else
			printf '{}\n' >"$dev_agent_dir/settings.json"
		fi
	fi
}

archive_dev_home() {
	if [ ! -e "$dev_agent_dir" ] && [ ! -L "$dev_agent_dir" ]; then
		return 0
	fi
	local parent base timestamp backup
	parent="$(dirname "$dev_agent_dir")"
	base="$(basename "$dev_agent_dir")"
	timestamp="$(date +%Y%m%d%H%M%S)"
	backup="$parent/$base.backup.$timestamp"
	mkdir -p "$parent"
	mv "$dev_agent_dir" "$backup"
	echo "archived $dev_agent_dir -> $backup"
	cleanup_backups "$backup"
}

cleanup_backups() {
	local just_created="${1:-}"
	local parent base
	parent="$(dirname "$dev_agent_dir")"
	base="$(basename "$dev_agent_dir")"
	python3 - "$parent" "$base" "$backup_keep_count" "$backup_max_days" "$just_created" <<'PY'
import pathlib, sys, time, shutil
parent = pathlib.Path(sys.argv[1])
base = sys.argv[2]
keep = int(sys.argv[3])
max_days = int(sys.argv[4])
just = pathlib.Path(sys.argv[5]).absolute() if sys.argv[5] else None
now = time.time()
backups = sorted(parent.glob(f"{base}.backup.*"), key=lambda p: p.lstat().st_mtime, reverse=True)
keep_set = set()
if just is not None and any(p.absolute() == just for p in backups):
    keep_set.add(just)
remaining_slots = max(0, keep - len(keep_set))
for p in backups:
    identity = p.absolute()
    if identity in keep_set:
        continue
    if remaining_slots > 0:
        keep_set.add(identity)
        remaining_slots -= 1
for p in backups:
    identity = p.absolute()
    if just is not None and identity == just:
        continue
    too_old = max_days >= 0 and (now - p.lstat().st_mtime) > max_days * 86400
    too_many = identity not in keep_set
    broken_symlink = p.is_symlink() and not p.exists()
    if too_old or too_many or broken_symlink:
        if p.is_symlink():
            p.unlink()
        elif p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()
        print(f"removed old backup {p}")
PY
}

copy_auth_if_requested() {
	if [ "$copy_auth" != "yes" ]; then
		return 0
	fi
	if [ -f "$source_agent_dir/auth.json" ]; then
		mkdir -p "$dev_agent_dir"
		cp -p "$source_agent_dir/auth.json" "$dev_agent_dir/auth.json"
		chmod 600 "$dev_agent_dir/auth.json" || true
		echo "copied auth.json from $source_agent_dir"
	else
		echo "warning: --copy-auth requested but $source_agent_dir/auth.json was not found" >&2
	fi
}

merge_settings() {
	mkdir -p "$dev_agent_dir"
	local source_settings="$source_agent_dir/settings.json"
	local empty_source="$dev_agent_dir/.empty-source-settings.json"
	if [ ! -f "$source_settings" ]; then
		printf '{}\n' >"$empty_source"
		source_settings="$empty_source"
	fi
	[ -f "$dev_agent_dir/settings.json" ] || printf '{}\n' >"$dev_agent_dir/settings.json"
	python3 - "$repo_root" "$source_settings" "$dev_agent_dir/settings.json" <<'PY'
import copy, json, pathlib, sys
repo = pathlib.Path(sys.argv[1]).resolve()
source_path = pathlib.Path(sys.argv[2])
dev_path = pathlib.Path(sys.argv[3])

def read_json(path, *, required=False):
    try:
        data = json.loads(path.read_text())
    except Exception as exc:
        if required:
            print(f"error: invalid JSON in {path}: {exc}", file=sys.stderr)
            raise SystemExit(1)
        return {}
    if not isinstance(data, dict):
        if required:
            print(f"error: invalid settings shape in {path}: expected JSON object", file=sys.stderr)
            raise SystemExit(1)
        return {}
    return data

def source_of(entry):
    return entry.get("source") if isinstance(entry, dict) else entry

def is_cy_pi_source(source, repo=None, settings=None):
    if not isinstance(source, str) or not source:
        return False
    lower = source.lower().rstrip("/")
    normalized = lower.replace(":", "/")
    if normalized.endswith(".git"):
        normalized = normalized[:-4]
    if "github.com/the-color-cyan/cy-pi" in normalized:
        return True
    if normalized.endswith("/cy-pi") or normalized in {"cy-pi", "npm/cy-pi", "npm/cy-pi@latest"}:
        return True
    if repo is not None and source.startswith(("/", "./", "../")):
        try:
            path = pathlib.Path(source)
            if not path.is_absolute() and settings is not None:
                path = settings.parent / path
            resolved = path.resolve()
            if resolved == repo:
                return True
            parts = set(resolved.parts)
            if resolved.name == "cy-pi" and ".pi" in parts and "git" in parts:
                return True
        except Exception:
            pass
    return False

source = read_json(source_path)
dev = read_json(dev_path, required=True)

# Copy normal runtime preferences, while preserving dev-only package additions.
for key, value in source.items():
    if key in {"packages"}:
        continue
    dev[key] = copy.deepcopy(value)

source_packages = source.get("packages") if isinstance(source.get("packages"), list) else []
dev_packages = dev.get("packages") if isinstance(dev.get("packages"), list) else []
merged = []
seen = set()

def add(entry):
    src = source_of(entry)
    if isinstance(src, str) and is_cy_pi_source(src, repo, dev_path):
        return
    key = src if isinstance(src, str) else json.dumps(entry, sort_keys=True, default=str)
    if key in seen:
        return
    seen.add(key)
    merged.append(copy.deepcopy(entry))

for entry in dev_packages:
    add(entry)
for entry in source_packages:
    add(entry)

dev["packages"] = merged
subagents = dev.get("subagents")
if not isinstance(subagents, dict):
    subagents = {}
subagents["defaultSessionDir"] = "~/.pi-dev/agent/sessions/subagent"
dev["subagents"] = subagents

dev_path.write_text(json.dumps(dev, indent=2) + "\n")
PY
	rm -f "$dev_agent_dir/.empty-source-settings.json"
}

remove_cy_pi_packages() {
	[ -f "$dev_agent_dir/settings.json" ] || printf '{}\n' >"$dev_agent_dir/settings.json"
	python3 - "$repo_root" "$dev_agent_dir/settings.json" <<'PY'
import json, pathlib, sys
repo = pathlib.Path(sys.argv[1]).resolve()
settings = pathlib.Path(sys.argv[2])
try:
    data = json.loads(settings.read_text())
    if not isinstance(data, dict): data = {}
except Exception:
    data = {}

def source_of(entry):
    return entry.get("source") if isinstance(entry, dict) else entry

def is_cy_pi_source(source, repo=None, settings=None):
    if not isinstance(source, str) or not source:
        return False
    lower = source.lower().rstrip("/")
    normalized = lower.replace(":", "/")
    if normalized.endswith(".git"):
        normalized = normalized[:-4]
    if "github.com/the-color-cyan/cy-pi" in normalized:
        return True
    if normalized.endswith("/cy-pi") or normalized in {"cy-pi", "npm/cy-pi", "npm/cy-pi@latest"}:
        return True
    if repo is not None and source.startswith(("/", "./", "../")):
        try:
            path = pathlib.Path(source)
            if not path.is_absolute() and settings is not None:
                path = settings.parent / path
            resolved = path.resolve()
            if resolved == repo:
                return True
            parts = set(resolved.parts)
            if resolved.name == "cy-pi" and ".pi" in parts and "git" in parts:
                return True
        except Exception:
            pass
    return False

packages = data.get("packages") if isinstance(data.get("packages"), list) else []
data["packages"] = [p for p in packages if not is_cy_pi_source(source_of(p), repo, settings)]
settings.write_text(json.dumps(data, indent=2) + "\n")
PY
}

normal_package_sources() {
	local source_settings="$source_agent_dir/settings.json"
	[ -f "$source_settings" ] || return 0
	python3 - "$repo_root" "$source_settings" <<'PY'
import json, pathlib, sys
repo = pathlib.Path(sys.argv[1]).resolve()
settings = pathlib.Path(sys.argv[2])
try:
    data = json.loads(settings.read_text())
except Exception:
    data = {}

def source_of(entry):
    return entry.get("source") if isinstance(entry, dict) else entry

def is_cy_pi_source(source):
    if not isinstance(source, str) or not source:
        return False
    lower = source.lower().rstrip("/")
    normalized = lower.replace(":", "/")
    if normalized.endswith(".git"):
        normalized = normalized[:-4]
    if "github.com/the-color-cyan/cy-pi" in normalized:
        return True
    if normalized.endswith("/cy-pi") or normalized in {"cy-pi", "npm/cy-pi", "npm/cy-pi@latest"}:
        return True
    if source.startswith(("/", "./", "../")):
        try:
            path = pathlib.Path(source)
            if not path.is_absolute():
                path = settings.parent / path
            if path.resolve() == repo:
                return True
        except Exception:
            pass
    return False

for entry in data.get("packages", []) if isinstance(data.get("packages"), list) else []:
    src = source_of(entry)
    if isinstance(src, str) and src and not is_cy_pi_source(src):
        print(src)
PY
}

run_dev_pi() {
	PI_CODING_AGENT_DIR="$dev_agent_dir" command pi "$@"
}

install_normal_packages() {
	local package
	while IFS= read -r package; do
		[ -n "$package" ] || continue
		echo "Installing dev package $package"
		run_dev_pi install "$package"
	done < <(normal_package_sources)
}

cleanup_cy_pi_links() {
	local dest
	for dest in \
		"$dev_agent_dir/extensions" \
		"$dev_agent_dir/skills" \
		"$dev_agent_dir/prompts" \
		"$dev_agent_dir/themes" \
		"$dev_agent_dir/agents" \
		"$dev_agent_dir/APPEND_SYSTEM.md" \
		"$dev_agent_dir/SUBAGENTS_ASYNC_PLAYBOOK.md" \
		"$dev_agent_dir/commit-message-prompt.md"; do
		if [ -L "$dest" ]; then
			rm "$dest"
		fi
	done
}

backup_existing_resource() {
	local dest="$1"
	local backup timestamp counter
	timestamp="$(date +%Y%m%d%H%M%S)"
	backup="$dest.backup.$timestamp"
	counter=1
	while [ -e "$backup" ] || [ -L "$backup" ]; do
		backup="$dest.backup.$timestamp.$counter"
		counter=$((counter + 1))
	done
	mv "$dest" "$backup"
	echo "backed up existing $dest -> $backup"
}

link_one() {
	local src="$1"
	local dest="$2"
	if [ ! -e "$src" ]; then
		echo "warning: missing cy-pi resource $src" >&2
		return 0
	fi
	mkdir -p "$(dirname "$dest")"
	if [ -L "$dest" ]; then
		rm "$dest"
	elif [ -e "$dest" ]; then
		backup_existing_resource "$dest"
	fi
	ln -s "$src" "$dest"
	echo "linked $dest -> $src"
}

link_cy_pi_resources_from() {
	local src_root="$1"
	local include_package_resources="${2:-no}"
	cleanup_cy_pi_links
	if [ "$include_package_resources" = "yes" ]; then
		for dir in extensions skills prompts themes; do
			if [ -d "$src_root/$dir" ]; then
				link_one "$src_root/$dir" "$dev_agent_dir/$dir"
			fi
		done
	fi
	if [ -d "$src_root/agents" ]; then
		link_one "$src_root/agents" "$dev_agent_dir/agents"
	fi
	for file in APPEND_SYSTEM.md SUBAGENTS_ASYNC_PLAYBOOK.md commit-message-prompt.md; do
		if [ -e "$src_root/$file" ]; then
			link_one "$src_root/$file" "$dev_agent_dir/$file"
		fi
	done
}

find_installed_cy_pi() {
	python3 - "$dev_agent_dir" "$cy_pi_source" <<'PY'
import json, pathlib, subprocess, sys
agent = pathlib.Path(sys.argv[1])
wanted = sys.argv[2]
settings = agent / "settings.json"
paths = []
try:
    data = json.loads(settings.read_text())
except Exception:
    data = {}
for entry in data.get("packages", []) if isinstance(data.get("packages"), list) else []:
    if isinstance(entry, dict):
        for key in ("path", "dir", "directory", "installPath", "resolvedPath"):
            value = entry.get(key)
            if isinstance(value, str):
                paths.append(pathlib.Path(value).expanduser())
for path in paths:
    if (path / "package.json").exists():
        try:
            pkg = json.loads((path / "package.json").read_text())
            if pkg.get("name") == "cy-pi":
                print(path)
                raise SystemExit(0)
        except SystemExit:
            raise
        except Exception:
            pass
root = agent / "git"
if root.exists():
    for pkg_path in root.rglob("package.json"):
        try:
            pkg = json.loads(pkg_path.read_text())
            if pkg.get("name") != "cy-pi":
                continue
            repo = pkg_path.parent
            remote_ok = True
            git_dir = repo / ".git"
            if git_dir.exists():
                try:
                    remote = subprocess.check_output(["git", "-C", str(repo), "remote", "get-url", "origin"], text=True, stderr=subprocess.DEVNULL).strip()
                    remote_ok = "the-color-cyan/cy-pi" in remote.replace(":", "/")
                except Exception:
                    remote_ok = True
            if remote_ok:
                print(repo)
                raise SystemExit(0)
        except SystemExit:
            raise
        except Exception:
            pass
raise SystemExit(1)
PY
}

remove_installed_cy_pi_checkouts() {
	python3 - "$dev_agent_dir" <<'PY'
import json, pathlib, shutil, sys
agent = pathlib.Path(sys.argv[1]).resolve()
root = agent / "git"
if not root.exists():
    raise SystemExit(0)
for pkg_path in list(root.rglob("package.json")):
    try:
        repo = pkg_path.parent.resolve()
        if root.resolve() not in repo.parents and repo != root.resolve():
            continue
        pkg = json.loads(pkg_path.read_text())
        if pkg.get("name") != "cy-pi":
            continue
        if repo.is_dir() and not repo.is_symlink():
            shutil.rmtree(repo)
            print(f"removed stale cy-pi checkout {repo}")
        elif repo.exists() or repo.is_symlink():
            repo.unlink()
            print(f"removed stale cy-pi checkout {repo}")
    except Exception as exc:
        print(f"warning: failed to inspect/remove {pkg_path}: {exc}", file=sys.stderr)
PY
}

refresh_package_mode() {
	merge_settings
	remove_cy_pi_packages
	cleanup_cy_pi_links
	install_normal_packages
	remove_installed_cy_pi_checkouts
	echo "Installing dev cy-pi package $cy_pi_source"
	run_dev_pi install "$cy_pi_source"
	local checkout
	if checkout="$(find_installed_cy_pi)"; then
		link_cy_pi_resources_from "$checkout" no
	else
		echo "warning: installed cy-pi checkout not found; skipped linking agents/global prompts" >&2
	fi
}

refresh_local_mode() {
	merge_settings
	remove_cy_pi_packages
	install_normal_packages
	link_cy_pi_resources_from "$repo_root" yes
}

if [ "$reset_refresh" = "yes" ]; then
	archive_dev_home
fi

if [ "$refresh" = "yes" ]; then
	mkdir -p "$dev_agent_dir" "$dev_agent_dir/sessions"
	ensure_settings

	if [ "$local_mode" = "yes" ]; then
		refresh_local_mode
	else
		refresh_package_mode
	fi
fi

if [ "$copy_auth" = "yes" ]; then
	mkdir -p "$dev_agent_dir"
fi
copy_auth_if_requested

if [ "$launch" = "yes" ]; then
	run_dev_pi "${pi_args[@]}"
fi
