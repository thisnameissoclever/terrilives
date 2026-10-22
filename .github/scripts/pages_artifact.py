"""Record and restore the exact successful CI run's tested WebAssembly package."""

import argparse
import datetime as dt
import json
from pathlib import Path
import re

from mutation_artifacts import GitHub, outgoing_inventory, pages, require, safe_path, sha, strict_json, timestamp, unpack


WORKFLOW = ".github/workflows/ci.yml"
RECEIPT = "build-receipt.json"
REQUIRED = {"package.json", "terri_wasm.js", "terri_wasm_bg.wasm"}


def identity(sha_value, repository, run_id, attempt):
    require(isinstance(sha_value, str) and re.fullmatch(r"[0-9a-f]{40}", sha_value), "invalid source SHA")
    require(isinstance(repository, str) and re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*", repository),
            "invalid repository")
    require(isinstance(run_id, str) and re.fullmatch(r"[1-9][0-9]*", run_id), "invalid run ID")
    require(type(attempt) is int and attempt > 0, "invalid run attempt")
    return {"version": 1, "workflow": WORKFLOW, "repository": repository,
            "sha": sha_value, "run_id": run_id, "attempt": attempt}


def package_path(name):
    path = safe_path(name)
    require(all(not part.startswith(".") for part in path.parts) and path.parts[0] != RECEIPT,
            "hidden or reserved package path")
    return path


def validate_receipt(receipt, sha_value, repository, run_id):
    require(isinstance(receipt, dict) and set(receipt) ==
            {"version", "workflow", "repository", "sha", "run_id", "attempt", "files"}, "invalid receipt schema")
    expected = identity(sha_value, repository, run_id, receipt["attempt"])
    require(type(receipt["version"]) is int and all(receipt[key] == value for key, value in expected.items()),
            "receipt producer mismatch")
    rows = receipt["files"]
    require(isinstance(rows, list) and rows, "missing package inventory")
    names = []
    for row in rows:
        require(isinstance(row, dict) and set(row) == {"path", "size", "sha256"}, "invalid package member schema")
        package_path(row["path"])
        require(type(row["size"]) is int and row["size"] >= 0 and isinstance(row["sha256"], str)
                and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]), "invalid package member metadata")
        names.append(row["path"])
    require(names == sorted(set(names)), "duplicate or unordered package inventory")
    require(REQUIRED <= set(names), "missing required WebAssembly package files")
    require(all(row["size"] > 0 for row in rows if row["path"] in REQUIRED), "empty required WebAssembly package file")
    require(not any(str(parent) in names for name in names for parent in safe_path(name).parents if str(parent) != "."),
            "package file conflicts with directory")
    return rows


