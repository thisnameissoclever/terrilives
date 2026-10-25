"""Immutable, lossless recovery proofs with bounded incremental ingestion."""

import base64
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.parse
import urllib.request
import urllib.error

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_runner as runner
import mutation_tool as tool
import mutation_native as native

require = artifacts.require
MAX_BYTES = 128 * 1024 * 1024
CHUNK_BYTES = 32 * 1024 * 1024
MAX_PAGES = 16
MAX_GAP = 3
MAX_NODES = 2_000_000
MAX_RECONSTRUCTED_BYTES = MAX_BYTES
ALLOWED_AGGREGATE_STATES = {"complete", "incomplete_with_progress", "incomplete_without_progress"}


def aggregate_job_name(scope):
    return "mutation-fixture-aggregate" if scope == "fixture" else "mutation-production-aggregate"


def aggregate_identity(settings):
    return {"run_id": settings["run_id"], "attempt": settings["attempt"], "job_id": settings["job_id"]}


class RecordingAPI:
    """Retain original proof bytes fetched by the existing authenticators."""
    def __init__(self, api):
        self.api, self.metadata, self.used, self.logs, self.tool_receipts = api, {}, set(), {}, {}

    def json(self, path):
        value = self.api.json(path)
        if re.search(r"/actions/artifacts/[0-9]+$", path):
            self.metadata[str(value["id"])] = value
        if isinstance(value, dict) and "artifacts" in value:
            for item in value["artifacts"]:
                self.metadata[str(item["id"])] = item
        return value

    def bytes(self, path):
        raw = self.api.bytes(path)
        match = re.search(r"/actions/artifacts/([0-9]+)/zip$", path)
        if match:
            self.used.add(match.group(1))
            if self.metadata.get(match.group(1), {}).get("name", "").startswith("mutation-tool-run-"):
                self.tool_receipts[match.group(1)] = artifacts.strict_json(tool.unpack_tool(raw)["receipt.json"])
        if re.search(r"/actions/jobs/[0-9]+/logs$", path):
            self.logs[path] = raw
        return raw


def original_metadata(item):
    return {key: item[key] for key in ("id", "name", "digest", "created_at", "expires_at", "workflow_run")}


def retain_recording(recording, data):
    """Only call after the upstream authenticator accepted every fetched proof."""
    now = dt.datetime.now(dt.timezone.utc)
    for path, raw in recording.logs.items():
        receipts = []
        for line in raw.decode("utf-8").splitlines():
            match = re.search(r"MUTATION_(?:PRODUCER|PLAN|TOOL|QUALIFICATION) (\{.*)$", line)
            if match:
                try:
                    receipt = artifacts.strict_json(match.group(1))
                    if path.endswith("/" + str(receipt["job_id"]) + "/logs"):
                        receipts.append(receipt)
                except (ValueError, KeyError):
                    pass
        require(receipts, "original producer log has no verified receipt")
        receipt = receipts[-1]
        days = receipt.get("log_retention_days")
        require(type(days) is int and days > 0, "producer omitted original log retention")
        repository, run_id = receipt["repository"], receipt["run_id"]
        run = recording.json(f"repos/{repository}/actions/runs/{run_id}")
        entry = dict(run_id=run_id, head_sha=run["head_sha"], workflow_sha=receipt["workflow_sha"],
                     **{key: receipt["checkout"][key] for key in ("commit", "tree", "ref")})
        evidence = {"bytes": base64.b64encode(raw).decode(), "sha256": artifacts.sha(raw),
            "run_id": run_id, "attempt": receipt["attempt"], "job_id": str(receipt["job_id"]),
            "observed_at": now.isoformat(), "original_retention_days": days,
            "expires_at": (artifacts.timestamp(run["created_at"]) + dt.timedelta(days=days)).isoformat()}
        if path in data["logs"]:
            require(data["logs"][path]["sha256"] == evidence["sha256"], "original log bytes changed")
        else:
            data["logs"][path] = evidence
        data["source_runs"][run_id] = entry
    for artifact_id in recording.used:
        item = recording.metadata.get(artifact_id)
        require(item is not None, "original artifact metadata not recorded")
        matching = [path for path, entry in data["logs"].items() if re.search(
            rf"^(?:\S+ )?MUTATION_ARTIFACT_ID={artifact_id}\s*$",
            base64.b64decode(entry["bytes"]).decode("utf-8"), re.MULTILINE)]
        require(len(matching) == 1, "original artifact lacks a unique retained producer log")
        reference = {"metadata": original_metadata(item), "producer_log": matching[0]}
        previous = data["originals"].get(artifact_id)
        require(previous is None or previous == reference, "original artifact reference changed")
        data["originals"][artifact_id] = reference


def encode(value):
    """Intern repeated strings/containers; reconstruct original dictionaries exactly."""
    nodes, known = [], {}
    def visit(item, depth=0):
        require(depth <= 64, "snapshot nesting exceeds limit")
        if isinstance(item, dict):
            node = ["d", [[visit(key, depth + 1), visit(child, depth + 1)] for key, child in sorted(item.items())]]
        elif isinstance(item, list):
            node = ["l", [visit(child, depth + 1) for child in item]]
        elif item is None or type(item) in (str, int, float, bool):
            node = ["v", item]
        else:
            raise ValueError("unsupported snapshot value")
        key = json.dumps(node, separators=(",", ":"), allow_nan=False)
        if key not in known:
            if len(nodes) >= MAX_NODES:
                raise runner.CapacityFailure("snapshot node capacity exceeded")
            known[key] = len(nodes)
            nodes.append(node)
        return known[key]
    root = visit(value)
    raw = json.dumps({"version": 1, "root": root, "nodes": nodes}, separators=(",", ":"), allow_nan=False).encode()
    if len(raw) > MAX_BYTES - 1024 * 1024:
        raise runner.CapacityFailure("compact snapshot byte capacity exceeded")
    # Apply the same cap to the reconstructed logical proof, not only its interned representation.
    try:
        decode(raw, materialize=False)
    except ValueError as error:
        if "capacity" in str(error):
            raise runner.CapacityFailure(str(error)) from error
        raise
    return raw


