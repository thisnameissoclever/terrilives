"""Authenticated immutable mutation deltas. No downloaded code is executed."""

import base64
import datetime as dt
import hashlib
import io
import json
import re
import stat
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

import mutation_campaign as model

MAX_ARCHIVE = 128 * 1024 * 1024
MAX_MEMBER = 32 * 1024 * 1024
MAX_MEMBERS = 10000


def require(condition, message):
    if not condition:
        raise ValueError(message)


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("nonfinite JSON")))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(name):
    require(isinstance(name, str) and name and "\\" not in name and ":" not in name
            and "\x00" not in name and not name.startswith("/")
            and all(part not in ("", ".", "..") for part in name.split("/")), "unsafe archive path")
    return PurePosixPath(name)


def outgoing_inventory(directory):
    """Inventory complete retained files; report capacity separately from unsafe paths."""
    root = Path(directory).resolve(strict=True)
    require(root.is_dir() and not Path(directory).is_symlink() and not getattr(Path(directory), "is_junction", lambda: False)(),
            "unsafe outgoing artifact root")
    members = []
    for path in sorted(root.rglob("*")):
        require(not path.is_symlink() and not getattr(path, "is_junction", lambda: False)()
                and path.resolve().is_relative_to(root), "unsafe outgoing artifact path")
        if path.is_dir():
            continue
        before = path.stat()
        require(stat.S_ISREG(before.st_mode), "outgoing artifact contains nonregular member")
        name = path.relative_to(root).as_posix()
        safe_path(name)
        digest, length = hashlib.sha256(), 0
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                length += len(block)
                digest.update(block)
        after = path.stat()
        require(length == before.st_size == after.st_size and before.st_mtime_ns == after.st_mtime_ns,
                "outgoing artifact changed during inventory")
        members.append({"path": name, "size": length, "sha256": digest.hexdigest()})
    total = sum(row["size"] for row in members)
    largest = max((row["size"] for row in members), default=0)
    violations = []
    if len(members) > MAX_MEMBERS:
        violations.append("member_count")
    if largest > MAX_MEMBER:
        violations.append("member_bytes")
    if total > MAX_ARCHIVE:
        violations.append("expanded_bytes")
    return {"members": members, "member_count": len(members), "expanded_bytes": total,
            "maximum_member_bytes": largest, "violations": violations,
            "inventory_digest": model.digest(members)}


def validate_outgoing_inventory(value):
    members = value["members"]
    require(isinstance(members, list) and members == sorted(members, key=lambda row: row["path"]), "capacity inventory order changed")
    names = set()
    for row in members:
        require(set(row) == {"path", "size", "sha256"}, "invalid capacity member declaration")
        safe_path(row["path"])
        require(row["path"] not in names and type(row["size"]) is int and row["size"] >= 0
                and re.fullmatch(r"[0-9a-f]{64}", row["sha256"]), "invalid capacity inventory member")
        names.add(row["path"])
    total, largest = sum(row["size"] for row in members), max((row["size"] for row in members), default=0)
    violations = (["member_count"] if len(members) > MAX_MEMBERS else []) + (["member_bytes"] if largest > MAX_MEMBER else []) + (["expanded_bytes"] if total > MAX_ARCHIVE else [])
    require(value == {"members": members, "member_count": len(members), "expanded_bytes": total,
        "maximum_member_bytes": largest, "violations": violations, "inventory_digest": model.digest(members)},
        "capacity inventory totals or digest changed")
    return violations


