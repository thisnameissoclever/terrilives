"""Run the former routine CI checks locally and retain exact execution evidence."""

import argparse
from dataclasses import dataclass
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
GROUPS = ("docs", "scripts", "art", "rust", "site", "web")
ART_DIRECTORIES = ("assets/sprites/gen", "assets/models/sims/sim-01", "assets/models/furniture",
                   "assets/models/kitchen", "assets/models/bathroom", "assets/models/kitchen/actions",
                   "assets/models/bathroom/actions", "assets/models/bedroom", "assets/models/office", "assets/models/outdoor")


@dataclass(frozen=True)
class Command:
    group: str
    name: str
    argv: tuple
    cwd: str = "."


def commands(groups, *, install_dependencies=False):
    rows = [
        Command("docs", "Documentation ids", (sys.executable, "check-doc-ids.py")),
        Command("scripts", "CI scripts and workflow guards", (sys.executable, "-B", "-m", "unittest", "discover", "-p", "test_*.py"), ".github/scripts"),
    ]
    if install_dependencies:
        rows.append(Command("art", "Install artwork verification dependencies", (sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "Pillow", "numpy")))
    rows.extend(Command("art", "Test " + directory, (sys.executable, "-B", "-m", "unittest", "discover", "-s", directory, "-p", "test_*.py")) for directory in ART_DIRECTORIES)
    rows.extend([
        Command("art", "Sprite atlas is reproducible", (sys.executable, "assets/sprites/gen/build.py", "--check")),
        Command("art", "Test lossless runtime atlas storage", (sys.executable, "-B", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_runtime_atlas.py")),
        Command("art", "Reconstruct runtime atlas pixels and coverage", (sys.executable, "-B", "scripts/build-runtime-atlas.py", "--check")),
        Command("rust", "Inspect the pinned toolchain", ("rustup", "show")),
        Command("rust", "Format check", ("cargo", "fmt", "--all", "--", "--check")),
        Command("rust", "Clippy", ("cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings")),
        Command("rust", "Test native workspace", ("cargo", "test", "--workspace")),
        Command("rust", "Verify sim core has no web dependencies", (sys.executable, str(Path(__file__).resolve()), "purity")),
        Command("site", "Test public documentation generation", ("node", "--test", "scripts/build-changelog.test.mjs", "scripts/build-player-guide.test.mjs", "scripts/player-activity-filters.test.mjs", "scripts/player-coverage.test.mjs", "scripts/check-player-reference.test.mjs", "scripts/branding.test.mjs")),
        Command("site", "Validate player reference review", ("node", "scripts/check-player-reference.mjs", "--check")),
        Command("site", "Build public changelog", ("node", "scripts/build-changelog.mjs")),
        Command("site", "Build player guide", ("node", "scripts/build-player-guide.mjs")),
        Command("web", "Build WASM package", ("wasm-pack", "build", "crates/terri-wasm", "--target", "web", "--out-dir", "../../web/src/wasm")),
        *([Command("web", "Install web dependencies", ("npm", "ci"), "web")] if install_dependencies else []),
        Command("web", "Verify player values against compiled gameplay", ("node", "scripts/check-player-reference.mjs", "--verify-export")),
        Command("web", "Type check web", ("npm", "run", "typecheck"), "web"),
        Command("web", "Test web", ("npm", "test", "--", "--maxWorkers=1"), "web"),
        Command("web", "Build web", ("npm", "run", "build"), "web"),
    ])
    return [row for row in rows if row.group in groups]


def authorize(sha, head, actor, owner, reference):
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or sha != head:
        raise ValueError("validated revision must exactly match the dispatched revision")
    if not owner or actor != owner:
        raise ValueError("hosted mutation work requires the repository owner's explicit dispatch")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", reference) or reference == "sha256:" + "0" * 64:
        raise ValueError("supply the SHA-256 reference of the owner-reviewed local report")
    return {"validated_sha": sha, "local_verification_ref": reference, "code": "true"}


def verify_purity(root):
    for target in ("x86_64-unknown-linux-gnu", "wasm32-unknown-unknown"):
        for crate in ("terri-core", "terri-data", "terri-sim"):
            result = subprocess.run(["cargo", "tree", "-p", crate, "--target", target], cwd=root,
                                    check=True, stdout=subprocess.PIPE, text=True)
            if re.search(r"wasm-bindgen|web-sys|js-sys", result.stdout):
                raise ValueError(f"{crate} depends on a web crate for {target}")


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True, stdout=subprocess.PIPE).stdout


def source_snapshot(root, report):
    sha = git(root, "rev-parse", "HEAD").decode().strip()
    diff = git(root, "diff", "--binary", "HEAD", "--")
    extra = {}
    logs = report.with_suffix(".logs")
    for name in git(root, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0"):
        if not name:
            continue
        path = root / name
        if path == report or path.is_relative_to(logs):
            continue
        extra[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"revision": sha, "working_diff_sha256": hashlib.sha256(diff).hexdigest(), "untracked_files": extra}


def execute_command(argv, cwd, log):
    executable = shutil.which(argv[0])
    if executable is None:
        raise FileNotFoundError("required local command is unavailable: " + argv[0])
    resolved = [executable, *argv[1:]]
    path = Path(executable)
    if path.suffix.lower() in (".cmd", ".bat"):
        if path.name.lower() != "npm.cmd":
            raise OSError("unsupported batch command: " + str(path))
        cli = path.parent / "node_modules/npm/bin/npm-cli.js"
        if not cli.is_file():
            raise FileNotFoundError("npm CLI is missing beside its resolved wrapper: " + str(cli))
        adjacent_node = path.parent / "node.exe"
        node = str(adjacent_node) if adjacent_node.is_file() else shutil.which("node")
        if node is None or Path(node).suffix.lower() in (".cmd", ".bat"):
            raise FileNotFoundError("npm requires a directly executable Node binary")
        resolved = [node, str(cli), *argv[1:]]
    with log.open("wb") as stream:
        return subprocess.run(resolved, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                              env=bounded_environment()).returncode


def bounded_environment(environ=None):
    task_environment = dict(os.environ if environ is None else environ)
    options = task_environment.get("NODE_OPTIONS", "")
    pattern = re.compile(r"(?:^|\s)--max[-_]old[-_]space[-_]size(?:=|\s+)([0-9]+)(?=\s|$)")
    memory = min([2048, *[int(value) for value in pattern.findall(options)]])
    if memory < 1:
        raise ValueError("NODE_OPTIONS heap limit must be positive")
    task_environment["NODE_OPTIONS"] = (pattern.sub(" ", options).strip() + f" --max-old-space-size={memory}").strip()
    jobs = int(task_environment.get("CARGO_BUILD_JOBS", "2"))
    if jobs < 1:
        raise ValueError("CARGO_BUILD_JOBS must be a positive bounded worker count")
    task_environment["CARGO_BUILD_JOBS"] = str(min(jobs, 2))
    return task_environment


def run_checks(root, report, groups, *, execute=execute_command, install_dependencies=False):
    root, report = Path(root).resolve(), Path(report).resolve()
    report.parent.mkdir(parents=True, exist_ok=True)
    before = source_snapshot(root, report)
    result = {"version": 1, "checked_revision": before["revision"], "source_before": before,
              "started_at": dt.datetime.now(dt.timezone.utc).isoformat(), "groups": list(groups),
              "platform": {"system": platform.system(), "release": platform.release(), "machine": platform.machine(), "python": sys.version},
              "platform_limits": ["Native execution covers this recorded host, not another operating system.",
                                  "Local checks do not establish GitHub job-token transport, runner initialization or interrupted hosted recovery.",
                                  "This report does not authorize a push, merge, hosted check or paid build."],
              "results": [], "state": "running", "complete": False}
    task_environment = bounded_environment()
    result["resources"] = {"web_test_workers": 1, "cargo_build_jobs": int(task_environment["CARGO_BUILD_JOBS"]),
                           "node_heap_megabytes": int(re.search(r"--max-old-space-size=(\d+)", task_environment["NODE_OPTIONS"])[1])}
    def retain():
        report.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    retain()
    logs = report.with_suffix(".logs")
    logs.mkdir(parents=True, exist_ok=True)
    for index, command in enumerate(commands(groups, install_dependencies=install_dependencies)):
        print(f"[{command.group}] {command.name}", flush=True)
        start = time.monotonic()
        row = {"name": command.name, "group": command.group, "argv": list(command.argv), "cwd": command.cwd,
               "log": str(logs / f"{index:02d}.log")}
        try:
            row["returncode"] = execute(command.argv, root / command.cwd, Path(row["log"]))
        except OSError as error:
            row.update(returncode=127, error=str(error))
        except KeyboardInterrupt:
            row["returncode"] = 130
            result["state"] = "interrupted"
        row["elapsed_seconds"] = time.monotonic() - start
        result["results"].append(row)
        retain()
        if row["returncode"]:
            if result["state"] != "interrupted":
                result["state"] = "failed"
            break
    if result["state"] == "running":
        result["state"] = "passed"
    result["source_after"] = source_snapshot(root, report)
    result["source_changed"] = result["source_after"] != before
    if result["source_changed"] and result["state"] == "passed":
        result["state"] = "source_changed"
    result["complete"] = result["state"] == "passed" and set(groups) == set(GROUPS)
    result["finished_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    retain()
    print("Local report reference: sha256:" + hashlib.sha256(report.read_bytes()).hexdigest(), flush=True)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    run = modes.add_parser("run")
    run.add_argument("--root", type=Path, default=ROOT)
    run.add_argument("--report", type=Path, required=True)
    run.add_argument("--group", action="append", choices=GROUPS)
    run.add_argument("--install-dependencies", action="store_true")
    run.add_argument("--list", action="store_true")
    modes.add_parser("purity")
    authorization = modes.add_parser("authorize")
    for name in ("sha", "head", "actor", "owner", "reference"):
        authorization.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    if args.mode == "purity":
        verify_purity(Path.cwd())
        return 0
    if args.mode == "authorize":
        values = authorize(args.sha, args.head, args.actor, args.owner, args.reference)
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a", encoding="utf-8") as stream:
                stream.write("".join(f"{key}={value}\n" for key, value in values.items()))
        print("Owner-reviewed local evidence accepted for " + values["validated_sha"])
        print("This authorization job did not execute the local checks.")
        return 0
    groups = tuple(dict.fromkeys(args.group or GROUPS))
    if args.list:
        print(json.dumps([row.__dict__ for row in commands(groups, install_dependencies=args.install_dependencies)], indent=2))
        return 0
    result = run_checks(args.root, args.report, groups, install_dependencies=args.install_dependencies)
    return 0 if result["state"] == "passed" else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