def decode(raw, *, materialize=True):
    require(len(raw) <= MAX_BYTES, "snapshot exceeds byte capacity")
    encoded = artifacts.strict_json(raw)
    require(encoded["version"] == 1 and 0 < len(encoded["nodes"]) <= MAX_NODES, "invalid snapshot encoding")
    costs = []
    for index, (kind, content) in enumerate(encoded["nodes"]):
        def previous(reference):
            require(type(reference) is int and 0 <= reference < index, "cyclic or invalid snapshot reference")
            return costs[reference]
        if kind == "v":
            require(content is None or type(content) in (str, int, float, bool), "invalid snapshot scalar")
            cost = len(json.dumps(content).encode())
        elif kind == "l":
            cost = 2 + sum(previous(reference) + 1 for reference in content)
        else:
            require(kind == "d", "unknown snapshot node")
            names, cost = set(), 2
            for key, child in content:
                cost += previous(key) + previous(child) + 2
                node = encoded["nodes"][key]
                require(node[0] == "v" and isinstance(node[1], str) and node[1] not in names,
                        "duplicate snapshot dictionary key")
                names.add(node[1])
        require(cost <= MAX_RECONSTRUCTED_BYTES, "snapshot reconstruction capacity exceeded")
        costs.append(cost)
    require(type(encoded["root"]) is int and 0 <= encoded["root"] < len(costs), "invalid snapshot root")
    if not materialize:
        return costs[encoded["root"]]
    def expand(index, depth=0):
        require(depth <= 64, "snapshot nesting exceeds limit")
        kind, content = encoded["nodes"][index]
        if kind == "v":
            return content
        if kind == "l":
            return [expand(child, depth + 1) for child in content]
        return {expand(key, depth + 1): expand(child, depth + 1) for key, child in content}
    return expand(encoded["root"])


def artifact_name(scope, campaign, kind, run_id, attempt):
    require(scope in ("production", "fixture") and kind in ("prepared", "aggregate"), "invalid snapshot namespace")
    return f"mutation-{scope}-recovery-{campaign}-{kind}-run-{run_id}-attempt-{attempt}"


def seal(data, settings, kind, verdict, destination):
    native.validate_admitted(data, settings)
    validate_log_anchors(data, complete=True)
    data = dict(data, consumer={"run_id": settings["run_id"], "attempt": settings["attempt"]})
    if kind == "aggregate":
        key = f"{settings['run_id']}/{settings['attempt']}"
        phases = {key: list(jobs) for key, jobs in data.get("phase_inventories", {}).items()}
        jobs = phases.setdefault(key, [])
        existing = [job for job in jobs if str(job["id"]) == settings["job_id"]]
        require(len(existing) <= 1, "duplicate current aggregate identity")
        if not existing:
            jobs.append({"id": int(settings["job_id"]), "run_id": int(settings["run_id"]), "run_attempt": settings["attempt"],
                "name": aggregate_job_name(settings["scope"]), "status": "in_progress", "conclusion": None,
                "started_at": settings["job_started_at"]})
        data.update(phase_inventories=phases, pending_aggregate=aggregate_identity(settings))
    validate_retained(data, pending_aggregate=aggregate_identity(settings) if kind == "aggregate" else None)
    raw = encode(data)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    chunks = []
    for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)):
        content = raw[offset:offset + CHUNK_BYTES]
        name = f"chunk-{index:04d}.bin"
        (destination / name).write_bytes(content)
        chunks.append({"name": name, "size": len(content), "sha256": artifacts.sha(content)})
    manifest = data["planned"]["manifest"]
    receipt = {"version": 1, "kind": kind, "scope": settings["scope"], "repository": settings["repository"],
        "workflow": tool.WORKFLOW, "workflow_sha": settings["workflow_sha"], "head_sha": settings["head_sha"],
        "run_id": settings["run_id"], "attempt": settings["attempt"], "job_id": settings["job_id"],
        "checkout": data["current_checkout"], "campaign_id": manifest["campaign_id"],
        "host_provenance": settings.get("host_provenance", {}),
        "input_fingerprint": manifest["input_fingerprint"], "contract": data["contract"],
        "plan": data["chain"]["plan"], "frontier": data["frontier"], "verdict": verdict,
        "log_retention_days": settings["log_retention_days"], "chunks": chunks,
        "data_sha256": artifacts.sha(raw), "payload_digest": model.digest(data)}
    runner.write_json(destination / "receipt.json", receipt)
    print("MUTATION_RECOVERY " + json.dumps(receipt, sort_keys=True, separators=(",", ":")), flush=True)
    return receipt