def emit_capacity_failure(bundle, inventory):
    require(validate_outgoing_inventory(inventory), "capacity marker has no actual overflow")
    receipt = bundle["receipt"]
    payload = {"version": 1, "state": "capacity_failure", "reason": "outgoing_artifact_capacity", "receipt": receipt,
        "manifest_digest": model.digest(bundle["manifest"]), "batch_policy_digest": receipt.get("batch_policy_digest"),
        "inventory": inventory, "prior_status": bundle["status"], "accepted_production_outcomes": 0,
        "raw_retention": "Complete oversized bytes remain local; no raw result artifact was uploaded or accepted."}
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    require(len(raw) <= MAX_MEMBER, "complete capacity marker exceeds existing member bound")
    encoded = base64.b64encode(raw).decode()
    chunks = [encoded[index:index + 3072] for index in range(0, len(encoded), 3072)]
    identity = {"job_id": receipt["job_id"], "sha256": sha(raw), "bytes": len(raw), "chunks": len(chunks)}
    print("MUTATION_CAPACITY_START " + json.dumps(identity, separators=(",", ":")), flush=True)
    for index, content in enumerate(chunks):
        print("MUTATION_CAPACITY_CHUNK " + json.dumps({"job_id": receipt["job_id"], "index": index, "data": content}, separators=(",", ":")), flush=True)
    print("MUTATION_CAPACITY_END " + json.dumps(identity, separators=(",", ":")), flush=True)
    return payload


def capacity_marker(raw_log):
    rows = []
    for line in raw_log.decode("utf-8").splitlines():
        match = re.fullmatch(r"(?:\S+ )?MUTATION_CAPACITY_(START|CHUNK|END) (.*)", line)
        if match:
            require(len(line.encode()) <= 4096, "capacity marker line exceeds bounded encoding")
            rows.append((match[1], strict_json(match[2])))
    if not rows:
        return None
    require(len(raw_log) <= MAX_ARCHIVE, "capacity producer log exceeds retained bound")
    require(len(rows) >= 3 and rows[0][0] == "START" and rows[-1][0] == "END" and rows[0][1] == rows[-1][1],
            "incomplete or conflicting capacity marker")
    header = rows[0][1]
    require(set(header) == {"job_id", "sha256", "bytes", "chunks"} and type(header["chunks"]) is int
            and header["chunks"] == len(rows) - 2 and 0 < header["bytes"] <= MAX_MEMBER, "invalid capacity marker header")
    parts = []
    for index, (kind, row) in enumerate(rows[1:-1]):
        require(kind == "CHUNK" and set(row) == {"job_id", "index", "data"} and row["job_id"] == header["job_id"]
                and row["index"] == index and isinstance(row["data"], str) and len(row["data"]) <= 3072, "capacity marker chunk changed")
        parts.append(row["data"])
    raw = base64.b64decode("".join(parts), validate=True)
    require(len(raw) == header["bytes"] and sha(raw) == header["sha256"], "capacity marker bytes changed")
    value = strict_json(raw)
    require(value["receipt"]["job_id"] == header["job_id"] and value["version"] == 1 and value["state"] == "capacity_failure"
            and value["reason"] == "outgoing_artifact_capacity" and value["accepted_production_outcomes"] == 0 and validate_outgoing_inventory(value["inventory"]), "invalid terminal capacity evidence")
    require(not re.search(r"(?:^|\n)(?:\S+ )?MUTATION_ARTIFACT_ID=", raw_log.decode()), "capacity marker contradicts uploaded result")
    return value


def validate_capacity_receipt(value, manifest, entry, job, policy_digest, repository, workflow):
    receipt = value["receipt"]
    scope = manifest["context"]["inputs"]["computation_scope"]
    require(type(receipt["attempt"]) is int and receipt["attempt"] > 0 and type(receipt["slot"]) is int and 0 <= receipt["slot"] < 8
            and job["status"] == "completed" and job["conclusion"] == "failure"
            and job["run_id"] == int(entry["run_id"]) and job["run_attempt"] == receipt["attempt"]
            and str(job["id"]) == receipt["job_id"]
            and job["name"] == f"mutation-{'fixture-' if scope == 'fixture' else ''}slot-{receipt['slot']}",
            "capacity producer job or verdict changed")
    require(receipt["repository"] == repository and receipt["workflow"] == workflow
            and receipt["workflow_sha"] == entry["workflow_sha"] and receipt["run_id"] == entry["run_id"]
            and all(receipt["checkout"][key] == entry[key] for key in ("commit", "tree", "ref"))
            and receipt["checkout"]["repository"] == repository and receipt["checkout"]["clean"] is True
            and receipt["campaign_id"] == manifest["campaign_id"] and receipt["input_fingerprint"] == manifest["input_fingerprint"]
            and value["manifest_digest"] == model.digest(manifest)
            and value["batch_policy_digest"] == receipt.get("batch_policy_digest") == policy_digest,
            "capacity evidence computation binding changed")
    require(type(receipt["log_retention_days"]) is int and receipt["log_retention_days"] > 0,
            "capacity producer omitted original retention")


