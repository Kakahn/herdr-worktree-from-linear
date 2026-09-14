#!/usr/bin/env python3
"""Prepare registered Git worktrees. Never execute repository-owned code."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


class SetupError(Exception):
    pass


def git(root, *args, check=True):
    env = os.environ.copy()
    # A hook must not inherit another repository's Git routing.
    for key in list(env):
        if key.startswith("GIT_"):
            env.pop(key)
    result = subprocess.run(["git", "-C", str(root), *args], env=env,
                            text=True, capture_output=True)
    if check and result.returncode:
        raise SetupError("Git could not verify this repository: " + str(root))
    return result


def common(root):
    return Path(git(root, "rev-parse", "--path-format=absolute",
                    "--git-common-dir").stdout.strip()).resolve()


def relative(value):
    p = Path(value)
    if p.is_absolute() or not p.parts or ".." in p.parts or ".git" in p.parts:
        raise SetupError("Invalid rule path: " + str(value))
    return p


def no_link_parents(root, rel):
    current = root
    for part in relative(str(rel)).parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise SetupError("Symlink parent directory rejected: " + str(current))


def ignored_untracked(root, rel):
    if git(root, "ls-files", "--", str(rel)).stdout.strip():
        raise SetupError("Destination is tracked by Git; preparation refused: " + str(rel))
    if git(root, "check-ignore", "-q", "--", str(rel), check=False).returncode != 0:
        raise SetupError("Add a .gitignore rule before preparing: " + str(rel))


def event_target(value):
    """Read only explicit worktree provenance, never the focused pane's cwd."""
    if not isinstance(value, dict):
        return None
    wt = value.get("worktree")
    if isinstance(wt, dict):
        path = wt.get("checkout_path") or wt.get("path")
        if path:
            return path
    for key in ("event", "data", "payload", "workspace"):
        found = event_target(value.get(key))
        if found:
            return found
    return None


def target_from_herdr():
    event = os.environ.get("HERDR_PLUGIN_EVENT")
    context = json.loads(os.environ.get("HERDR_PLUGIN_CONTEXT_JSON", "{}"))
    if event:
        if event not in ("worktree.created", "worktree.opened"):
            raise SetupError("Unsupported event: " + event)
        payload = json.loads(os.environ.get("HERDR_PLUGIN_EVENT_JSON", "{}"))
        target = event_target(payload)
        # Herdr also supplies the event workspace's worktree provenance.
        target = target or event_target(context)
    else:
        target = event_target(context) or context.get("workspace_cwd")
    if not target:
        raise SetupError("No explicit worktree. Use --worktree PATH.")
    if not Path(target).is_absolute():
        raise SetupError("Herdr must provide an absolute path.")
    return target


def prepare(target, machine, rules, dry_run=False, require_configured=False):
    target = Path(target).expanduser().resolve(strict=True)
    top = Path(git(target, "rev-parse", "--show-toplevel").stdout.strip()).resolve()
    target = top
    identity = common(target)
    matched = None
    for name, location in machine.get("repositories", {}).items():
        if name not in rules["repositories"]:
            continue
        source = Path(location).expanduser().resolve()
        if not source.is_dir():
            continue
        if common(source) == identity:
            matched = (name, source)
            break
    if matched is None:
        if require_configured:
            raise SetupError("Repository missing from machine settings. Configure repository paths before continuing.")
        print("SKIPPED: repository is not configured.")
        return
    name, source = matched
    # Reject the primary checkout even when the configured source is another checkout.
    records = git(target, "worktree", "list", "--porcelain", "-z").stdout.split("\0")
    paths = [Path(v[9:]).resolve() for v in records if v.startswith("worktree ")]
    if target not in paths:
        raise SetupError("Worktree is not registered in Git.")
    if target == source or (paths and target == paths[0]):
        print("SKIPPED: reference/main checkout; no copies needed.")
        return
    rule = rules["repositories"][name]
    operations = []
    errors = []
    for item in rule.get("copies", []):
        rel = relative(item["path"])
        scope = relative(item["whenDirectory"])
        no_link_parents(target, scope / "sentinel")
        if not (target / scope).is_dir():
            print("NOT IN THIS BRANCH: " + str(scope))
            continue
        no_link_parents(target, rel)
        dest, origin = target / rel, source / rel
        ignored_untracked(target, rel)
        if dest.is_symlink():
            raise SetupError("Target .env is a symlink: " + str(rel))
        if dest.exists():
            if not dest.is_file():
                raise SetupError("Destination is not a regular file: " + str(rel))
            print("PRESERVED: " + str(rel))
            continue
        no_link_parents(source, rel)
        if origin.is_symlink() or not origin.is_file():
            errors.append("Source file is missing or a symlink: " + str(origin))
            continue
        operations.append(("copy", origin, dest))
    for name in rule.get("links", []):
        rel = relative(name)
        origin, dest = source / rel, target / rel
        no_link_parents(source, rel)
        if not origin.is_dir():
            print("OPTIONAL RESOURCE MISSING: " + str(rel))
            continue
        if origin.is_symlink():
            raise SetupError("Symlink source resource rejected: " + str(rel))
        no_link_parents(target, rel)
        ignored_untracked(target, rel)
        if os.path.lexists(dest):
            if dest.is_symlink() and dest.resolve() == origin.resolve():
                print("LINK ALREADY PRESENT: " + str(rel))
            else:
                print("PRESERVED (existing local resource): " + str(rel))
            continue
        operations.append(("link", origin, dest))
    if errors:
        raise SetupError("\n".join(errors))
    for kind, origin, dest in operations:
        print(("WOULD PREPARE" if dry_run else "PREPARING") + " : " + str(dest.relative_to(target)))
        if dry_run:
            continue
        no_link_parents(target, dest.relative_to(target))
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            if kind == "link":
                dest.symlink_to(origin, target_is_directory=True)
            else:
                # Publish a complete private file atomically without replacing anything.
                fd, temporary = tempfile.mkstemp(prefix=".worktree-env-", dir=dest.parent)
                try:
                    with os.fdopen(fd, "wb") as output, origin.open("rb") as input_file:
                        shutil.copyfileobj(input_file, output)
                    os.link(temporary, dest)
                finally:
                    os.unlink(temporary)
        except FileExistsError:
            raise SetupError("Destination created concurrently; run the check again: " + str(dest))
    print(("CHECK PASSED" if dry_run else "WORKTREE READY") + " : " + str(target))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree", help="Target checkout; otherwise use explicit Herdr context")
    parser.add_argument("--machine", type=Path)
    parser.add_argument("--rules", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--require-configured", action="store_true")
    args = parser.parse_args()
    try:
        config_dir = os.environ.get("HERDR_PLUGIN_CONFIG_DIR")
        custom = Path(config_dir) / "rules.json" if config_dir else None
        rules_file = args.rules or (custom if custom and custom.is_file() else Path(__file__).with_name("rules.json"))
        machine_file = args.machine or (Path(config_dir) / "machine.json" if config_dir else None)
        if machine_file is None:
            raise SetupError("Provide --machine PATH or configure machine.json in the plugin config directory.")
        machine = json.loads(machine_file.read_text())
        rules = json.loads(rules_file.read_text())
        if machine.get("version") != 2 or rules.get("version") != 1:
            raise SetupError("Unsupported configuration version.")
        prepare(args.worktree or target_from_herdr(), machine, rules, args.dry_run, args.require_configured)
        return 0
    except (SetupError, OSError, ValueError, KeyError) as exc:
        print("PREPARATION INCOMPLETE: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