def load(api, reference, repository, contract, *, consumer=None):
    item = api.json(f"repos/{repository}/actions/artifacts/{reference['artifact_id']}")
    require(item["id"] == reference["artifact_id"] and item["digest"] == reference["archive_digest"] and not item["expired"],
            "snapshot artifact changed or expired")
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{item['id']}/zip")
    require(item["digest"] == "sha256:" + artifacts.sha(raw), "snapshot archive digest mismatch")
    files = artifacts.unpack(raw)
    receipt = artifacts.strict_json(files["receipt.json"])
    require(receipt["version"] == 1 and receipt["repository"] == repository and receipt["contract"] == contract,
            "snapshot validator contract mismatch")
    require(item["name"] == artifact_name(receipt["scope"], receipt["campaign_id"], receipt["kind"], receipt["run_id"], receipt["attempt"])
            and str(item["workflow_run"]["id"]) == receipt["run_id"] and item["workflow_run"]["head_sha"] == receipt["head_sha"],
            "snapshot producer identity mismatch")
    names = [chunk["name"] for chunk in receipt["chunks"]]
    require(len(names) == len(set(names)) and set(files) == {"receipt.json", *names}, "snapshot chunk inventory mismatch")
    for chunk in receipt["chunks"]:
        require(chunk["size"] == len(files[chunk["name"]]) <= CHUNK_BYTES
                and artifacts.sha(files[chunk["name"]]) == chunk["sha256"], "snapshot chunk digest mismatch")
    encoded = b"".join(files[name] for name in names)
    require(artifacts.sha(encoded) == receipt["data_sha256"], "snapshot data digest mismatch")
    data = decode(encoded)
    require(model.digest(data) == receipt["payload_digest"] and data["contract"] == contract
            and data["chain"]["plan"] == receipt["plan"] and data["frontier"] == receipt["frontier"], "snapshot payload binding mismatch")
    manifest = model.validate_manifest(data["planned"]["manifest"])
    require(manifest["campaign_id"] == receipt["campaign_id"] and manifest["input_fingerprint"] == receipt["input_fingerprint"]
            and manifest["context"]["inputs"]["computation_scope"] == receipt["scope"], "snapshot campaign mismatch")
    require(set(data["frontier"]) <= {entry["run_id"] for entry in data["chain"]["runs"]}
            and data["frontier"].get(receipt["run_id"], 0) <= receipt["attempt"] - (receipt["kind"] == "prepared"),
            "snapshot frontier includes future evidence")
    if consumer is not None:
        require(receipt["kind"] == "prepared" and data["consumer"] == consumer
                and receipt["run_id"] == consumer["run_id"] and receipt["attempt"] == consumer["attempt"],
                "stale preparation; rerun mutation preparation and its dependents")
    entry = tool.entry_from_receipt(receipt)
    run = artifacts.authenticate_run(api, repository, tool.WORKFLOW, entry, contract["files"][tool.WORKFLOW])
    tool.verify_committed_contract(api, repository, receipt["workflow_sha"], contract)
    tool.verify_committed_contract(api, repository, receipt["checkout"]["commit"], contract)
    name = ("mutation-fixture-prepare" if receipt["scope"] == "fixture" else "mutation-prepare") if receipt["kind"] == "prepared" else (
        "mutation-fixture-aggregate" if receipt["scope"] == "fixture" else "mutation-production-aggregate")
    proof = artifacts.authenticate_producer(api, repository, entry, item, receipt,
        now=dt.datetime.now(dt.timezone.utc), job_name=name, marker="MUTATION_RECOVERY")
    require(proof["job"]["status"] == "completed", "snapshot producer is not complete")
    expected = "success" if receipt["kind"] == "prepared" or receipt["verdict"]["state"] == "complete" else "failure"
    require(proof["job"]["conclusion"] == expected, "snapshot producer verdict disagrees with job")
    tool.retained_until(api, repository, item, run, artifacts.timestamp(data["chain"]["expires_at"]) + tool.MARGIN,
                        receipt["log_retention_days"])
    if receipt["kind"] == "aggregate":
        retain_aggregate_verdict(data, receipt, proof, item, run)
    validate_retained(data)
    native.validate_admitted(data, {"run_id": receipt["run_id"], "attempt": receipt["attempt"]})
    validate_log_anchors(data, complete=True)
    return data, receipt


def retain_aggregate_verdict(data, receipt, proof, item, run):
    """Resolve the producer's pending identity only from its authenticated final log."""
    identity = {key: receipt[key] for key in ("run_id", "attempt", "job_id")}
    require(data.get("pending_aggregate") == identity, "snapshot omitted its pending aggregate identity")
    key = f"{receipt['run_id']}/{receipt['attempt']}"
    phases = data["phase_inventories"][key]
    matches = [index for index, job in enumerate(phases) if str(job["id"]) == receipt["job_id"]]
    require(len(matches) == 1, "snapshot omitted its started aggregate")
    phases[matches[0]] = proof["job"]
    path = f"repos/{receipt['repository']}/actions/jobs/{receipt['job_id']}/logs"
    raw = proof["log_bytes"]
    log = {"bytes": base64.b64encode(raw).decode(), "sha256": proof["log_sha256"], "run_id": receipt["run_id"],
        "attempt": receipt["attempt"], "job_id": receipt["job_id"], "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "original_retention_days": receipt["log_retention_days"],
        "expires_at": (artifacts.timestamp(run["created_at"]) + dt.timedelta(days=receipt["log_retention_days"])).isoformat()}
    if path in data["logs"]:
        require(data["logs"][path]["sha256"] == log["sha256"], "original aggregate log bytes changed")
    data["logs"][path] = log
    data["originals"][str(item["id"])] = {"metadata": original_metadata(item), "producer_log": path}
    data["source_runs"][receipt["run_id"]] = tool.entry_from_receipt(receipt)
    data.setdefault("aggregate_verdicts", {})[receipt["job_id"]] = {
        "receipt": receipt, "artifact_id": item["id"], "producer_log": path, "job": proof["job"]}
    data.pop("pending_aggregate")