def authenticate_capacity_failure(api, manifest, entry, job, policy_digest, *, repository, workflow, required_until):
    run = authenticate_run(api, repository, workflow, entry, manifest["context"]["inputs"]["workflow_file_digest"])
    attempt = api.json(f"repos/{repository}/actions/runs/{entry['run_id']}/attempts/{job['run_attempt']}")
    require(attempt["id"] == int(entry["run_id"]) and attempt["run_attempt"] == job["run_attempt"]
            and attempt["head_sha"] == entry["head_sha"], "capacity producer attempt changed")
    jobs = list(pages(api, f"repos/{repository}/actions/runs/{entry['run_id']}/attempts/{job['run_attempt']}/jobs", "jobs"))
    require([row for row in jobs if row["id"] == job["id"]] == [job], "capacity producer job differs from authenticated metadata")
    path = f"repos/{repository}/actions/jobs/{job['id']}/logs"
    try:
        raw = api.bytes(path)
    except (KeyError, subprocess.SubprocessError) as error:
        raise ValueError("started worker is missing its immutable result and capacity evidence") from error
    value = capacity_marker(raw)
    require(value is not None, "started worker is missing its immutable result and capacity evidence")
    validate_capacity_receipt(value, manifest, entry, job, policy_digest, repository, workflow)
    now = dt.datetime.now(dt.timezone.utc)
    require(timestamp(job["started_at"]) <= timestamp(job["completed_at"]) <= now, "capacity job lifetime changed")
    expires = timestamp(run["created_at"]) + dt.timedelta(days=value["receipt"]["log_retention_days"])
    require(expires > required_until, "capacity producer log retention is insufficient")
    log = {"bytes": base64.b64encode(raw).decode(), "sha256": sha(raw), "run_id": entry["run_id"],
        "attempt": job["run_attempt"], "job_id": str(job["id"]), "observed_at": now.isoformat(),
        "original_retention_days": value["receipt"]["log_retention_days"], "expires_at": expires.isoformat()}
    return {"job": job, "payload": value, "producer_log": path}, log


def unpack(raw):
    """Read bounded regular ZIP members into memory, never into an executable tree."""
    require(len(raw) <= MAX_ARCHIVE, "archive exceeds byte limit")
    result = {}
    total = 0
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(archive.infolist()) <= MAX_MEMBERS, "too many archive members")
        for member in archive.infolist():
            safe_path(member.orig_filename)
            safe_path(member.filename)
            require(member.filename not in result, "duplicate archive member")
            mode = member.external_attr >> 16
            require(not member.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG),
                    "archive contains a link or nonregular member")
            require(not member.flag_bits & 1 and member.file_size <= MAX_MEMBER,
                    "encrypted or oversized archive member")
            total += member.file_size
            require(total <= MAX_ARCHIVE, "expanded archive exceeds byte limit")
            with archive.open(member) as stream:
                content = stream.read(MAX_MEMBER + 1)
            require(len(content) == member.file_size, "archive member size mismatch")
            result[member.filename] = content
    return result


def timestamp(value):
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "timestamp requires a timezone")
    return parsed