def record(directory, sha_value, repository, run_id, attempt):
    receipt = identity(sha_value, repository, run_id, attempt)
    inventory = outgoing_inventory(directory)
    require(not inventory["violations"], "package exceeds artifact capacity")
    receipt["files"] = [row for row in inventory["members"] if row["path"] != RECEIPT
                        and all(not part.startswith(".") for part in safe_path(row["path"]).parts)]
    validate_receipt(receipt, sha_value, repository, run_id)
    (Path(directory) / RECEIPT).write_text(json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    return receipt


def authenticate_run(run, sha_value, repository, run_id, *, require_success=True):
    require(type(run["id"]) is int and str(run["id"]) == run_id
            and run["repository"]["full_name"] == repository
            and run["head_repository"]["full_name"] == repository, "foreign repository or run")
    require(run["path"] == WORKFLOW and run["head_sha"] == sha_value
            and run["head_branch"] == "main" and run["event"] == "push", "untrusted CI producer")
    require(run["status"] == "completed" and (not require_success or run["conclusion"] == "success"), "CI run did not succeed")
    require(type(run["run_attempt"]) is int and run["run_attempt"] > 0, "invalid CI attempt")


def authenticate_web(job, sha_value, run_id, maximum_attempt):
    attempt = job["run_attempt"]
    require(type(job["id"]) is int and job["id"] > 0
            and type(job["run_id"]) is int and str(job["run_id"]) == run_id
            and type(attempt) is int and 0 < attempt <= maximum_attempt
            and job["head_sha"] == sha_value and job["name"] == "web" and job["status"] == "completed"
            and job["conclusion"] == "success", "web producer job did not succeed")
    return attempt


def execution_steps(job):
    steps = job["steps"]
    require(isinstance(steps, list) and steps, "missing successful web execution steps")
    fields = ("number", "name", "status", "conclusion", "started_at", "completed_at")
    result = []
    for step in steps:
        require(isinstance(step, dict) and type(step["number"]) is int and step["number"] > 0
                and isinstance(step["name"], str) and step["status"] == "completed"
                and step["conclusion"] in ("success", "skipped"), "invalid successful web execution step")
        dates = []
        for field in ("started_at", "completed_at"):
            value = step.get(field)
            require(isinstance(value, str) or value is None and step["conclusion"] == "skipped",
                    "invalid web step timestamp type")
            dates.append(timestamp(value) if value is not None else None)
        require(dates[0] is None or dates[1] is None or dates[0] <= dates[1], "reversed web step timestamps")
        result.append(tuple(step.get(field) for field in fields))
    numbers = [row[0] for row in result]
    require(numbers == sorted(set(numbers)), "duplicate or unordered web execution steps")
    return result


def restore(api, directory, sha_value, repository, run_id, *, now=None):
    identity(sha_value, repository, run_id, 1)
    now = now or dt.datetime.now(dt.timezone.utc)
    prefix = f"repos/{repository}"
    run_path = f"{prefix}/actions/runs/{run_id}"
    run = api.json(run_path)
    authenticate_run(run, sha_value, repository, run_id)
    # The run-jobs endpoint defaults to filter=latest, including retained jobs
    # when a later attempt reruns only failed jobs.
    latest = [job for job in pages(api, f"{run_path}/jobs", "jobs") if job["name"] == "web"]
    require(len(latest) == 1, "missing or duplicate latest web job")
    web = latest[0]
    latest_attempt = authenticate_web(web, sha_value, run_id, run["run_attempt"])
    started, completed = timestamp(web["started_at"]), timestamp(web["completed_at"])
    require(started <= completed <= now, "invalid latest web execution interval")
    latest_steps = execution_steps(web)
    # Failed-job reruns can clone successful jobs with new IDs and attempts,
    # retaining their original execution times. The package must come from that
    # exact execution, even when its original uploading attempt is older.
    matches = []
    for row in pages(api, f"{run_path}/artifacts", "artifacts"):
        match = re.fullmatch(rf"tested-wasm-{sha_value}-attempt-([1-9][0-9]*)", row["name"])
        if match and started <= timestamp(row["created_at"]) <= completed:
            attempt = int(match[1])
            require(attempt <= latest_attempt, "artifact exceeds latest web attempt")
            matches.append((row, attempt))
    require(len(matches) == 1, "missing or duplicate expected tested package artifact")
    listed, attempt = matches[0]
    require(type(listed["id"]) is int and listed["id"] > 0, "invalid immutable artifact ID")
    artifact = api.json(f"{prefix}/actions/artifacts/{listed['id']}")
    fields = ("id", "name", "workflow_run", "created_at", "expires_at", "expired", "digest")
    require(all(artifact[key] == listed[key] for key in fields), "artifact identity changed")
    require(artifact["expired"] is False and timestamp(artifact["expires_at"]) > now, "expired tested package artifact")
    producer = artifact["workflow_run"]
    require(type(producer["id"]) is int and str(producer["id"]) == run_id
            and producer["head_sha"] == sha_value and producer["head_branch"] == "main", "artifact run mismatch")
    raw = api.bytes(f"{prefix}/actions/artifacts/{artifact['id']}/zip")
    require(artifact["digest"] == "sha256:" + sha(raw), "artifact archive digest mismatch")
    files = unpack(raw)
    require(RECEIPT in files, "missing package build receipt")
    receipt = strict_json(files[RECEIPT])
    rows = validate_receipt(receipt, sha_value, repository, run_id)
    require(receipt["attempt"] == attempt, "receipt differs from uploading web producer attempt")
    require(set(files) == {RECEIPT} | {row["path"] for row in rows}, "package inventory differs from archive")
    for row in rows:
        content = files[row["path"]]
        require(len(content) == row["size"] and sha(content) == row["sha256"], "package file bytes changed")
    attempt_run = api.json(f"{run_path}/attempts/{attempt}")
    authenticate_run(attempt_run, sha_value, repository, run_id, require_success=False)
    require(attempt_run["run_attempt"] == attempt, "package producer attempt mismatch")
    jobs = [job for job in pages(api, f"{run_path}/attempts/{attempt}/jobs", "jobs") if job["name"] == "web"]
    require(len(jobs) == 1, "missing or duplicate web producer job")
    job = jobs[0]
    require(authenticate_web(job, sha_value, run_id, latest_attempt) == attempt, "uploading web producer attempt mismatch")
    require((attempt < latest_attempt or job["id"] == web["id"])
            and timestamp(job["started_at"]) == started and timestamp(job["completed_at"]) == completed
            and execution_steps(job) == latest_steps, "uploading job differs from latest successful web execution")

    # Validate the complete download and destination before creating any files.
    root = Path(directory).absolute()
    for path in (root, *root.parents):
        require(not path.is_symlink() and not getattr(path, "is_junction", lambda: False)(), "linked package destination")
    require(not root.exists() or root.is_dir() and not any(root.iterdir()), "package destination is not empty")
    root.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("record", "restore"):
        command = commands.add_parser(name)
        for option in ("directory", "sha", "repository", "run-id"):
            command.add_argument("--" + option, required=True)
        if name == "record":
            command.add_argument("--attempt", required=True, type=int)
    args = parser.parse_args()
    if args.command == "record":
        record(args.directory, args.sha, args.repository, args.run_id, args.attempt)
    else:
        restore(GitHub(), args.directory, args.sha, args.repository, args.run_id)


if __name__ == "__main__":
    main()