def validate_retained(data, *, pending_aggregate=None):
    validate_log_anchors(data)
    if "native_admission" in data:
        native.validate_admitted(data)
    required_until = artifacts.timestamp(data["chain"]["expires_at"]) + tool.MARGIN
    for path, log in data["logs"].items():
        raw = base64.b64decode(log["bytes"], validate=True)
        require(artifacts.sha(raw) == log["sha256"] and artifacts.timestamp(log["expires_at"]) > required_until,
                "retained original log changed or expired")
        require(path.endswith("/" + log["job_id"] + "/logs"), "retained log job mismatch")
    for reference in data["originals"].values():
        require(reference["producer_log"] in data["logs"], "original artifact lost producer evidence")
    for item in data["bundles"]:
        require(model.digest(item["bundle"]) == item["bundle_digest"], "retained delta reconstruction changed")
        require(str(item["artifact_id"]) in data["originals"], "retained delta lost original artifact")
        receipt = item["bundle"]["receipt"]
        require(0 < receipt["attempt"] <= data["frontier"].get(receipt["run_id"], 0), "retained delta exceeds sealed frontier")
        jobs = data["job_inventories"].get(f"{receipt['run_id']}/{receipt['attempt']}", [])
        matching = [job for job in jobs if str(job["id"]) == receipt["job_id"]]
        require(len(matching) == 1 and matching[0]["status"] == "completed" and matching[0]["conclusion"] ==
                ("success" if item["bundle"]["status"]["state"] == "complete" else "failure"),
                "retained worker inventory or verdict mismatch")
    capacity_failures = data.get("capacity_failures", {})
    for job_id, evidence in capacity_failures.items():
        job, payload, path = evidence["job"], evidence["payload"], evidence["producer_log"]
        require(job_id == str(job["id"]) and path in data["logs"], "capacity failure lost producer identity or original log")
        require(artifacts.capacity_marker(base64.b64decode(data["logs"][path]["bytes"])) == payload,
                "retained capacity failure differs from original producer bytes")
        entry = next(entry for entry in data["chain"]["runs"] if entry["run_id"] == str(job["run_id"]))
        policy_digest = data.get("native_admission", {}).get("batch_policy_digest")
        artifacts.validate_capacity_receipt(payload, data["planned"]["manifest"], entry, job, policy_digest,
            data["planned"]["producer"]["repository"], tool.WORKFLOW)
        key = f"{job['run_id']}/{job['run_attempt']}"
        require(job in data["job_inventories"].get(key, []) and job["run_attempt"] <= data["frontier"].get(str(job["run_id"]), 0),
                "retained capacity failure lost executed worker history")
        require(not any(item["bundle"]["receipt"]["job_id"] == job_id for item in data["bundles"]),
                "capacity failure contradicts retained result artifact")
    for key, jobs in data["job_inventories"].items():
        require(len(jobs) <= 8 and len({job["id"] for job in jobs}) == len(jobs), "invalid retained worker inventory")
        evidenced = {item["bundle"]["receipt"]["job_id"] for item in data["bundles"] if
                     f"{item['bundle']['receipt']['run_id']}/{item['bundle']['receipt']['attempt']}" == key}
        evidenced.update(job_id for job_id, evidence in capacity_failures.items()
            if f"{evidence['job']['run_id']}/{evidence['job']['run_attempt']}" == key)
        require(evidenced == {str(job["id"]) for job in jobs}, "retained started worker has no original result")
    phases = data.get("phase_inventories", {})
    require(set(data["job_inventories"]) <= set(phases), "retained attempt is missing its phase inventory")
    scope = data["planned"]["manifest"]["context"]["inputs"]["computation_scope"]
    for key, jobs in phases.items():
        for job in jobs:
            if job["name"] in native.JOBS.values():
                native.validate_native_phase(data, job)
                continue
            if job["name"] != aggregate_job_name(scope):
                require(job["status"] == "completed" and job["conclusion"] == "success",
                        "retained preparation failure stops continuation")
                continue
            validate_aggregate_phase(data, key, job, pending_aggregate)


def validate_aggregate_phase(data, key, job, pending_aggregate=None):
    scope = data["planned"]["manifest"]["context"]["inputs"]["computation_scope"]
    identity = {"run_id": str(job["run_id"]), "attempt": job["run_attempt"], "job_id": str(job["id"])}
    require(key == f"{identity['run_id']}/{identity['attempt']}", "retained aggregate attempt mismatch")
    if pending_aggregate == identity and job["status"] == "in_progress" and job["conclusion"] is None:
        return
    verdict = data.get("aggregate_verdicts", {}).get(str(job["id"]))
    require(verdict is not None and verdict["job"] == job, "historical aggregate lacks authenticated verdict evidence")
    receipt = verdict["receipt"]
    require({key: receipt[key] for key in identity} == identity and receipt["kind"] == "aggregate"
            and receipt["scope"] == scope and receipt["campaign_id"] == data["planned"]["manifest"]["campaign_id"]
            and receipt["plan"] == data["chain"]["plan"], "retained aggregate verdict binding mismatch")
    require(receipt["verdict"]["state"] in ALLOWED_AGGREGATE_STATES, "terminal historical aggregate verdict stops continuation")
    require(job["status"] == "completed" and job["conclusion"] ==
            ("success" if receipt["verdict"]["state"] == "complete" else "failure"), "retained aggregate verdict disagrees with job")
    original = data["originals"].get(str(verdict["artifact_id"]))
    require(original is not None and original["producer_log"] == verdict["producer_log"]
            and verdict["producer_log"] in data["logs"], "retained aggregate lost original verdict evidence")


def recovered(data, settings, *, include_current):
    native.validate_admitted(data, settings)
    validate_retained(data, pending_aggregate=aggregate_identity(settings) if include_current else None)
    manifest = data["planned"]["manifest"]
    bundles = [dict(item["bundle"], manifest=manifest) for item in data["bundles"]]
    for evidence in data.get("capacity_failures", {}).values():
        bundles.append({"version": 1, "manifest": manifest, "receipt": evidence["payload"]["receipt"], "delta": None,
            "status": {"state": "capacity_failure", "reason": "outgoing_artifact_capacity",
                "recorded_at": evidence["job"]["completed_at"], "remaining": model.slot_ids(manifest, evidence["payload"]["receipt"]["slot"])}})
    deltas = [bundle["delta"] for bundle in bundles if bundle["delta"] is not None]
    allowed = [entry["run_id"] for entry in data["chain"]["runs"]]
    records = model.merge_deltas(manifest, deltas, allowed_run_ids=set(allowed), current_run_id=settings["run_id"],
                                current_attempt=settings["attempt"], include_current=include_current)
    return artifacts.AuthenticatedRecovery({"bundles": bundles, "deltas": deltas, "records": records,
        "allowed_run_ids": allowed}, manifest, settings["run_id"], settings["attempt"], include_current)