class GitHub:
    """Inject json()/bytes() in tests. gh owns authentication, never artifact data."""
    def __init__(self):
        self._raw_api_options = None

    def bytes(self, path):
        require(path.startswith("repos/"), "API request outside repository endpoints")
        if self._raw_api_options is None:
            help_bytes = subprocess.run(["gh", "api", "--help"], check=True, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=60).stdout
            # This offline probe permits exact captured bytes without rendering them.
            supported = re.search(rb"(?m)^\s*--allow-escape-sequences(?:\s|$)", help_bytes)
            self._raw_api_options = ["--allow-escape-sequences"] if supported else []
        return subprocess.run(["gh", "api", path, *self._raw_api_options], check=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=60).stdout

    def json(self, path):
        return strict_json(self.bytes(path))


class CachedMetadata:
    """Avoid re-fetching the same immutable attempt's job pages for every slot."""
    def __init__(self, api):
        self.api, self.cache = api, {}

    def json(self, path):
        if path not in self.cache:
            self.cache[path] = self.api.json(path)
        return self.cache[path]

    def bytes(self, path):
        return self.api.bytes(path)


def pages(api, path, key):
    page = 1
    while True:
        response = api.json(f"{path}?per_page=100&page={page}")
        rows = response[key]
        require(isinstance(rows, list), "invalid paginated API response")
        yield from rows
        if len(rows) < 100:
            break
        page += 1
        require(page <= 10000, "API pagination did not terminate")


def artifact_name(campaign_id, run_id, attempt, slot):
    return f"mutation-{campaign_id}-run-{run_id}-attempt-{attempt}-slot-{slot}"


def validate_chain(chain, *, current_run_id, now):
    require(chain.get("version") == 1 and isinstance(chain.get("runs"), list), "invalid chain schema")
    require(1 <= chain.get("max_attempts", 0) <= 51, "invalid finite attempt limit")
    require(1 <= chain.get("retention_days", 0) <= 90, "invalid retention limit")
    start, end = timestamp(chain["started_at"]), timestamp(chain["expires_at"])
    require(start <= now < end and end - start <= dt.timedelta(days=chain["retention_days"]),
            "expired or invalid campaign lifetime")
    entries = {str(item["run_id"]): item for item in chain["runs"]}
    require(all(re.fullmatch(r"[1-9][0-9]*", key) for key in entries), "invalid run identity")
    require(len(entries) == len(chain["runs"]) and current_run_id in entries, "duplicate or missing chain run")
    seen, cursor = [], current_run_id
    while cursor is not None:
        require(cursor not in seen, "predecessor cycle")
        require(cursor in entries, "missing predecessor")
        seen.append(cursor)
        cursor = entries[cursor].get("predecessor")
    require(set(seen) == set(entries), "unrelated run outside predecessor chain")
    for item in entries.values():
        for key in ("head_sha", "workflow_sha", "commit", "tree"):
            require(re.fullmatch(r"[0-9a-f]{40}", item.get(key, "")), f"invalid chain {key}")
        require(isinstance(item.get("ref"), str) and item["ref"], "missing chain checkout ref")
    return [entries[key] for key in reversed(seen)]


def authenticate_run(api, repository, workflow, entry, workflow_digest):
    run_id = str(entry["run_id"])
    prefix = f"repos/{repository}"
    run = api.json(f"{prefix}/actions/runs/{run_id}")
    require(str(run["id"]) == run_id and run["repository"]["full_name"] == repository
            and run["head_repository"]["full_name"] == repository,
            "foreign repository or run")
    require(run["path"] == workflow and run["head_sha"] == entry["head_sha"],
            "wrong workflow or run head")
    source = api.json(f"{prefix}/contents/{workflow}?ref={entry['workflow_sha']}")
    require(source.get("encoding") == "base64"
            and sha(base64.b64decode(source["content"])) == workflow_digest,
            "workflow version mismatch")
    commit = api.json(f"{prefix}/git/commits/{entry['commit']}")
    require(commit["sha"] == entry["commit"] and commit["tree"]["sha"] == entry["tree"],
            "checkout commit/tree mismatch")
    return run