def artifact_inventory(api, repository, run_id):
    items = []
    for page in range(1, MAX_PAGES + 1):
        rows = api.json(f"repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100&page={page}")["artifacts"]
        items.extend(rows)
        if len(rows) < 100:
            require(len({item["id"] for item in items}) == len(items), "duplicate artifact ID in inventory")
            return items
    raise runner.CapacityFailure("original artifact inventory exceeds bounded page capacity")



JOB_KEYS = {"id", "run_id", "run_attempt", "name", "status", "conclusion", "started_at", "completed_at"}
ANCHOR_KEYS = {"version", "repository", "basis", "job", "selected_at", "original_retention_days", "expires_at", "original_log"}


def completed_job(value, run_id=None, attempt=None, job_id=None):
    require(isinstance(value, dict) and JOB_KEYS <= set(value), "incomplete anchor job metadata")
    job = {key: value[key] for key in JOB_KEYS}
    require(all(type(job[key]) is int and job[key] > 0 for key in ("id", "run_id", "run_attempt"))
            and job["run_attempt"] <= 51 and job["status"] == "completed"
            and isinstance(job["name"], str) and job["name"] and isinstance(job["conclusion"], str)
            and job["conclusion"] not in ("", "skipped"), "anchor job is not completed execution")
    require((run_id is None or str(job["run_id"]) == str(run_id))
            and (attempt is None or job["run_attempt"] == attempt)
            and (job_id is None or str(job["id"]) == str(job_id)), "anchor job identity mismatch")
    require(isinstance(job["started_at"], str) and isinstance(job["completed_at"], str), "invalid anchor job timestamps")
    require(artifacts.timestamp(job["started_at"]) <= artifacts.timestamp(job["completed_at"])
            <= dt.datetime.now(dt.timezone.utc), "invalid anchor job timestamps")
    return job


def referenced_runs(data):
    entries = dict(data["source_runs"])
    entries.update({entry["run_id"]: entry for entry in data["chain"]["runs"]})
    require(len(entries) <= 10, "referenced run budget exhausted")
    return entries


def validate_log_anchors(data, *, complete=False):
    anchors = data.get("log_availability_anchors", {})
    entries = referenced_runs(data)
    require(isinstance(anchors, dict) and set(anchors) <= set(entries)
            and (not complete or set(anchors) == set(entries)), "missing or foreign log availability anchor")
    required_until = artifacts.timestamp(data["chain"]["expires_at"]) + tool.MARGIN
    for run_id, row in anchors.items():
        require(set(row) == ANCHOR_KEYS and row["version"] == 1 and type(row["version"]) is int
                and row["repository"] == data["planned"]["producer"]["repository"]
                and row["basis"] in ("original_producer", "planning"), "invalid stable log anchor")
        completed_job(row["job"], run_id)
        require(set(row["job"]) == JOB_KEYS and type(row["original_retention_days"]) is int
                and row["original_retention_days"] > 0
                and artifacts.timestamp(row["selected_at"]) <= dt.datetime.now(dt.timezone.utc)
                and artifacts.timestamp(row["expires_at"]) > required_until, "anchor original retention is insufficient")
        if row["basis"] == "original_producer":
            original = row["original_log"]
            require(isinstance(original, dict) and set(original) == {"path", "sha256", "observed_at"}
                    and original["path"] in {item["producer_log"] for item in data["originals"].values()},
                    "anchor lost required original producer")
            log = data["logs"][original["path"]]
            require(original == {"path": original["path"], "sha256": log["sha256"], "observed_at": log["observed_at"]}
                    and log["run_id"] == run_id and log["attempt"] == row["job"]["run_attempt"]
                    and log["job_id"] == str(row["job"]["id"])
                    and row["expires_at"] == log["expires_at"]
                    and row["original_retention_days"] == log["original_retention_days"], "anchor original binding changed")
        else:
            require(row["original_log"] is None and row["job"]["conclusion"] == "success"
                    and row["job"]["name"] == ("mutation-fixture-plan" if data["planned"]["manifest"]["context"]["inputs"]["computation_scope"] == "fixture" else "mutation-plan"),
                    "invalid planning availability anchor")


def ensure_log_availability(api, data, settings, runs):
    anchors = data.setdefault("log_availability_anchors", {})
    validate_log_anchors(data)
    entries = referenced_runs(data)
    now = dt.datetime.now(dt.timezone.utc)
    for run_id in sorted(entries, key=int):
        if run_id not in anchors:
            candidates = [data["logs"][path] for path in {item["producer_log"] for item in data["originals"].values()}
                          if data["logs"][path]["run_id"] == run_id]
            if candidates:
                log = min(candidates, key=lambda row: (row["attempt"], int(row["job_id"])))
                job = completed_job(api.json(f"repos/{settings['repository']}/actions/jobs/{log['job_id']}"), run_id, log["attempt"], log["job_id"])
                original = {"path": f"repos/{settings['repository']}/actions/jobs/{job['id']}/logs", "sha256": log["sha256"], "observed_at": log["observed_at"]}
                basis, days, expiry = "original_producer", log["original_retention_days"], log["expires_at"]
            else:
                require(run_id == settings["run_id"] and run_id != str(data["chain"]["plan"]["run_id"]), "run lacks an original availability anchor")
                listing = api.json(f"repos/{settings['repository']}/actions/runs/{run_id}/jobs?filter=latest&per_page=100&page=1")
                jobs = listing["jobs"]
                require(type(listing.get("total_count")) is int and listing["total_count"] == len(jobs) < 100, "planning anchor listing is incomplete")
                name = "mutation-fixture-plan" if settings["scope"] == "fixture" else "mutation-plan"
                matches = [job for job in jobs if job["name"] == name]
                require(len(matches) == 1, "planning anchor is missing or ambiguous")
                job = completed_job(matches[0], run_id)
                require(job["run_attempt"] <= settings["attempt"] and job["conclusion"] == "success", "planning anchor did not succeed")
                original, basis, days = None, "planning", settings["log_retention_days"]
                expiry = (artifacts.timestamp(runs[run_id]["created_at"]) + dt.timedelta(days=days)).isoformat()
            require(str(job["id"]) != settings["job_id"], "current job cannot anchor itself")
            anchors[run_id] = {"version": 1, "repository": settings["repository"], "basis": basis, "job": job,
                "selected_at": now.isoformat(), "original_retention_days": days, "expires_at": expiry, "original_log": original}
        row = anchors[run_id]
        job = completed_job(api.json(f"repos/{settings['repository']}/actions/jobs/{row['job']['id']}"), run_id,
                            row["job"]["run_attempt"], row["job"]["id"])
        require(job == row["job"] and str(job["id"]) != settings["job_id"], "stable anchor job metadata changed")
        current_expiry = artifacts.timestamp(runs[run_id]["created_at"]) + dt.timedelta(days=min(settings["log_retention_days"], row["original_retention_days"]))
        require(row["basis"] != "planning" or artifacts.timestamp(row["expires_at"])
                == artifacts.timestamp(runs[run_id]["created_at"]) + dt.timedelta(days=row["original_retention_days"]),
                "planning anchor original expiry changed")
        require(min(artifacts.timestamp(row["expires_at"]), current_expiry)
                > artifacts.timestamp(data["chain"]["expires_at"]) + tool.MARGIN, "anchor retention policy changed")
        api.probe_job_logs(settings["repository"], run_id, job["run_attempt"], str(job["id"]))
    validate_log_anchors(data, complete=True)


def fresh_inventory(api, data, settings, *, probe=True, allow_current_aggregate=False):
    now = dt.datetime.now(dt.timezone.utc)
    chain = data["chain"]
    artifacts.validate_chain(chain, current_run_id=settings["run_id"], now=now)
    require(len(chain["runs"]) <= 8 and len(data["source_runs"]) <= 10, "referenced run budget exhausted")
    required_until = artifacts.timestamp(chain["expires_at"]) + tool.MARGIN
    entries = referenced_runs(data)
    inventory, runs = {}, {}
    for run_id, entry in entries.items():
        run = artifacts.authenticate_run(api, settings["repository"], tool.WORKFLOW, entry, data["contract"]["files"][tool.WORKFLOW])
        if run_id in {item["run_id"] for item in chain["runs"]}:
            require(1 <= run["run_attempt"] <= chain["max_attempts"], "run attempt budget exhausted")
        if run_id == settings["run_id"]:
            require(run["run_attempt"] == settings["attempt"], "current run advanced during recovery")
        if run_id != settings["run_id"] and run_id in {item["run_id"] for item in chain["runs"]}:
            require(run["run_attempt"] == entry["sealed_attempt"], "sealed predecessor advanced")
        runs[run_id] = run
        for item in artifact_inventory(api, settings["repository"], run_id):
            require(str(item["id"]) not in inventory, "duplicate original artifact ID")
            inventory[str(item["id"])] = item
    for artifact_id, original in data["originals"].items():
        require(artifact_id in inventory and original_metadata(inventory[artifact_id]) == original["metadata"],
                "required original artifact missing or changed")
        log = data["logs"][original["producer_log"]]
        tool.retained_until(api, settings["repository"], inventory[artifact_id], runs[log["run_id"]], required_until,
                            log["original_retention_days"])
    validate_retained(data, pending_aggregate=aggregate_identity(settings) if allow_current_aggregate else None)
    if probe:
        ensure_log_availability(api, data, settings, runs)
    return inventory, runs


def ingest_aggregate_verdict(api, data, settings, inventory, job):
    expected = artifact_name(settings["scope"], data["planned"]["manifest"]["campaign_id"], "aggregate",
                             str(job["run_id"]), job["run_attempt"])
    candidates = [item for item in inventory.values() if item["name"] == expected]
    require(len(candidates) <= 1, "duplicate historical aggregate verdict artifacts")
    if not candidates:
        # Keep the started job in phase_inventories. The shared final gate refuses
        # its missing proof, including when this history is loaded from a snapshot.
        return
    item = candidates[0]
    verified, receipt = load(api, {"artifact_id": item["id"], "archive_digest": item["digest"]},
                             settings["repository"], data["contract"])
    require(receipt["job_id"] == str(job["id"]) and receipt["run_id"] == str(job["run_id"])
            and receipt["attempt"] == job["run_attempt"] and receipt["plan"] == data["chain"]["plan"],
            "historical aggregate verdict producer mismatch")
    proof = verified["aggregate_verdicts"][str(job["id"])]
    require(proof["job"] == job, "historical aggregate job changed during authentication")
    data.setdefault("aggregate_verdicts", {})[str(job["id"])] = proof
    data["originals"][str(item["id"])] = verified["originals"][str(item["id"])]
    data["logs"][proof["producer_log"]] = verified["logs"][proof["producer_log"]]
    data["source_runs"][str(job["run_id"])] = verified["source_runs"][str(job["run_id"])]