def authenticate_producer(api, repository, entry, artifact, receipt, *, now, scope="production",
                          job_name=None, marker="MUTATION_PRODUCER"):
    """Bind payload to an API-authenticated attempt job and upload-action output."""
    run_id, attempt = str(entry["run_id"]), receipt["attempt"]
    require(type(attempt) is int and attempt > 0, "invalid producer attempt")
    prefix = f"repos/{repository}/actions/runs/{run_id}"
    attempt_run = api.json(f"{prefix}/attempts/{attempt}")
    require(str(attempt_run["id"]) == run_id and attempt_run["run_attempt"] == attempt
            and attempt_run["head_sha"] == entry["head_sha"], "producer attempt mismatch")
    jobs = list(pages(api, f"{prefix}/attempts/{attempt}/jobs", "jobs"))
    matches = [job for job in jobs if str(job["id"]) == str(receipt["job_id"])]
    require(len(matches) == 1, "missing producer job")
    job = matches[0]
    expected_name = job_name or f"mutation-{'fixture-' if scope == 'fixture' else ''}slot-{receipt['slot']}"
    require(job["run_id"] == int(run_id) and job["run_attempt"] == attempt and job["name"] == expected_name,
            "producer job mismatch")
    created = timestamp(artifact["created_at"])
    require(timestamp(job["started_at"]) <= created <= now
            and (not job.get("completed_at") or created <= timestamp(job["completed_at"])),
            "artifact outside producer job lifetime")
    raw_log = api.bytes(f"repos/{repository}/actions/jobs/{job['id']}/logs")
    require(capacity_marker(raw_log) is None, "capacity failure contradicts result artifact")
    log = raw_log.decode("utf-8")
    receipts = []
    for line in log.splitlines():
        prefix = marker + " "
        if prefix in line:
            try:
                receipts.append(strict_json(line.split(prefix, 1)[1]))
            except (ValueError, TypeError):
                pass
    require(receipt in receipts, "producer receipt absent from authenticated job log")
    require(re.search(rf"^(?:\S+ )?MUTATION_ARTIFACT_ID={artifact['id']}\s*$", log, re.MULTILINE) is not None,
            "artifact ID absent from producer upload log")
    return {"job": job, "log_bytes": raw_log, "log_sha256": sha(raw_log)}


class AuthenticatedRecovery(dict):
    """In-process capability issued after the workflow adapter authenticates evidence.

    Plain decoded JSON is never accepted at the runner seam. This is not a
    cryptographic object; the pinned local adapter owns its creation.
    """
    def __init__(self, recovered, manifest, run_id, attempt, include_current):
        super().__init__(recovered)
        self.binding = (manifest["input_fingerprint"], run_id, attempt, include_current)


def checked_recovery(value, manifest, *, run_id, attempt, include_current):
    require(isinstance(value, AuthenticatedRecovery) and value.binding ==
            (manifest["input_fingerprint"], run_id, attempt, include_current),
            "unverified or stale prepared recovery input")
    records = model.merge_deltas(manifest, value["deltas"], allowed_run_ids=set(value["allowed_run_ids"]),
        current_run_id=run_id, current_attempt=attempt, include_current=include_current)
    require(records == value["records"], "prepared records differ from reconstructed deltas")
    return value