def ingest(api, data, settings, inventory, runs, *, include_current):
    """Authenticate only the bounded tail beyond the sealed compact frontier."""
    manifest = data["planned"]["manifest"]
    repository = settings["repository"]
    known = {item["artifact_id"] for item in data["bundles"]}
    prefix = "mutation-" + manifest["campaign_id"] + "-"
    originals = [item for item in inventory.values() if item["name"].startswith(prefix)]
    require(len({item["name"] for item in originals}) == len(originals), "duplicate immutable original name")
    gap = 0
    recording = RecordingAPI(api)
    recording.metadata.update(inventory)
    for entry in data["chain"]["runs"]:
        run_id = entry["run_id"]
        last = settings["attempt"] - (0 if include_current else 1) if run_id == settings["run_id"] else runs[run_id]["run_attempt"]
        first = data["frontier"].get(run_id, 0) + 1
        gap += max(0, last - first + 1)
        if gap > MAX_GAP:
            raise runner.CapacityFailure("missing snapshot gap exceeds three attempts")
        for attempt in range(first, last + 1):
            jobs = list(artifacts.pages(api, f"repos/{repository}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs"))
            prepare_name = "mutation-fixture-prepare" if settings["scope"] == "fixture" else "mutation-prepare"
            decision_names = {prepare_name, aggregate_job_name(settings["scope"]), *native.JOBS.values()}
            for job in jobs:
                if job["name"] in decision_names and job["conclusion"] == "skipped":
                    if job["name"] in native.JOBS.values():
                        kind = next(kind for kind, name in native.JOBS.items() if name == job["name"])
                        expected = native.artifact_name(kind, manifest["campaign_id"], run_id, attempt)
                    else:
                        kind = "prepared" if job["name"] == prepare_name else "aggregate"
                        expected = artifact_name(settings["scope"], manifest["campaign_id"], kind, run_id, attempt)
                    require(not any(item["name"] == expected for item in inventory.values())
                            and f"repos/{repository}/actions/jobs/{job['id']}/logs" not in data["logs"],
                            "skipped decision phase has executed receipt/upload evidence")
            preparations = [job for job in jobs if job["name"] == prepare_name and job.get("started_at") and job["conclusion"] != "skipped"]
            require(all(job["status"] == "completed" and job["conclusion"] == "success" for job in preparations),
                    "started preparation failed; terminal infrastructure failure")
            aggregates = [job for job in jobs if job["name"] == aggregate_job_name(settings["scope"]) and job.get("started_at") and job["conclusion"] != "skipped"]
            native_jobs = [job for job in jobs if job["name"] in native.JOBS.values() and job.get("started_at") and job["conclusion"] != "skipped"]
            data.setdefault("phase_inventories", {})[f"{run_id}/{attempt}"] = preparations + aggregates + native_jobs
            for job in native_jobs:
                native.validate_native_phase(data, job)
            for job in aggregates:
                require(str(job["run_id"]) == run_id and job["run_attempt"] == attempt, "aggregate job attempt mismatch")
                current = (include_current and run_id == settings["run_id"] and attempt == settings["attempt"]
                           and str(job["id"]) == settings["job_id"] and job["status"] == "in_progress"
                           and job["conclusion"] is None)
                if not current:
                    require(job["status"] == "completed", "historical aggregate did not complete")
                    ingest_aggregate_verdict(api, data, settings, inventory, job)
            slot_prefix = "mutation-fixture-slot-" if settings["scope"] == "fixture" else "mutation-slot-"
            workers = [job for job in jobs if re.fullmatch(re.escape(slot_prefix) + r"[0-7]", job["name"])
                       and job.get("started_at") and job.get("conclusion") != "skipped"]
            require(all(job["status"] == "completed" for job in workers), "worker ingestion before attempt completion")
            data["job_inventories"][f"{run_id}/{attempt}"] = workers
            expected_names = {artifacts.artifact_name(manifest["campaign_id"], run_id, attempt, int(job["name"][-1])) for job in workers}
            actual = [item for item in originals if item["name"] in expected_names]
            actual_names = {item["name"] for item in actual}
            for job in workers:
                name = artifacts.artifact_name(manifest["campaign_id"], run_id, attempt, int(job["name"][-1]))
                if name in actual_names:
                    continue
                evidence, log = artifacts.authenticate_capacity_failure(api, manifest, entry, job,
                    data.get("native_admission", {}).get("batch_policy_digest"), repository=repository, workflow=tool.WORKFLOW,
                    required_until=artifacts.timestamp(data["chain"]["expires_at"]) + tool.MARGIN)
                data.setdefault("capacity_failures", {})[str(job["id"])] = evidence
                data["logs"][evidence["producer_log"]] = log
                data["source_runs"][run_id] = entry
                actual_names.add(name)
            require(actual_names == expected_names, "started worker is missing its immutable result")
            for item in actual:
                require(item["id"] not in known, "original artifact repeated beyond frontier")
                require(not item["expired"], "expired original delta")
                require(str(item["workflow_run"]["id"]) == run_id and item["workflow_run"]["head_sha"] == entry["head_sha"],
                        "original delta artifact run mismatch")
                raw = recording.bytes(f"repos/{repository}/actions/artifacts/{item['id']}/zip")
                require(item["digest"] == "sha256:" + artifacts.sha(raw), "original delta archive digest mismatch")
                bundle = artifacts.validate_bundle(artifacts.unpack(raw), manifest, entry, item, repository=repository, workflow=tool.WORKFLOW)
                receipt = bundle["receipt"]
                require(receipt["attempt"] == attempt and any(str(job["id"]) == receipt["job_id"] for job in workers), "delta producer absent from started-job inventory")
                artifacts.authenticate_producer(recording, repository, entry, item, receipt, now=dt.datetime.now(dt.timezone.utc), scope=settings["scope"])
                job = next(job for job in workers if str(job["id"]) == receipt["job_id"])
                require(job["conclusion"] == ("success" if bundle["status"]["state"] == "complete" else "failure"),
                        "worker job conclusion disagrees with immutable verdict")
                compact = {key: value for key, value in bundle.items() if key != "manifest"}
                data["bundles"].append({"artifact_id": item["id"], "bundle": compact, "bundle_digest": model.digest(compact)})
                known.add(item["id"])
            data["frontier"][run_id] = attempt
    # No unseen delta may hide behind a sealed frontier, an omitted job or a future attempt.
    eligible = set()
    for item in originals:
        match = re.fullmatch(re.escape(prefix) + r"run-([1-9][0-9]*)-attempt-([1-9][0-9]*)-slot-([0-7])", item["name"])
        require(match is not None, "malformed original delta name")
        run_id, attempt = match.group(1), int(match.group(2))
        require(run_id in runs and attempt <= runs[run_id]["run_attempt"], "foreign or future original delta")
        require(include_current or run_id != settings["run_id"] or attempt < settings["attempt"],
                "current mutation evidence exists before preparation")
        if run_id != settings["run_id"] or attempt < settings["attempt"] or include_current:
            eligible.add(item["id"])
    require(eligible == known, "unvalidated original delta outside sealed job inventory")
    retain_recording(recording, data)
    return recovered(data, settings, include_current=include_current)


def latest_snapshot(inventory, data, settings, *, allow_prepared=False):
    order = {entry["run_id"]: index for index, entry in enumerate(data["chain"]["runs"])}
    pattern = re.compile(re.escape(f"mutation-{settings['scope']}-recovery-{data['planned']['manifest']['campaign_id']}-") +
                         r"(aggregate|prepared)-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)$")
    candidates, names = [], set()
    for item in inventory.values():
        match = pattern.fullmatch(item["name"])
        if not match:
            continue
        require(item["name"] not in names, "duplicate immutable snapshot name")
        names.add(item["name"])
        kind, run_id, attempt = match.group(1), match.group(2), int(match.group(3))
        require(run_id in order, "snapshot outside explicit predecessor chain")
        if kind == "prepared" and not allow_prepared:
            continue
        if run_id == settings["run_id"] and (attempt > settings["attempt"] or
                (attempt == settings["attempt"] and (not allow_prepared or kind == "aggregate"))):
            continue
        candidates.append(((order[run_id], attempt, kind == "aggregate"), item))
    if not candidates:
        return None
    item = max(candidates, key=lambda pair: pair[0])[1]
    return {"artifact_id": item["id"], "archive_digest": item["digest"]}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class WorkflowAPI(artifacts.CachedMetadata):
    """Bound requests per job; the integration test enforces the attempt-wide sum."""
    def __init__(self, api=None):
        super().__init__(api or artifacts.GitHub())
        self.requests = 0
        self.probed = set()

    def charge(self):
        self.requests += 1
        if self.requests > 800 or time.time() + 60 > runner.COMMAND_DEADLINE:
            raise runner.CapacityFailure("API request or job-time capacity exhausted")

    def rate_status(self, required=0):
        self.charge()
        if hasattr(self.api, "rate_status"):
            response = self.api.rate_status()
        else:
            raw = subprocess.run(["gh", "api", "rate_limit"], check=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, timeout=60).stdout
            response = artifacts.strict_json(raw)
        core = response["resources"]["core"]
        require(all(type(core[key]) is int for key in ("limit", "remaining", "reset"))
                and 0 <= core["remaining"] <= core["limit"] and core["reset"] > 0, "invalid job-token rate observation")
        observed = {key: core[key] for key in ("limit", "remaining", "reset")}
        observed.update(observed_at=dt.datetime.now(dt.timezone.utc).isoformat(), required=required,
                        credential="current-job-GITHUB_TOKEN")
        self.last_rate_observation = observed
        if core["remaining"] < required:
            raise runner.CapacityFailure("current job-token REST budget is insufficient; wait outside runner slots")
        return observed

    def json(self, path):
        page = re.search(r"/artifacts\?per_page=100&page=([0-9]+)$", path)
        if page and int(page.group(1)) > MAX_PAGES:
            raise runner.CapacityFailure("artifact inventory exceeds bounded page capacity")
        if path not in self.cache:
            self.charge()
        return super().json(path)

    def bytes(self, path):
        self.charge()
        return super().bytes(path)

    def probe_job_logs(self, repository, run_id, attempt, job_id):
        require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository)
                and re.fullmatch(r"[1-9][0-9]*", str(run_id)) and re.fullmatch(r"[1-9][0-9]*", str(job_id))
                and type(attempt) is int and 1 <= attempt <= 51, "invalid job log identity")
        identity = (repository, str(run_id), attempt, str(job_id))
        if identity in self.probed:
            return
        self.charge()
        if hasattr(self.api, "probe_job_logs"):
            self.api.probe_job_logs(*identity)
            self.probed.add(identity)
            return
        resource = f"repository={repository} run={run_id} attempt={attempt} job={job_id}"
        request = urllib.request.Request(f"https://api.github.com/repos/{repository}/actions/jobs/{job_id}/logs",
            headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json"})
        try:
            try:
                response = urllib.request.build_opener(NoRedirect).open(request, timeout=60)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                valid = False
                try:
                    raw_location = response.headers.get("Location", "")
                    location = urllib.parse.urlparse(raw_location)
                    valid = (location.scheme == "https" and bool(location.hostname)
                             and location.username is None and location.password is None
                             and location.port != 0 and not any(char.isspace() for char in raw_location))
                except ValueError:
                    pass
                require(response.status == 302 and valid,
                        f"job log availability failed {resource} status={response.status}")
        except (urllib.error.URLError, OSError, http.client.HTTPException) as error:
            raise ValueError(f"job log availability failed {resource} transport={type(error).__name__}") from None
        self.probed.add(identity)