def validate_bundle(files, manifest, entry, artifact, *, repository, workflow):
    require("bundle.json" in files, "missing delta bundle")
    bundle = strict_json(files["bundle.json"])
    require(bundle.get("version") == 1, "invalid bundle schema")
    receipt, delta = bundle["receipt"], bundle.get("delta")
    require(receipt["repository"] == repository and receipt["workflow"] == workflow
            and receipt["run_id"] == str(entry["run_id"])
            and receipt["workflow_sha"] == entry["workflow_sha"], "producer metadata mismatch")
    require(receipt["checkout"] == {"repository": repository, "commit": entry["commit"],
            "tree": entry["tree"], "ref": entry["ref"], "clean": True}, "producer checkout mismatch")
    require(receipt["input_fingerprint"] == manifest["input_fingerprint"]
            and receipt["campaign_id"] == manifest["campaign_id"], "foreign fingerprint")
    require(artifact["name"] == artifact_name(manifest["campaign_id"], receipt["run_id"],
            receipt["attempt"], receipt["slot"]), "wrong immutable artifact name")
    require(0 <= receipt["slot"] < 8, "invalid artifact slot")
    require(bundle["manifest"] == manifest, "artifact manifest differs from plan")
    if delta is not None:
        provenance = delta["provenance"]
        for key in ("repository", "workflow", "run_id", "attempt", "checkout", "input_fingerprint", "execution_id", "batch_id"):
            require(provenance[key] == receipt[key], "delta producer mismatch")
        require(delta["slot"] == receipt["slot"], "delta slot mismatch")
        reference = delta["raw_report_ref"]
        raw = files.get(reference["path"])
        require(raw is not None and sha(raw) == reference["digest"], "raw report digest mismatch")
        parsed = strict_json(raw)
        rebuilt = model.validate_report(manifest, delta["slot"], delta["batch_ids"], parsed,
            provenance=provenance, raw_report_ref=reference, exit_kind=delta["exit_kind"])
        require(rebuilt == delta, "delta differs from authenticated raw report")
        for outcome in [delta["baseline"]["outcome"]] + [record["outcome"] for record in delta["records"]]:
            for key in ("log_path", "diff_path"):
                if outcome[key] is not None:
                    require("evidence/" + str(safe_path(outcome[key])) in files, "missing referenced evidence")
    require(bundle["status"]["state"] in {"complete", "incomplete_with_progress", "incomplete_without_progress",
            "baseline_failure", "policy_failure", "infrastructure_failure", "capacity_failure"}, "invalid worker status")
    return bundle


def recover(api, manifest, chain, *, current_run_id, current_attempt, include_current=False, now=None):
    """Return only authenticated bundles/deltas from the explicit bounded chain."""
    model.validate_manifest(manifest)
    api = CachedMetadata(api)
    now = now or dt.datetime.now(dt.timezone.utc)
    entries = validate_chain(chain, current_run_id=current_run_id, now=now)
    require(1 <= current_attempt <= chain["max_attempts"], "attempt budget exhausted")
    repository = manifest["context"]["checkout"]["repository"]
    workflow = manifest["context"]["run"]["workflow"]
    workflow_digest = manifest["context"]["inputs"]["workflow_file_digest"]
    bundles, deltas, seen_names = [], [], set()
    for entry in entries:
        run = authenticate_run(api, repository, workflow, entry, workflow_digest)
        require(str(entry["run_id"]) != current_run_id or now - timestamp(run["created_at"]) < dt.timedelta(days=30),
                "run rerun lifetime exhausted")
        found = 0
        prefix = f"mutation-{manifest['campaign_id']}-"
        for artifact in pages(api, f"repos/{repository}/actions/runs/{entry['run_id']}/artifacts", "artifacts"):
            if not artifact["name"].startswith(prefix):
                continue
            require(artifact["name"] not in seen_names, "duplicate immutable artifact name")
            seen_names.add(artifact["name"])
            require(not artifact["expired"] and timestamp(artifact["expires_at"]) > now, "expired artifact")
            require(str(artifact["workflow_run"]["id"]) == str(entry["run_id"])
                    and artifact["workflow_run"]["head_sha"] == entry["head_sha"], "artifact run mismatch")
            raw = api.bytes(f"repos/{repository}/actions/artifacts/{artifact['id']}/zip")
            require(artifact.get("digest") == "sha256:" + sha(raw), "artifact byte digest mismatch")
            bundle = validate_bundle(unpack(raw), manifest, entry, artifact,
                                     repository=repository, workflow=workflow)
            bundle["manifest"] = manifest
            receipt = bundle["receipt"]
            require(receipt["attempt"] <= chain["max_attempts"] and receipt["attempt"] <= run["run_attempt"],
                    "artifact exceeds attempt budget")
            if receipt["run_id"] == current_run_id:
                require(receipt["attempt"] <= current_attempt, "future artifact attempt")
                if receipt["attempt"] == current_attempt and not include_current:
                    continue
            authenticate_producer(api, repository, entry, artifact, receipt, now=now,
                                  scope=manifest["context"]["inputs"].get("computation_scope", "production"))
            bundles.append(bundle)
            if bundle["delta"] is not None:
                deltas.append(bundle["delta"])
            found += 1
        require(str(entry["run_id"]) == current_run_id or found > 0, "missing predecessor evidence")
    allowed = {str(entry["run_id"]) for entry in entries}
    records = model.merge_deltas(manifest, deltas, allowed_run_ids=allowed,
        current_run_id=current_run_id, current_attempt=current_attempt, include_current=include_current)
    return {"bundles": bundles, "deltas": deltas, "records": records, "allowed_run_ids": sorted(allowed)}


def plan_artifact_name(scope, run_id, attempt):
    require(scope in {"fixture", "production"}, "invalid plan scope")
    return f"mutation-{'fixture-' if scope == 'fixture' else ''}plan-run-{run_id}-attempt-{attempt}"


def recover_plan(api, chain, *, current_run_id, current_attempt, repository, workflow, workflow_digest, scope, now=None):
    """Bootstrap only the owner-selected root plan; its payload cannot attest itself."""
    now = now or dt.datetime.now(dt.timezone.utc)
    entries = validate_chain(chain, current_run_id=current_run_id, now=now)
    selected = chain["plan"]
    entry = entries[0]
    require(str(selected["run_id"]) == str(entry["run_id"]), "plan must belong to the chain root")
    run = authenticate_run(api, repository, workflow, entry, workflow_digest)
    require(type(selected["attempt"]) is int and 1 <= selected["attempt"] <= min(run["run_attempt"], chain["max_attempts"]),
            "invalid selected plan attempt")
    require(str(selected["run_id"]) != current_run_id or selected["attempt"] <= current_attempt, "future plan attempt")
    artifact = api.json(f"repos/{repository}/actions/artifacts/{selected['artifact_id']}")
    require(artifact["id"] == selected["artifact_id"] and str(artifact["workflow_run"]["id"]) == str(entry["run_id"])
            and artifact["workflow_run"]["head_sha"] == entry["head_sha"], "plan artifact run mismatch")
    require(not artifact["expired"] and timestamp(artifact["expires_at"]) > now, "expired plan artifact")
    require(artifact["name"] == plan_artifact_name(scope, selected["run_id"], selected["attempt"]), "wrong plan artifact name")
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{artifact['id']}/zip")
    require(artifact.get("digest") == "sha256:" + sha(raw), "plan archive digest mismatch")
    files = unpack(raw)
    require("plan.json" in files, "missing original plan")
    planned = strict_json(files["plan.json"])
    require(planned.get("version") == 1, "invalid plan schema")
    manifest = model.validate_manifest(planned["manifest"])
    require(manifest["context"]["inputs"]["workflow_file_digest"] == workflow_digest
            and manifest["context"]["inputs"]["computation_scope"] == scope
            and manifest["context"]["inputs"]["calibration_digest"] == model.digest(planned["calibration"]),
            "plan execution contract mismatch")
    receipt = dict(planned["producer"], plan_digest=sha(files["plan.json"]))
    require(receipt["repository"] == repository and receipt["workflow"] == workflow
            and receipt["workflow_sha"] == entry["workflow_sha"] and receipt["run_id"] == str(selected["run_id"])
            and receipt["attempt"] == selected["attempt"] and receipt["scope"] == scope,
            "plan producer mismatch")
    require(receipt["checkout"] == {"repository": repository, "commit": entry["commit"], "tree": entry["tree"],
            "ref": entry["ref"], "clean": True} == manifest["context"]["checkout"], "plan checkout mismatch")
    require(receipt["input_fingerprint"] == manifest["input_fingerprint"]
            and receipt["campaign_id"] == manifest["campaign_id"], "plan identity mismatch")
    authenticate_producer(api, repository, entry, artifact, receipt, now=now, scope=scope,
        job_name="mutation-fixture-plan" if scope == "fixture" else "mutation-plan", marker="MUTATION_PLAN")
    return planned
