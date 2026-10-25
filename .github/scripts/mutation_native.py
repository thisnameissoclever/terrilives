"""Same-run native measurements and explicit external admission; zero game coverage."""

import base64
import contextlib
import copy
import datetime as dt
import io
import json
import math
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import time
import uuid
import zipfile

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_runner as runner
import mutation_tool as tool

require = artifacts.require
JOBS = {"pilot": "mutation-native-pilot", "report": "mutation-native-pilot-report", "admission": "mutation-admission"}
MARKERS = {"pilot": "NATIVE_PILOT", "report": "NATIVE_REPORT", "admission": "NATIVE_ADMISSION"}
UPLOADS = {"pilot": "Upload native diagnostic evidence", "report": "Upload finished native report", "admission": "Upload native admission verdict"}
REVIEW_REQUIRED = "native_review_required"
REVIEW_EXIT = 24
PAYLOAD_LIMIT = 2 * 1024 * 1024
CONTROL_NAME = "crates/terri-core/src/appearance.rs: replace F32Bits::value -> f32 with 0.0"
SURVIVOR_NAME = "crates/terri-core/src/rng.rs: replace | with ^ in SimRng::from_seed"
CALIBRATION_LOGS = ("calibration/build.log", "calibration/test.log")


class NativeFailure(ValueError):
    def __init__(self, state, message):
        require(state in {"baseline_failure", "policy_failure", "infrastructure_failure", "capacity_failure"}, "invalid native failure state")
        super().__init__(message)
        self.state = state


def compact_json(path, value=None, *, limit=None):
    """Atomically retain the complete JSON value; never compact raw tool evidence."""
    path = Path(path)
    original = artifacts.strict_json(path.read_bytes()) if value is None else value
    raw = (json.dumps(original, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()
    if len(raw) > (artifacts.MAX_MEMBER if limit is None else limit):
        raise runner.CapacityFailure("complete compact JSON exceeds its unchanged member bound")
    require(artifacts.strict_json(raw) == original, "compact JSON changed its complete payload")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".compact.tmp")
    temporary.write_bytes(raw)
    temporary.replace(path)
    require(artifacts.strict_json(path.read_bytes()) == original, "compact JSON write changed payload")
    return {"size": len(raw), "sha256": artifacts.sha(raw)}


def retain_calibration_logs(scratch, planned):
    declared = {}
    for phase, name in zip(("build", "test"), CALIBRATION_LOGS):
        source = Path(scratch) / f"calibration.json.{phase}.log"
        require(source.is_file() and not source.is_symlink(), "missing original calibration log")
        raw = source.read_bytes()
        if len(raw) > artifacts.MAX_MEMBER:
            raise runner.CapacityFailure("calibration log exceeds unchanged member bound")
        target = Path(scratch) / "plan" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        declared[name] = {"size": len(raw), "sha256": artifacts.sha(raw)}
    planned["calibration_evidence"] = declared


def validate_plan_files(files, planned):
    declared = planned.get("calibration_evidence")
    require(isinstance(declared, dict) and set(declared) == set(CALIBRATION_LOGS), "original plan lacks exact calibration-log declarations")
    require(set(files) == {"plan.json", *CALIBRATION_LOGS}, "undeclared original plan artifact member")
    for name, expected in declared.items():
        raw = files[name]
        require(len(raw) <= artifacts.MAX_MEMBER and len(raw) == expected["size"]
                and artifacts.sha(raw) == expected["sha256"], "original calibration log changed or missing")
    require(sum(map(len, files.values())) <= artifacts.MAX_ARCHIVE, "original plan archive exceeds unchanged bound")


def binding(planned, chain):
    manifest = planned["manifest"]
    require(manifest["context"]["inputs"]["computation_scope"] == "production", "native admission requires the full production plan")
    return {"version": 1, "plan": chain["plan"], "campaign_id": manifest["campaign_id"],
        "input_fingerprint": manifest["input_fingerprint"], "manifest_digest": model.digest(manifest),
        "calibration_digest": model.digest(planned["calibration"]), "tool": planned["orchestration"]["tool"],
        "qualification": planned["orchestration"]["qualification"],
        "runtime": manifest["context"]["inputs"]["cargo_mutants_identity"]["authenticated_contract"]["runtime"],
        "policy": {key: chain[key] for key in ("started_at", "expires_at", "max_attempts", "retention_days")}}


def artifact_name(kind, campaign_id, run_id, attempt):
    require(kind in JOBS, "unknown native decision kind")
    return f"mutation-native-{campaign_id}-{kind}-run-{run_id}-attempt-{attempt}"


def reference(api, repository, artifact_id):
    metadata = api.json(f"repos/{repository}/actions/artifacts/{int(artifact_id)}")
    return {"artifact_id": metadata["id"], "archive_digest": metadata["digest"]}


def emit(directory, kind, payload, settings, planned, chain, checkout):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    files = {}
    for path in sorted(directory.rglob("*")):
        require(not path.is_symlink(), "unsafe native evidence member")
        if path.is_dir():
            continue
        require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode), "unsafe native evidence member")
        name = path.relative_to(directory).as_posix()
        require(name not in ("native.json", "receipt.json"), "native evidence directory is not fresh")
        raw = path.read_bytes()
        if len(raw) > artifacts.MAX_MEMBER:
            raise runner.CapacityFailure("native raw member exceeds unchanged bound")
        files[name] = {"size": len(raw), "sha256": artifacts.sha(raw)}
    payload = dict(payload, version=1, binding=binding(planned, chain), accepted_production_outcomes=0, raw_files=files)
    compact_json(directory / "native.json", payload, limit=PAYLOAD_LIMIT)
    receipt = {"version": 1, "kind": kind, "scope": "production", "repository": settings["repository"],
        "workflow": tool.WORKFLOW, "workflow_sha": settings["workflow_sha"], "head_sha": settings["head_sha"],
        "run_id": settings["run_id"], "attempt": settings["attempt"], "job_id": settings["job_id"],
        "checkout": checkout, "host_provenance": settings.get("host_provenance", {}),
        "contract": planned["orchestration"]["contract"],
        "binding_digest": model.digest(payload["binding"]), "state": payload["state"],
        "payload_sha256": artifacts.sha((directory / "native.json").read_bytes()),
        "log_retention_days": settings["log_retention_days"]}
    compact_json(directory / "receipt.json", receipt)
    if sum(path.stat().st_size for path in directory.rglob("*") if path.is_file()) > artifacts.MAX_ARCHIVE:
        raise runner.CapacityFailure("native evidence archive exceeds unchanged bound")
    print(MARKERS[kind] + " " + json.dumps(receipt, sort_keys=True, separators=(",", ":")), flush=True)
    return receipt, payload


def authenticate(api, selected, kind, planned, chain, repository):
    artifact = api.json(f"repos/{repository}/actions/artifacts/{selected['artifact_id']}")
    require(artifact["id"] == selected["artifact_id"] and artifact["digest"] == selected["archive_digest"], "native artifact reference changed")
    started = time.monotonic()
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{artifact['id']}/zip")
    download_seconds = time.monotonic() - started
    require(artifact["digest"] == "sha256:" + artifacts.sha(raw), "native archive digest mismatch")
    files = artifacts.unpack(raw)
    receipt, payload = (artifacts.strict_json(files[name]) for name in ("receipt.json", "native.json"))
    expected = binding(planned, chain)
    require(receipt["version"] == payload["version"] == 1 and receipt["kind"] == kind and receipt["scope"] == "production"
            and receipt["repository"] == repository and receipt["contract"] == planned["orchestration"]["contract"]
            and receipt["binding_digest"] == model.digest(expected) and payload["binding"] == expected
            and payload["accepted_production_outcomes"] == 0, "native evidence contract mismatch")
    require(receipt["run_id"] == str(chain["plan"]["run_id"]), "native evidence must belong to the original plan run")
    require(artifact["name"] == artifact_name(kind, expected["campaign_id"], receipt["run_id"], receipt["attempt"])
            and str(artifact["workflow_run"]["id"]) == receipt["run_id"]
            and artifact["workflow_run"]["head_sha"] == receipt["head_sha"], "native artifact producer mismatch")
    require(receipt["payload_sha256"] == artifacts.sha(files["native.json"]) and len(files["native.json"]) <= PAYLOAD_LIMIT
            and receipt["state"] == payload["state"], "native payload digest or verdict mismatch")
    require(set(files) == {"receipt.json", "native.json", *payload["raw_files"]}, "native artifact member inventory mismatch")
    for name, declared in payload["raw_files"].items():
        artifacts.safe_path(name)
        require(len(files[name]) == declared["size"] and artifacts.sha(files[name]) == declared["sha256"], "native raw evidence changed")
    entry = tool.entry_from_receipt(receipt)
    run = artifacts.authenticate_run(api, repository, tool.WORKFLOW, entry, receipt["contract"]["files"][tool.WORKFLOW])
    tool.verify_committed_contract(api, repository, receipt["workflow_sha"], receipt["contract"])
    tool.verify_committed_contract(api, repository, receipt["checkout"]["commit"], receipt["contract"])
    proof = artifacts.authenticate_producer(api, repository, entry, artifact, receipt,
        now=dt.datetime.now(dt.timezone.utc), job_name=JOBS[kind], marker=MARKERS[kind])
    conclusion = "success" if payload["state"] in ("complete", "admitted") else "failure"
    require(proof["job"]["status"] == "completed" and proof["job"]["conclusion"] == conclusion, "native producer conclusion disagrees with verdict")
    tool.retained_until(api, repository, artifact, run, artifacts.timestamp(chain["expires_at"]) + tool.MARGIN,
                        receipt["log_retention_days"])
    return {"reference": selected, "receipt": receipt, "payload": payload, "job": proof["job"], "artifact": artifact,
        "producer_log": {"path": f"repos/{repository}/actions/jobs/{receipt['job_id']}/logs",
            "bytes": base64.b64encode(proof["log_bytes"]).decode(), "sha256": proof["log_sha256"],
            "run_id": receipt["run_id"], "attempt": receipt["attempt"], "job_id": receipt["job_id"],
            "observed_at": dt.datetime.now(dt.timezone.utc).isoformat(), "original_retention_days": receipt["log_retention_days"],
            "expires_at": (artifacts.timestamp(run["created_at"]) + dt.timedelta(days=receipt["log_retention_days"])).isoformat()},
        "download": {"bytes": len(raw), "seconds": download_seconds}, "files": files}


def upload_measurement(evidence):
    kind = evidence["receipt"]["kind"]
    matches = [step for step in evidence["job"]["steps"] if step["name"] == UPLOADS[kind]]
    require(len(matches) == 1 and matches[0]["status"] == "completed" and matches[0]["conclusion"] == "success",
            "native upload lacks authenticated completed step")
    step = matches[0]
    seconds = (artifacts.timestamp(step["completed_at"]) - artifacts.timestamp(step["started_at"])).total_seconds()
    size = evidence["artifact"]["size_in_bytes"]
    require(seconds >= 0 and type(size) is int and 0 < size <= artifacts.MAX_ARCHIVE, "invalid actual native upload measurement")
    return {"artifact_bytes": size, "download_archive_bytes": evidence["download"]["bytes"],
        "upload_seconds": seconds, "step_started_at": step["started_at"], "step_completed_at": step["completed_at"],
        "producer_job_id": evidence["receipt"]["job_id"]}


def compact_proof(evidence):
    return {key: value for key, value in evidence.items() if key != "files"}


def current_binding(root, settings, planned):
    """Recheck current source and runtime without running native tests."""
    checkout, inventory = runner.checkout_inventory(root, settings["repository"])
    env, contract = runner.execution_environment(settings, root=root)
    executable = runner.installed_tool(root, env, settings)
    calibration = planned["calibration"]
    require(model.digest(inventory) == calibration["inventory_digest"] and contract == calibration["environment"]
            and runner.tool_identity(executable) == calibration["cargo_mutants_identity"]
            and {name: runner.command([name, "--version", "--verbose"], root, env) for name in ("rustc", "cargo")} == calibration["toolchain"],
            "native admission current source or runtime changed")
    require(settings["build_cap_seconds"] == planned["manifest"]["context"]["inputs"]["timeout_policy"]["build_seconds"],
            "native admission changed original cap")
    return checkout


def select_samples(manifest, baseline):
    model.validate_manifest(manifest)
    require(manifest["context"]["inputs"]["computation_scope"] == "production", "diagnostics cannot use fixture coverage")
    chosen, rationale = {}, {}
    def exact(normalized, reason):
        matches = [item for item in manifest["mutations"] if model.normalize_survivor(item["name"]) == normalized]
        require(len(matches) == 1, "native diagnostic identity is missing or ambiguous: " + normalized)
        item = matches[0]
        chosen[item["id"]], rationale[item["id"]] = item, reason
        return item["id"]
    control = exact(CONTROL_NAME, "Assertion-backed getter control; actual CaughtMutant is required.")
    accepted = {model.normalize_survivor(name) for name in baseline}
    present = sorted({model.normalize_survivor(item["name"]) for item in manifest["mutations"]} & accepted)
    if present:
        exact(SURVIVOR_NAME if SURVIVOR_NAME in present else present[0], "Reviewed survivor candidate; measures a full-suite case if it still survives.")
    for package in ("terri-data", "terri-sim", "terri-wasm"):
        candidates = [item for item in manifest["mutations"] if item["package"] == package and item["id"] not in chosen]
        require(candidates, "native diagnostic package has no representative: " + package)
        def score(item):
            function = item["function"]
            span = function["span"] if function else item["span"]
            return (-(span["end"]["line"] - span["start"]["line"]), item["name"], item["id"])
        item = min(candidates, key=score)
        chosen[item["id"]] = item
        rationale[item["id"]] = "Largest authored function/span in " + package + "; a rebuild representative, not a promise of worst-case cost."
    return {"control_id": control, "physical_slot": 0,
        "identities": [{"identity": item, "logical_slot": item["slot"], "rationale": rationale[mid]}
                       for mid, item in sorted(chosen.items())]}


class TimedInputs(runner.OwnedInputs):
    def __init__(self, root, metrics):
        self.metrics = metrics
        super().__init__(root, "production")

    def verify(self, *args, **kwargs):
        start = time.monotonic()
        try:
            return super().verify(*args, **kwargs)
        finally:
            self.metrics["source_validation_seconds"].append(time.monotonic() - start)


def process_observer(metrics):
    class Observed(runner.OwnedProcess):
        def __init__(self, *args, **kwargs):
            start = time.monotonic()
            super().__init__(*args, **kwargs)
            metrics["process_start_seconds"].append(time.monotonic() - start)

        def stop(self, seconds):
            start = time.monotonic()
            try:
                super().stop(seconds)
            finally:
                metrics["shutdown_seconds"].append(time.monotonic() - start)
    return Observed


@contextlib.contextmanager
def owned_native(root, settings, planned, metrics):
    temporary = tempfile.TemporaryDirectory(prefix="mutation-native-diagnostic-")
    try:
        directory = Path(temporary.name)
        source = directory / "source"
        runner.guard_owned_paths(root, [source, directory / "tmp", directory / "target", directory / "attempt"])
        start = time.monotonic()
        runner.command(["git", "clone", "--quiet", "--no-hardlinks", "--no-checkout", str(Path(root).resolve()), str(source)], root)
        runner.command(["git", "checkout", "--quiet", "--detach", planned["manifest"]["context"]["checkout"]["commit"]], source)
        require(runner.checkout_inventory(source, settings["repository"])[1] == planned["manifest"]["context"]["inputs"]["input_inventory"],
                "native diagnostic clone differs from full plan")
        env = runner.owned_environment(runner.execution_environment(settings, root=root)[0], directory)
        metrics["clone_setup_seconds"].append(time.monotonic() - start)
        yield directory, source, env
    finally:
        start = time.monotonic()
        try:
            temporary.cleanup()
        finally:
            metrics.setdefault("owned_cleanup_seconds", []).append(time.monotonic() - start)


def copy_report(source, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    total = 0
    count = 0
    if not Path(source).is_dir():
        return
    for path in sorted(Path(source).rglob("*")):
        require(not path.is_symlink(), "unsafe diagnostic report path")
        if path.is_dir():
            continue
        require(not path.is_symlink() and path.resolve().is_relative_to(Path(source).resolve()), "unsafe diagnostic report path")
        relative = path.relative_to(source).as_posix()
        artifacts.safe_path(relative)
        raw = path.read_bytes()
        count += 1
        total += len(raw)
        if len(raw) > artifacts.MAX_MEMBER or total > artifacts.MAX_ARCHIVE or count > artifacts.MAX_MEMBERS:
            raise runner.CapacityFailure("native diagnostic raw evidence exceeds existing bounds")
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)


def diagnostic_batch(root, settings, planned, directory, source, env, slot, ids, output, metrics, *, interrupt=False):
    manifest, calibration = planned["manifest"], planned["calibration"]
    executable = runner.installed_tool(root, env, settings)
    require(runner.tool_identity(executable) == calibration["cargo_mutants_identity"], "diagnostic executable differs from original calibration")
    config = directory / ("probe.toml" if interrupt else f"selection-{slot}.toml")
    runner.batch_config(manifest, ids, config)
    guard = TimedInputs(source, metrics)
    guard.configure(manifest, ids)
    selected = artifacts.strict_json(runner.command([arg for arg in runner.generation_argv("production", executable) if arg != "--no-config"]
        + ["--config", str(config)], source, env))
    guard.verify()
    model.validate_selection(manifest, slot, selected, ids)
    expected_names = {item["id"]: item["name"] for item in manifest["mutations"]}
    require([item["name"] for item in selected] == [expected_names[mid] for mid in ids], "diagnostic selection order changed")
    if not interrupt and not runner.capacity(settings, calibration)["admit"]:
        raise runner.CapacityFailure("native diagnostic baseline and next mutation cannot fit")
    safe_deadline = artifacts.timestamp(settings["job_started_at"]).timestamp() + 7200 - (
        settings["shutdown_seconds"] + settings["validation_seconds"] + settings["upload_seconds"])
    require(time.time() + 2 < safe_deadline, "native shutdown probe cannot fit")
    report_parent = directory / "attempt" / ("shutdown-probe" if interrupt else f"batch-{slot}")
    report_parent.mkdir()
    report = report_parent / "mutants.out"
    argv = runner.execution_argv(settings, calibration, executable, config, report_parent)
    provenance = {"repository": settings["repository"], "workflow": tool.WORKFLOW, "run_id": settings["run_id"],
        "attempt": settings["attempt"], "batch_id": model.digest(ids), "execution_id": "native-diagnostic-" + uuid.uuid4().hex,
        "checkout": manifest["context"]["checkout"], "input_fingerprint": manifest["input_fingerprint"]}
    started = time.monotonic()
    result = runner.run_controller(argv, cwd=source, env=env, report_path=report / "outcomes.json", manifest=manifest,
        slot=slot, batch_ids=ids, provenance=provenance, deadline=min(safe_deadline, time.time() + 2) if interrupt else safe_deadline,
        shutdown_seconds=settings["shutdown_seconds"], log_path=report_parent / "process.log",
        input_guard=guard, process_factory=process_observer(metrics))
    wall = time.monotonic() - started
    copy_report(report_parent, output)
    snapshot = result.pop("snapshot")
    delta = None
    if snapshot:
        (Path(output) / "frozen-outcomes.json").write_bytes(snapshot[0])
        delta = snapshot[1]
    if interrupt:
        require(result["state"] in ("incomplete_with_progress", "incomplete_without_progress")
                and result["reason"] == "controller_deadline", "native shutdown probe did not establish controlled interruption")
        return {"purpose": "intentional native shutdown; every outcome excluded", "state": result["state"],
            "reason": result["reason"], "wall_seconds": wall, "accepted_production_outcomes": 0,
            "ignored_terminal_records": len(delta["records"]) if delta else 0}
    if result["state"] != "complete" or delta is None:
        state = "capacity_failure" if result["state"].startswith("incomplete_") else result["state"]
        raise NativeFailure(state if state != "complete" else "infrastructure_failure",
                            "ordinary native diagnostic failed: " + result["state"] + "/" + result["reason"])
    guard.verify()
    return {"logical_slot": slot, "physical_slot": 0, "batch_ids": ids, "delta": delta,
            "wall_seconds": wall, "argv": argv, "state": "complete"}


def validate_samples(planned, selection, batches, baseline):
    manifest = planned["manifest"]
    deltas = [batch["delta"] for batch in batches]
    require(deltas, "native diagnostic has no ordinary results")
    provenance = deltas[0]["provenance"]
    records = model.merge_deltas(manifest, deltas, allowed_run_ids={provenance["run_id"]},
        current_run_id=provenance["run_id"], current_attempt=provenance["attempt"], include_current=True)
    selected = {item["identity"]["id"] for item in selection["identities"]}
    require({record["mutation_id"] for record in records} == selected, "native sample coverage differs from exact selection")
    summary = model.summarize(manifest, records, baseline)
    if summary["failing"]:
        raise NativeFailure("policy_failure", "native diagnostic has timeout or unaccepted survivor")
    control = next(record for record in records if record["mutation_id"] == selection["control_id"])
    require(control["outcome"]["summary"] == "CaughtMutant", "native caught control did not fail its assertion")
    return records


def capped_campaign_projection(counts, settings, calibration, setup, remaining, *, batch_limit=None):
    """Project capped phases with explicit repeated setup, reserve and queue allowances."""
    cap_unit = settings["build_cap_seconds"] + calibration["test_cap_seconds"]
    baseline_cap = cap_unit
    reserves = {key: settings[key] for key in ("shutdown_seconds", "validation_seconds", "upload_seconds")}
    queue = 1800
    usable = 7200 - baseline_cap - setup - sum(reserves.values())
    per_wave = max(0, math.floor(usable / cap_unit))
    if batch_limit is not None:
        per_wave = min(batch_limit, per_wave)
    waves = [math.ceil(count / per_wave) if per_wave else (None if count else 0) for count in counts]
    overhead = baseline_cap + setup + sum(reserves.values()) + queue
    per_slot = [None if wave is None else count * cap_unit + wave * overhead for count, wave in zip(counts, waves)]
    wall = None if any(value is None for value in per_slot) else max(per_slot)
    fits = wall is not None and wall <= remaining
    reason = ("baseline_and_capped_mutation_do_not_fit" if wall is None else
              "fits_declared_assumptions" if fits else "remaining_lifetime_exceeded")
    return {"mutation_cap_seconds": cap_unit, "baseline_cap_seconds_per_wave": baseline_cap,
        "setup_seconds_per_wave": setup, "reserves_seconds_per_wave": reserves, "queue_seconds_per_wave": queue,
        "mutations_per_wave": per_wave, "per_slot_waves": waves, "per_slot_wall_seconds": per_slot,
        "wall_seconds": wall, "fits_remaining": fits, "reason": reason,
        "assumptions": "Every baseline and mutation uses both phase caps; measured setup, all reserves and the declared queue allowance repeat each wave. External setup and queue delays can exceed those allowances.",
        "is_guarantee": False}


def forecast(planned, chain, settings, records, metrics, *, batch_limit=None):
    counts = [len(model.slot_ids(planned["manifest"], slot)) for slot in range(8)]
    sampled = [sum(phase["duration"] for phase in record["outcome"]["phase_results"]) for record in records]
    require(sampled and all(value > 0 and math.isfinite(value) for value in sampled), "invalid measured native phase cost")
    unit = max(sampled) * 1.5
    baseline = planned["calibration"]["build_seconds"] + planned["calibration"]["test_seconds"]
    setup = max(metrics["clone_setup_seconds"]) + metrics["job_initial_setup_seconds"]
    reserves = settings["shutdown_seconds"] + settings["validation_seconds"] + settings["upload_seconds"]
    usable = 7200 - reserves - setup - baseline
    per_wave = math.floor(usable / unit)
    if batch_limit is not None:
        per_wave = min(batch_limit, per_wave)
    if per_wave < 1:
        raise runner.CapacityFailure("measured native baseline and one conservative mutation cannot fit")
    waves = [math.ceil(count / per_wave) for count in counts]
    elapsed_attempts = sum(entry.get("sealed_attempt", settings["attempt"] if entry["run_id"] == settings["run_id"] else 0)
                           for entry in chain["runs"])
    ceiling = elapsed_attempts + 1 + math.ceil(max(waves) * 1.5) + 2
    remaining = (artifacts.timestamp(chain["expires_at"]) - dt.datetime.now(dt.timezone.utc)).total_seconds()
    wall = max(waves) * (7200 + 1800)
    envelope_wall = (ceiling - elapsed_attempts) * (7200 + 1800)
    if ceiling > 8 * chain["max_attempts"] or wall > remaining or envelope_wall > remaining:
        raise runner.CapacityFailure("conservative native forecast/history envelope exceeds original finite campaign")
    capped = capped_campaign_projection(counts, settings, planned["calibration"], setup, remaining, batch_limit=batch_limit)
    return {"per_slot_counts": counts, "sample_seconds": sampled, "conservative_seconds_per_mutation": unit,
        "cost_assumption": "1.5 times the slowest sampled build plus test; future costs remain unproven",
        "baseline_seconds_per_wave": baseline, "setup_seconds_per_wave": setup, "queue_seconds_per_wave": 1800,
        "mutations_per_wave": per_wave, "per_slot_waves": waves, "slowest_slot": waves.index(max(waves)),
        "sample_forecast_wall_seconds": wall, "remaining_wall_seconds": remaining,
        "admitted_total_history_attempts": ceiling, "existing_total_attempts": elapsed_attempts,
        "history_headroom": "one separate admission attempt, 1.5 times forecast waves, plus two additional attempts",
        "envelope_wall_seconds": envelope_wall, "original_total_attempt_stop": 8 * chain["max_attempts"],
        "pessimistic_mutation_cap_seconds_per_slot": [count * capped["mutation_cap_seconds"] for count in counts],
        "pessimistic_capped_campaign": capped,
        "pessimistic_cap_bound_fits_remaining": capped["fits_remaining"],
        "is_guarantee": False}


def json_size(value, *, pretty=False):
    return len(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                          **({"indent": 2} if pretty else {"separators": (",", ":")})).encode())


def identity_record_shape(sample, identity, manifest_count):
    shaped = copy.deepcopy(sample)
    shaped.update(mutation_id=identity["id"], slot=identity["slot"])
    shaped["outcome"]["scenario"]["Mutant"] = {key: identity[key] for key in model.IDENTITY_KEYS}
    # Pinned 27.1.0 mutant.rs/output.rs: cleaned source path, location and an
    # optional collision counter. A full-manifest counter covers any bounded prefix.
    filename = identity["file"].replace("/", "__")
    filename = "".join("_" if character in '\\ :<>?*|"' else character for character in filename)
    basename = f"{filename}_line_{identity['span']['start']['line']}_col_{identity['span']['start']['column']}_{manifest_count:03}"
    for field, prefix, extension in (("log_path", "log/", ".log"), ("diff_path", "diff/", ".diff")):
        path = prefix + basename + extension
        observed = shaped["outcome"].get(field)
        shaped["outcome"][field] = path if observed is None or len(path.encode()) >= len(observed.encode()) else observed
    return shaped


def raw_shape_budget(planned, records, batches, files):
    """Separate actual member classes, then cover every full-manifest identity row."""
    require(records and batches, "raw sizing requires actual diagnostic record shapes")
    manifest = planned["manifest"]
    record_bytes = outcome_bytes = 0
    for identity in manifest["mutations"]:
        # Compare every measured payload after substituting the same identity.
        # Compact records and pretty raw outcomes can have different maxima.
        for sample in records:
            shaped = identity_record_shape(sample, identity, len(manifest["mutations"]))
            record_bytes = max(record_bytes, json_size(shaped) + 1)
            pretty = json.dumps(shaped["outcome"], indent=2, ensure_ascii=False, allow_nan=False)
            outcome_bytes = max(outcome_bytes, len(pretty.encode()) + 4 * len(pretty.splitlines()) + 2)
    baseline_logs, mutant_logs, diffs, process = [], [], [], []
    report_fixed = 0
    serialization_ratio = 1.0
    for batch in batches:
        prefix = f"batch-{batch['logical_slot']}/"
        raw = files[prefix + "frozen-outcomes.json"]
        parsed = artifacts.strict_json(raw)
        serialization_ratio = max(serialization_ratio, len(raw) / max(1, json_size(parsed, pretty=True)))
        baseline = batch["delta"]["baseline"]["outcome"]
        baseline_logs.append(len(files[prefix + "mutants.out/" + str(artifacts.safe_path(baseline["log_path"]))]))
        for record in batch["delta"]["records"]:
            outcome = record["outcome"]
            mutant_logs.append(len(files[prefix + "mutants.out/" + str(artifacts.safe_path(outcome["log_path"]))]))
            if outcome["diff_path"] is not None:
                diffs.append(len(files[prefix + "mutants.out/" + str(artifacts.safe_path(outcome["diff_path"]))]))
        process.append(len(files[prefix + "process.log"]))
        parsed["outcomes"] = [parsed["outcomes"][0]]
        report_fixed = max(report_fixed, json_size(parsed, pretty=True) + 256)
    maximum_remaining = max((model.slot_ids(manifest, slot) for slot in range(8)), key=lambda ids: json_size(ids))
    headers = [dict(batch["delta"], records=[], batch_ids=[]) for batch in batches]
    delta = copy.deepcopy(max(headers, key=json_size))
    receipt = dict(planned["producer"], execution_id="x" * 64, batch_id="x" * 64,
        batch_policy_digest="x" * 64, job_id="9" * 20, run_id="9" * 20, attempt=51)
    bundle = {"version": 1, "manifest": manifest, "receipt": receipt, "delta": delta,
        "status": {"state": "incomplete_with_progress", "reason": "bounded_batch_complete", "returncode": 0,
            "remaining": maximum_remaining, "recorded_at": "2099-12-31T23:59:59.999999+00:00"}}
    return {"bundle_fixed_bytes": json_size(bundle) + 1024, "record_compact_bytes": record_bytes,
        "outcome_pretty_bytes": math.ceil(outcome_bytes * serialization_ratio),
        "outcomes_fixed_bytes": math.ceil(report_fixed * serialization_ratio),
        "baseline_log_bytes": max(baseline_logs), "mutant_log_bytes": max(mutant_logs), "mutant_diff_bytes": max(diffs, default=0),
        "mutant_diff_present": bool(diffs),
        "process_fixed_bytes": max(process), "process_per_mutation_bytes": max(process),
        "full_manifest_digest": model.digest(manifest), "sample_records_digest": model.digest(records),
        "raw_serialization_ratio": serialization_ratio,
        "assumptions": "Independent measured record/outcome payload envelopes after common identity substitution cover every full-manifest future prefix. Individual log/diff maxima stay separate. Paths follow the pinned tool source-path/location/collision naming with a full-manifest collision suffix allowance. Whole largest observed process output is charged once and once per future mutation; report whitespace uses the larger of measured serialization and pretty JSON. Future output growth still faces exact outgoing limits."}


def raw_projection(shapes, count):
    members = {"bundle.json": shapes["bundle_fixed_bytes"] + count * (shapes["record_compact_bytes"] + 67),
        "raw/outcomes.json": shapes["outcomes_fixed_bytes"] + count * shapes["outcome_pretty_bytes"],
        "diagnostic/post-shutdown-outcomes.json": shapes["outcomes_fixed_bytes"] + count * shapes["outcome_pretty_bytes"],
        "process.log": shapes["process_fixed_bytes"] + count * shapes["process_per_mutation_bytes"],
        "baseline_log": shapes["baseline_log_bytes"]}
    # The retained filesystem deduplicates actual repeated paths. Unique future
    # scenario paths maximize the two distinct per-mutation member classes.
    largest = max(*members.values(), shapes["mutant_log_bytes"], shapes["mutant_diff_bytes"])
    expanded = sum(members.values()) + count * (shapes["mutant_log_bytes"] + shapes["mutant_diff_bytes"])
    member_count = len(members) + count * (1 + shapes["mutant_diff_present"])
    fits = largest <= artifacts.MAX_MEMBER * .8 and expanded <= artifacts.MAX_ARCHIVE * .8 and member_count <= math.floor(artifacts.MAX_MEMBERS * .8)
    return {"selection_count": count, "fixed_and_aggregate_members": members,
        "individual_mutant_log_bytes": shapes["mutant_log_bytes"], "individual_mutant_diff_bytes": shapes["mutant_diff_bytes"],
        "maximum_member_bytes": largest, "expanded_bytes": expanded, "member_count": member_count,
        "fits_projected_headroom": fits, "compressed_bytes": None,
        "compression_note": "Uploader ZIP bytes are unknown here and remain checked from completed artifact metadata/download."}


def choose_batch_policy(planned, chain, records, batches, files):
    shapes = raw_shape_budget(planned, records, batches, files)
    largest_slot = max(len(model.slot_ids(planned["manifest"], slot)) for slot in range(8))
    if not raw_projection(shapes, 1)["fits_projected_headroom"]:
        raise runner.CapacityFailure("one production identity cannot fit typed raw artifact headroom")
    low, high = 1, largest_slot
    while low < high:
        middle = (low + high + 1) // 2
        if raw_projection(shapes, middle)["fits_projected_headroom"]:
            low = middle
        else:
            high = middle - 1
    return {"algorithm": runner.BATCH_ALGORITHM, "max_mutations": low,
        "manifest_digest": model.digest(planned["manifest"]), "binding_digest": model.digest(binding(planned, chain)),
        "shapes": shapes, "projection": raw_projection(shapes, low),
        "whole_slot_projection": raw_projection(shapes, largest_slot),
        "limits": {"member_bytes": artifacts.MAX_MEMBER, "expanded_bytes": artifacts.MAX_ARCHIVE,
                   "member_count": artifacts.MAX_MEMBERS, "headroom_fraction": .8}}


def projected_history(planned, seed, records, projected, policy, producer_logs):
    """Size the retained schema, not an execution claim or an acceptable snapshot."""
    require(seed is not None and seed["planned"] == planned, "history sizing lacks authenticated original proof shapes")
    value = copy.deepcopy(seed)
    value["planned"], value["chain"] = copy.deepcopy(planned), copy.deepcopy(seed["chain"])
    manifest = planned["manifest"]
    value.update(diagnostic_sizing_only=True, accepted_production_outcomes=0, bundles=[], frontier={},
        job_inventories={}, phase_inventories={}, aggregate_verdicts={})
    sample = records[0]
    by_slot = [[item for item in manifest["mutations"] if item["slot"] == slot] for slot in range(8)]
    pending = [model.slot_ids(manifest, slot) for slot in range(8)]
    largest_log = max(producer_logs, key=len)
    now = planned["producer"]["checkout"]
    root_run = planned["producer"]["run_id"]
    future_base = max(int(run) for run in {root_run, *value["source_runs"]})
    instant = value["chain"]["started_at"]
    expiry = (artifacts.timestamp(instant) + dt.timedelta(days=30)).isoformat()
    job_shape = value.pop("projection_job_shape", {})
    policy_digest = model.digest(policy)
    def job_and_log(job_id, run_id, attempt, name, receipt, marker):
        job = dict(job_shape, id=job_id, run_id=int(run_id), run_attempt=attempt, name=name,
            status="completed", conclusion="failure", started_at=instant, completed_at=instant)
        path = f"repos/{planned['producer']['repository']}/actions/jobs/{job_id}/logs"
        raw = largest_log + b"\n" + (marker + " " + json.dumps(receipt, sort_keys=True) + f"\nMUTATION_ARTIFACT_ID={job_id}\n").encode()
        value["logs"][path] = {"bytes": base64.b64encode(raw).decode(), "sha256": artifacts.sha(raw),
            "run_id": run_id, "attempt": attempt, "job_id": str(job_id), "observed_at": instant,
            "original_retention_days": 30, "expires_at": expiry}
        value["originals"][str(job_id)] = {"metadata": {"id": job_id, "name": name + str(job_id), "digest": "sha256:" + "f" * 64,
            "created_at": instant, "expires_at": expiry, "workflow_run": {"id": int(run_id), "head_sha": planned["producer"]["checkout"]["commit"]}}, "producer_log": path}
        return job, path
    for ordinal in range(projected["admitted_total_history_attempts"]):
        run_id = root_run if ordinal < 51 else str(future_base + ordinal // 51)
        attempt = ordinal % 51 + 1
        value["frontier"][run_id] = attempt
        if run_id not in {entry["run_id"] for entry in value["chain"]["runs"]}:
            previous = value["chain"]["runs"][-1]
            previous["sealed_attempt"] = 51
            value["chain"]["runs"].append({**{key: child for key, child in previous.items() if key != "sealed_attempt"},
                "run_id": run_id, "predecessor": previous["run_id"]})
        entry = next(entry for entry in value["chain"]["runs"] if entry["run_id"] == run_id)
        value["source_runs"][run_id] = dict(entry)
        key = f"{run_id}/{attempt}"
        value["job_inventories"][key], value["phase_inventories"][key] = [], []
        for slot in range(8):
            job_id = 1000000000000000000 + ordinal * 10 + slot
            selected = by_slot[slot][ordinal * policy["max_mutations"]:(ordinal + 1) * policy["max_mutations"]]
            batch_ids = pending[slot][:policy["max_mutations"]]
            provenance = dict(sample["provenance"], run_id=run_id, attempt=attempt, batch_id=model.digest(batch_ids), execution_id=f"{job_id:032x}")
            reference = max((record["raw_report_ref"] for record in records), key=json_size)
            baselines = []
            for observed in records:
                baseline_shape = copy.deepcopy(observed["baseline"])
                baseline_shape.update(provenance=provenance, raw_report_ref=reference)
                baseline_shape["baseline_id"] = model.digest({k: v for k, v in baseline_shape.items() if k != "baseline_id"})
                baselines.append(baseline_shape)
            baseline = max(baselines, key=json_size)
            shaped_records = []
            for identity in selected:
                candidates = []
                for observed in records:
                    shaped = identity_record_shape(observed, identity, len(manifest["mutations"]))
                    shaped.update(provenance=provenance, baseline=baseline, raw_report_ref=reference)
                    candidates.append(shaped)
                shaped = max(candidates, key=json_size)
                shaped["record_id"] = model.digest({k: v for k, v in shaped.items() if k != "record_id"})
                shaped_records.append(shaped)
            delta = {"schema_version": model.SCHEMA_VERSION, "campaign_id": manifest["campaign_id"], "slot": slot,
                "provenance": provenance, "batch_ids": batch_ids, "raw_report_ref": reference,
                "baseline": baseline, "records": shaped_records, "exit_kind": "interrupted", "delta_id": "f" * 64}
            receipt = dict(planned["producer"], **{k: provenance[k] for k in ("run_id", "attempt", "batch_id", "execution_id")},
                job_id=str(job_id), slot=slot, batch_policy_digest=policy_digest)
            bundle = {"version": 1, "receipt": receipt, "delta": delta,
                "status": {"state": "incomplete_with_progress" if selected else "incomplete_without_progress",
                    "reason": "controller_deadline", "returncode": -15, "recorded_at": instant, "remaining": pending[slot]}}
            value["bundles"].append({"artifact_id": job_id, "bundle": bundle, "bundle_digest": model.digest(bundle)})
            job, _ = job_and_log(job_id, run_id, attempt, f"mutation-slot-{slot}", receipt, "MUTATION_PRODUCER")
            value["job_inventories"][key].append(job)
        for phase, offset in (("prepared", 8), ("aggregate", 9)):
            job_id = 1000000000000000000 + ordinal * 10 + offset
            receipt = dict(planned["producer"], kind=phase, run_id=run_id, attempt=attempt, job_id=str(job_id),
                head_sha=entry["head_sha"], contract=value["contract"], plan=value["chain"]["plan"],
                frontier=dict(value["frontier"]), verdict={"state": "incomplete_with_progress", "reason": "remaining_work", "remaining": len(manifest["mutations"])},
                chunks=[{"name": f"chunk-{i:04d}.bin", "size": 32 * 1024 * 1024, "sha256": "f" * 64} for i in range(4)],
                data_sha256="f" * 64, payload_digest="f" * 64)
            job, path = job_and_log(job_id, run_id, attempt, "mutation-prepare" if phase == "prepared" else "mutation-production-aggregate", receipt, "MUTATION_RECOVERY")
            value["phase_inventories"][key].append(job)
            if phase == "aggregate":
                value["aggregate_verdicts"][str(job_id)] = {"job": job, "receipt": receipt, "artifact_id": job_id, "producer_log": path}
    # Four bounded native payloads remain separate proofs, as in real retained admission.
    proofs = {}
    for index, kind in enumerate(("pilot", "report", "admission", "admission")):
        job_id = 9000000000000000000 + index
        receipt = dict(planned["producer"], kind=kind, job_id=str(job_id), contract=value["contract"], payload_sha256="f" * 64,
            binding_digest=model.digest(binding(planned, seed["chain"])), state="admitted" if index == 3 else "complete")
        job, path = job_and_log(job_id, root_run, 2 if index < 3 else 3, JOBS[kind], receipt, MARKERS[kind])
        proofs[str(job_id)] = {"reference": {"artifact_id": job_id, "archive_digest": "sha256:" + "f" * 64},
            "receipt": receipt, "payload": {"maximum_bounded_payload_shape": "x" * PAYLOAD_LIMIT},
            "job": job, "artifact": value["originals"][str(job_id)]["metadata"],
            "producer_log": dict(value["logs"][path], path=path), "download": {"bytes": PAYLOAD_LIMIT, "seconds": 60}}
        value["phase_inventories"].setdefault(f"{root_run}/{2 if index < 3 else 3}", []).append(job)
    value["native_admission"] = {"reference": proofs[str(job_id)]["reference"], "binding": binding(planned, seed["chain"]),
        "proofs": proofs, "batch_policy": policy, "batch_policy_digest": policy_digest,
        "admitted_total_history_attempts": projected["admitted_total_history_attempts"]}
    # Availability-only metadata remains part of the complete retained shape.
    anchors = value.setdefault("log_availability_anchors", {})
    for anchor_run in {item["run_id"] for item in value["chain"]["runs"]} | set(value["source_runs"]):
        if anchor_run in anchors:
            continue
        candidates = [(path, log) for path, log in value["logs"].items() if log["run_id"] == anchor_run]
        require(candidates, "history sizing lacks original anchor shape")
        path, log = max(candidates, key=lambda pair: json_size(pair[1]))
        anchor_job = {"id": int(log["job_id"]), "run_id": int(anchor_run), "run_attempt": log["attempt"],
            "name": "mutation-production-aggregate", "status": "completed", "conclusion": "success",
            "started_at": instant, "completed_at": instant}
        anchors[anchor_run] = {"version": 1, "repository": planned["producer"]["repository"], "basis": "original_producer",
            "job": anchor_job, "selected_at": instant, "original_retention_days": log["original_retention_days"],
            "expires_at": log["expires_at"], "original_log": {"path": path, "sha256": log["sha256"], "observed_at": log["observed_at"]}}
    value["consumer"] = {"run_id": run_id, "attempt": attempt}
    return value


def sizing_probe(planned, records, projected, producer_logs, diagnostic_files, *, batch_policy=None, history_seed=None):
    from mutation_recovery import encode, decode
    require(batch_policy is not None and records and producer_logs, "history sizing requires the authenticated raw batch envelope")
    value = projected_history(planned, history_seed, records, projected, batch_policy, producer_logs)
    started = time.monotonic()
    raw = encode(value)
    encoded_seconds = time.monotonic() - started
    started = time.monotonic()
    logical = decode(raw, materialize=False)
    require(model.digest(decode(raw)) == model.digest(value), "actual-schema history failed lossless reconstruction")
    decode_seconds = time.monotonic() - started
    chunks = [raw[index:index + 32 * 1024 * 1024] for index in range(0, len(raw), 32 * 1024 * 1024)]
    zipped = io.BytesIO()
    with zipfile.ZipFile(zipped, "w", zipfile.ZIP_DEFLATED) as archive:
        for index, chunk in enumerate(chunks):
            archive.writestr(f"chunk-{index:04d}.bin", chunk)
    require(logical <= artifacts.MAX_ARCHIVE * .8 and len(raw) <= artifacts.MAX_ARCHIVE * .8
            and len(zipped.getvalue()) <= artifacts.MAX_ARCHIVE * .8
            and all(len(chunk) <= artifacts.MAX_MEMBER for chunk in chunks),
            "native sizing lacks twenty percent headroom inside unchanged raw/snapshot bounds")
    raw_envelope = batch_policy["projection"]
    ceiling = projected["admitted_total_history_attempts"]
    maximum_projection = math.ceil(logical * projected["original_total_attempt_stop"] / ceiling)
    return {"diagnostic_sizing_only": True, "accepted_production_outcomes": 0,
        "mutation_count": len(planned["manifest"]["mutations"]), "admitted_total_history_attempts": ceiling,
        "logical_bytes": logical, "expanded_chunk_bytes": len(raw), "compressed_bytes": len(zipped.getvalue()),
        "maximum_member_bytes": max(map(len, chunks)), "encode_seconds": encoded_seconds, "decode_and_digest_seconds": decode_seconds,
        "raw_bundle_member_bytes": raw_envelope["fixed_and_aggregate_members"]["bundle.json"],
        "raw_member_projection_bytes": raw_envelope["maximum_member_bytes"], "raw_archive_projection_bytes": raw_envelope["expanded_bytes"],
        "admitted_bound_fraction": .8, "batch_policy_digest": model.digest(batch_policy), "shape_digest": model.digest(value),
        "producer_log_shape_count": ceiling * 10 + 4, "measured_producer_log_shape_bytes": max(map(len, producer_logs)),
        "history_assumption": "Actual retained schema: complete plan, all records and repeated baselines, bounded batch IDs, full slot remaining arrays every attempt, distinct producer logs/metadata, started phases/verdicts and four maximum bounded native payload shapes. These are capacity shapes, never accepted execution evidence.",
        "log_assumption": "Existing authenticated logs stay exact; each future job adds the largest observed log plus its distinct full receipt. Future growth remains subject to unchanged logical/archive limits.",
        "maximum_history_logical_projection_bytes": maximum_projection,
        "maximum_history_projection_fits": maximum_projection <= artifacts.MAX_ARCHIVE}


def run_pilot(root, settings, planned, chain, output, producer_logs, authentication_seconds, history_seed):
    require(sys.platform.startswith("linux") and settings["scope"] == "production" and settings["slot"] == 0,
            "native pilot requires Linux production physical slot zero")
    import resource
    original = runner.validate_current_plan(root, planned, settings)
    manifest_digest = model.digest(planned["manifest"])
    baseline = (Path(root) / "docs/mutants-baseline.txt").read_text(encoding="utf-8").splitlines()
    selected = select_samples(planned["manifest"], baseline)
    metrics = {"clone_setup_seconds": [], "source_validation_seconds": [], "process_start_seconds": [],
               "shutdown_seconds": [], "authentication_setup_seconds": authentication_seconds,
               "job_initial_setup_seconds": max(0, time.time() - artifacts.timestamp(settings["job_started_at"]).timestamp())}
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    (output / "baseline-policy.txt").write_bytes((Path(root) / "docs/mutants-baseline.txt").read_bytes())
    batches = []
    ids = {item["identity"]["id"] for item in selected["identities"]}
    with owned_native(root, settings, planned, metrics) as (directory, source, env):
        for slot in sorted({item["logical_slot"] for item in selected["identities"]}):
            batch = [mid for mid in runner.ordered_remaining(planned["manifest"], [], slot) if mid in ids]
            batches.append(diagnostic_batch(root, settings, planned, directory, source, env, slot, batch,
                output / f"batch-{slot}", metrics))
    validation_started = time.monotonic()
    records = validate_samples(planned, selected, batches, baseline)
    model_validation_seconds = time.monotonic() - validation_started
    control = next(item["identity"] for item in selected["identities"] if item["identity"]["id"] == selected["control_id"])
    with owned_native(root, settings, planned, metrics) as (directory, source, env):
        probe = diagnostic_batch(root, settings, planned, directory, source, env, control["slot"], [control["id"]],
            output / "shutdown-probe", metrics, interrupt=True)
    post_started = time.monotonic()
    diagnostic_files = {path.relative_to(output).as_posix(): path.read_bytes() for path in output.rglob("*") if path.is_file()}
    batch_policy = choose_batch_policy(planned, chain, records, batches, diagnostic_files)
    projected = forecast(planned, chain, settings, records, metrics, batch_limit=batch_policy["max_mutations"])
    batch_policy["history_attempt_ceiling"] = projected["admitted_total_history_attempts"]
    sizing = sizing_probe(planned, records, projected, producer_logs, diagnostic_files, batch_policy=batch_policy, history_seed=history_seed)
    require(runner.validate_current_plan(root, planned, settings) == original
            and model.digest(planned["manifest"]) == manifest_digest, "native diagnostic changed protected inputs or full manifest")
    final_validation_seconds = time.monotonic() - post_started + model_validation_seconds + max(metrics["owned_cleanup_seconds"])
    if max(metrics["shutdown_seconds"]) > settings["shutdown_seconds"] or final_validation_seconds > settings["validation_seconds"]:
        raise runner.CapacityFailure("native shutdown or validation exceeds original frozen reserve")
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    return {"state": "complete", "selection": selected, "batches": batches, "shutdown_probe": probe,
        "batch_policy": batch_policy, "batch_policy_digest": model.digest(batch_policy),
        "forecast": projected, "sizing": sizing, "measurements": dict(metrics,
            model_validation_seconds=model_validation_seconds, final_validation_seconds=final_validation_seconds,
            children_user_seconds=usage.ru_utime, children_system_seconds=usage.ru_stime, children_max_rss_kib=usage.ru_maxrss,
            process_max_rss_kib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
            resource_note="Child ru_maxrss is the largest child, not simultaneous group RSS; these are observed resource measurements, not a future-memory guarantee.",
            free_disk_bytes=shutil.disk_usage(output).free),
        "reserves": {key: settings[key] for key in ("shutdown_seconds", "validation_seconds", "upload_seconds")},
        "calibration_evidence": planned["calibration_evidence"], "full_manifest_unchanged": True}


def validate_pilot(evidence, planned):
    payload, files = evidence["payload"], evidence["files"]
    require(payload["state"] == "complete" and payload["full_manifest_unchanged"] is True,
            "native measurement failed or changed the full plan")
    baseline_raw = files["baseline-policy.txt"]
    require(artifacts.sha(baseline_raw) == planned["manifest"]["context"]["inputs"]["survivor_baseline_file_digest"],
            "native measurement survivor policy changed")
    baseline = baseline_raw.decode("utf-8").splitlines()
    require(payload["selection"] == select_samples(planned["manifest"], baseline), "native measurement selection changed")
    for batch in payload["batches"]:
        raw = files[f"batch-{batch['logical_slot']}/frozen-outcomes.json"]
        delta = batch["delta"]
        require(artifacts.sha(raw) == delta["raw_report_ref"]["digest"], "native frozen report changed")
        rebuilt = model.validate_report(planned["manifest"], batch["logical_slot"], batch["batch_ids"], artifacts.strict_json(raw),
            provenance=delta["provenance"], raw_report_ref=delta["raw_report_ref"], exit_kind="completed")
        require(rebuilt == delta and batch["physical_slot"] == 0, "native raw diagnostic differs from its recorded result")
        for outcome in [delta["baseline"]["outcome"]] + [record["outcome"] for record in delta["records"]]:
            for key in ("log_path", "diff_path"):
                if outcome[key] is not None:
                    path = artifacts.safe_path(outcome[key])
                    require(f"batch-{batch['logical_slot']}/mutants.out/{path}" in files,
                            "native raw diagnostic lost referenced log or diff bytes")
    records = validate_samples(planned, payload["selection"], payload["batches"], baseline)
    require(payload["shutdown_probe"]["reason"] == "controller_deadline"
            and payload["shutdown_probe"]["accepted_production_outcomes"] == 0, "native shutdown probe is not separate controlled interruption")
    policy = payload["batch_policy"]
    validate_batch_policy(policy, planned, payload["binding"], payload["forecast"], payload["sizing"])
    require(payload["batch_policy_digest"] == model.digest(policy)
            and policy["shapes"]["sample_records_digest"] == model.digest(records)
            and policy["shapes"]["mutant_diff_present"] is any(record["outcome"]["diff_path"] is not None for record in records),
            "native raw batch policy changed")
    measurements, reserves = payload["measurements"], payload["reserves"]
    require(reserves == {"shutdown_seconds": 30, "validation_seconds": 120, "upload_seconds": 240}, "native measurement changed frozen reserves")
    require(measurements["shutdown_seconds"] and max(measurements["shutdown_seconds"]) <= reserves["shutdown_seconds"]
            and measurements["owned_cleanup_seconds"]
            and max(measurements["owned_cleanup_seconds"]) <= measurements["final_validation_seconds"] <= reserves["validation_seconds"], "native measurement exceeds shutdown/validation reserve")
    size = payload["sizing"]
    require(size["diagnostic_sizing_only"] is True and size["accepted_production_outcomes"] == 0
            and size["mutation_count"] == len(planned["manifest"]["mutations"])
            and all(0 < size[key] <= artifacts.MAX_ARCHIVE for key in ("logical_bytes", "expanded_chunk_bytes", "compressed_bytes"))
            and 0 < size["maximum_member_bytes"] <= artifacts.MAX_MEMBER
            and size["admitted_bound_fraction"] == .8
            and 0 < size["raw_bundle_member_bytes"] <= size["raw_member_projection_bytes"] <= artifacts.MAX_MEMBER * .8
            and 0 < size["raw_archive_projection_bytes"] <= artifacts.MAX_ARCHIVE * .8
            and size["logical_bytes"] <= artifacts.MAX_ARCHIVE * .8,
            "native full-manifest sizing failed unchanged bounds")
    forecasted = payload["forecast"]
    samples = [sum(phase["duration"] for phase in record["outcome"]["phase_results"]) for record in records]
    unit = max(samples) * 1.5
    setup = max(measurements["clone_setup_seconds"]) + measurements["job_initial_setup_seconds"]
    baseline_seconds = planned["calibration"]["build_seconds"] + planned["calibration"]["test_seconds"]
    per_wave = min(policy["max_mutations"], math.floor((7200 - sum(reserves.values()) - setup - baseline_seconds) / unit))
    require(per_wave > 0, "measured native wave cannot fit")
    waves = [math.ceil(len(model.slot_ids(planned["manifest"], slot)) / per_wave) for slot in range(8)]
    expected_ceiling = evidence["receipt"]["attempt"] + 1 + math.ceil(max(waves) * 1.5) + 2
    require(forecasted["sample_seconds"] == samples and forecasted["conservative_seconds_per_mutation"] == unit
            and forecasted["mutations_per_wave"] == per_wave and forecasted["per_slot_waves"] == waves
            and forecasted["baseline_seconds_per_wave"] == baseline_seconds and forecasted["setup_seconds_per_wave"] == setup
            and forecasted["queue_seconds_per_wave"] == 1800 and forecasted["existing_total_attempts"] == evidence["receipt"]["attempt"]
            and forecasted["admitted_total_history_attempts"] == expected_ceiling
            and forecasted["sample_forecast_wall_seconds"] == max(waves) * 9000
            and forecasted["envelope_wall_seconds"] == (expected_ceiling - evidence["receipt"]["attempt"]) * 9000,
            "native forecast changed its measured computation")
    require(type(forecasted["admitted_total_history_attempts"]) is int
            and forecasted["existing_total_attempts"] < forecasted["admitted_total_history_attempts"] <= 408
            and forecasted["sample_forecast_wall_seconds"] <= forecasted["remaining_wall_seconds"]
            and forecasted["envelope_wall_seconds"] <= forecasted["remaining_wall_seconds"]
            and size["admitted_total_history_attempts"] == forecasted["admitted_total_history_attempts"]
            and forecasted["per_slot_counts"] == [len(model.slot_ids(planned["manifest"], slot)) for slot in range(8)],
            "native forecast/history envelope does not fit the original full plan")
    capped = capped_campaign_projection(forecasted["per_slot_counts"], dict(reserves,
        build_cap_seconds=planned["manifest"]["context"]["inputs"]["timeout_policy"]["build_seconds"]),
        planned["calibration"], setup, forecasted["remaining_wall_seconds"], batch_limit=policy["max_mutations"])
    require(forecasted["pessimistic_capped_campaign"] == capped
            and forecasted["pessimistic_cap_bound_fits_remaining"] == capped["fits_remaining"]
            and forecasted["pessimistic_mutation_cap_seconds_per_slot"] ==
                [count * capped["mutation_cap_seconds"] for count in forecasted["per_slot_counts"]],
            "native capped campaign projection changed its complete computation")
    return payload


def finished_report(pilot, planned):
    payload = validate_pilot(pilot, planned)
    uploaded = upload_measurement(pilot)
    require(uploaded["upload_seconds"] <= payload["reserves"]["upload_seconds"], "actual native upload exceeds original reserve")
    return {"state": "complete", "pilot_reference": pilot["reference"],
        "pilot_payload_sha256": pilot["receipt"]["payload_sha256"], "upload": uploaded,
        "selection": payload["selection"], "measurements": payload["measurements"],
        "forecast": payload["forecast"], "sizing": payload["sizing"], "reserves": payload["reserves"],
        "batch_policy": payload["batch_policy"], "batch_policy_digest": payload["batch_policy_digest"],
        "review_instruction": "Read the actual native cases, costs, sizing assumptions and finite forecast. Rerun only the admission job if the experiment is justified.",
        "coverage": "Diagnostics and sizing contribute zero accepted production outcomes."}


def report_safety(report, pilot, planned):
    expected = finished_report(pilot, planned)
    for key, value in expected.items():
        require(report["payload"].get(key) == value, "finished native report differs from authenticated measurement")
    report_upload = upload_measurement(report)
    require(report_upload["upload_seconds"] <= expected["reserves"]["upload_seconds"], "finished report upload exceeds original reserve")
    return report_upload


def initial_history(api, settings, planned, chain, inventory, *, current_kind):
    """The same-run measurement/review boundary must still fit the three-attempt replay gap."""
    require(settings["run_id"] == str(chain["plan"]["run_id"]), "native decisions must remain in the original plan run")
    if settings["attempt"] > 4 or (current_kind == "pilot" and settings["attempt"] > 3):
        raise runner.CapacityFailure("native measurement/admission cannot fit existing three-attempt recovery gap")
    history = []
    for attempt in range(1, settings["attempt"] + 1):
        jobs = list(artifacts.pages(api, f"repos/{settings['repository']}/actions/runs/{settings['run_id']}/attempts/{attempt}/jobs", "jobs"))
        for job in jobs:
            kinds = [kind for kind, name in JOBS.items() if name == job["name"]]
            if not kinds or not job.get("started_at"):
                continue
            kind = kinds[0]
            if job["conclusion"] == "skipped":
                expected = artifact_name(kind, planned["manifest"]["campaign_id"], settings["run_id"], attempt)
                require(not any(item["name"] == expected for item in inventory), "skipped native phase has executed upload evidence")
                continue
            if str(job["id"]) == settings["job_id"] and attempt == settings["attempt"] and job["status"] == "in_progress":
                require(kind == current_kind, "native current job kind changed")
                continue
            expected = artifact_name(kind, planned["manifest"]["campaign_id"], settings["run_id"], attempt)
            candidates = [item for item in inventory if item["name"] == expected]
            require(len(candidates) == 1, "started native decision lacks immutable evidence")
            evidence = authenticate(api, {"artifact_id": candidates[0]["id"], "archive_digest": candidates[0]["digest"]},
                kind, planned, chain, settings["repository"])
            require(evidence["receipt"]["job_id"] == str(job["id"]) and evidence["job"] == job,
                    "native decision history producer changed")
            allowed = ("complete",) if kind != "admission" else (REVIEW_REQUIRED, "admitted")
            require(evidence["payload"]["state"] in allowed, "terminal native decision stops this campaign")
            history.append(evidence)
    for kind in ("pilot", "report"):
        require(sum(item["receipt"]["kind"] == kind for item in history) <= 1, "native measurement/report cannot be replaced")
    if current_kind in ("pilot", "report"):
        require(not any(item["receipt"]["kind"] == current_kind for item in history), "native phase already completed; rerun only admission")
    return history


def admission_decision(settings, planned, chain, report, pilot, history):
    report_upload = report_safety(report, pilot, planned)
    remaining = (artifacts.timestamp(chain["expires_at"]) - dt.datetime.now(dt.timezone.utc)).total_seconds()
    if report["payload"]["forecast"]["envelope_wall_seconds"] > remaining:
        raise runner.CapacityFailure("native review delay consumed the original admitted lifetime")
    previous = [item for item in history if item["receipt"]["kind"] == "admission"]
    require(report["receipt"]["run_id"] == settings["run_id"] and pilot["receipt"]["run_id"] == settings["run_id"],
            "native admission cannot switch measurement runs")
    same_attempt = settings["attempt"] == report["receipt"]["attempt"] == pilot["receipt"]["attempt"]
    if same_attempt:
        require(not previous, "native review boundary has contradictory earlier admission")
        state, review = REVIEW_REQUIRED, None
    else:
        require(settings["attempt"] > report["receipt"]["attempt"] and len(previous) == 1
                and previous[0]["payload"]["state"] == REVIEW_REQUIRED
                and previous[0]["payload"]["report_reference"] == report["reference"]
                and previous[0]["payload"]["pilot_reference"] == pilot["reference"]
                and previous[0]["receipt"]["attempt"] == report["receipt"]["attempt"],
                "later admission lacks exact authenticated expected review-required verdict")
        state, review = "admitted", previous[0]["reference"]
    ceiling = report["payload"]["forecast"]["admitted_total_history_attempts"]
    require(settings["attempt"] <= ceiling, "native admission already exceeds its finite history envelope")
    return {"state": state, "report_reference": report["reference"], "pilot_reference": pilot["reference"],
        "batch_policy": report["payload"]["batch_policy"], "batch_policy_digest": report["payload"]["batch_policy_digest"],
        "review_reference": review, "admitted_total_history_attempts": ceiling, "report_upload": report_upload,
        "operational_boundary": "Root reviews the report and deliberately reruns this numeric admission job. A later attempt proves a separate action, not that a machine verified human reading.",
        "history": [{"kind": item["receipt"]["kind"], "reference": item["reference"]} for item in history]}


def install_admission(data, evidences):
    admitted = next((item for item in evidences if item["receipt"]["kind"] == "admission" and item["payload"]["state"] == "admitted"), None)
    require(admitted is not None, "production has no authenticated native admission")
    proofs = {str(item["reference"]["artifact_id"]): compact_proof(item) for item in evidences}
    selected = admitted["payload"]
    for key in ("pilot_reference", "report_reference", "review_reference"):
        require(str(selected[key]["artifact_id"]) in proofs, "native admission omitted original evidence")
    data["native_admission"] = {"reference": admitted["reference"], "binding": admitted["payload"]["binding"],
        "proofs": proofs, "admitted_total_history_attempts": selected["admitted_total_history_attempts"],
        "batch_policy": selected["batch_policy"], "batch_policy_digest": selected["batch_policy_digest"]}
    for evidence in evidences:
        artifact, log = evidence["artifact"], evidence["producer_log"]
        path = log["path"]
        data["logs"][path] = {key: value for key, value in log.items() if key != "path"}
        data["originals"][str(artifact["id"])] = {"metadata": {key: artifact[key] for key in
            ("id", "name", "digest", "created_at", "expires_at", "workflow_run")}, "producer_log": path}
        data["source_runs"][evidence["receipt"]["run_id"]] = tool.entry_from_receipt(evidence["receipt"])


def validate_admitted(data, settings=None):
    if data["planned"]["manifest"]["context"]["inputs"]["computation_scope"] == "fixture":
        require("native_admission" not in data, "fixture cannot carry native admission")
        return
    native = data.get("native_admission")
    require(isinstance(native, dict) and native["binding"] == binding(data["planned"], data["chain"]),
            "production lacks exact native admission binding")
    proof = native["proofs"].get(str(native["reference"]["artifact_id"]))
    require(proof is not None and proof["reference"] == native["reference"] and proof["payload"]["state"] == "admitted"
            and proof["receipt"]["kind"] == "admission" and proof["job"]["conclusion"] == "success",
            "native admission is not an authenticated successful decision")
    links = [proof["payload"][key] for key in ("pilot_reference", "report_reference", "review_reference")]
    require(set(native["proofs"]) == {str(native["reference"]["artifact_id"]), *(str(link["artifact_id"]) for link in links)},
            "native admission proof inventory changed")
    pilot, report, review = [native["proofs"][str(link["artifact_id"])] for link in links]
    require(pilot["reference"] == links[0] and report["reference"] == links[1] and review["reference"] == links[2]
            and pilot["receipt"]["kind"] == "pilot" and report["receipt"]["kind"] == "report"
            and review["receipt"]["kind"] == "admission" and review["payload"]["state"] == REVIEW_REQUIRED
            and review["payload"]["report_reference"] == report["reference"]
            and review["payload"]["pilot_reference"] == pilot["reference"]
            and report["payload"]["pilot_reference"] == pilot["reference"]
            and proof["receipt"]["attempt"] > review["receipt"]["attempt"] == report["receipt"]["attempt"] == pilot["receipt"]["attempt"],
            "native admission lost the exact expected review transition")
    require(proof["payload"]["admitted_total_history_attempts"] == native["admitted_total_history_attempts"], "native history ceiling changed")
    require(type(native["admitted_total_history_attempts"]) is int and 1 <= native["admitted_total_history_attempts"] <= 408
            and report["payload"]["forecast"]["admitted_total_history_attempts"] == native["admitted_total_history_attempts"],
            "native history ceiling differs from admitted sizing")
    policy = native["batch_policy"]
    validate_batch_policy(policy, data["planned"], native["binding"], report["payload"]["forecast"], report["payload"]["sizing"])
    require(native["batch_policy_digest"] == model.digest(policy), "admitted batch policy digest changed")
    for candidate in native["proofs"].values():
        receipt, payload = candidate["receipt"], candidate["payload"]
        require(payload["batch_policy"] == policy and payload["batch_policy_digest"] == native["batch_policy_digest"],
                "admitted batch policy was substituted")
        require(payload["binding"] == native["binding"] and receipt["binding_digest"] == model.digest(native["binding"])
                and payload["accepted_production_outcomes"] == 0, "retained native proof binding changed")
        raw = (json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n").encode()
        require(artifacts.sha(raw) == receipt["payload_sha256"], "retained native payload differs from authenticated receipt")
        expected = "success" if payload["state"] in ("complete", "admitted") else "failure"
        require(candidate["job"]["status"] == "completed" and candidate["job"]["conclusion"] == expected
                and payload["state"] in ("complete", "admitted", REVIEW_REQUIRED), "terminal native decision retained in admission")
        original = data["originals"].get(str(candidate["reference"]["artifact_id"]))
        require(original is not None and original["metadata"]["digest"] == candidate["reference"]["archive_digest"]
                and original["producer_log"] == candidate["producer_log"]["path"], "native original evidence disappeared")
    validate_batch_history(data, policy)
    if settings is not None:
        consumed = sum(entry["sealed_attempt"] if entry["run_id"] != settings["run_id"] else settings["attempt"]
                       for entry in data["chain"]["runs"])
        if consumed > native["admitted_total_history_attempts"]:
            raise runner.CapacityFailure("native admitted total-history ceiling exhausted")


def validate_batch_history(data, policy):
    manifest = data["planned"]["manifest"]
    order = {entry["run_id"]: index for index, entry in enumerate(data["chain"]["runs"])}
    pending = runner.ordered_remaining_by_slot(manifest, [])
    completed = [set() for _ in range(8)]
    bundles = sorted(data.get("bundles", []), key=lambda item: (order[item["bundle"]["receipt"]["run_id"]],
        item["bundle"]["receipt"]["attempt"], item["bundle"]["receipt"]["slot"]))
    for item in bundles:
        bundle = item["bundle"]
        receipt, delta = bundle["receipt"], bundle["delta"]
        require(receipt.get("batch_policy_digest") == model.digest(policy), "historical worker batch policy changed or missing")
        if delta is None:
            continue
        slot = receipt["slot"]
        prefix = [mid for mid in pending[slot] if mid not in completed[slot]][:policy["max_mutations"]]
        require(delta["batch_ids"] == prefix and receipt["batch_id"] == model.digest(prefix),
                "historical worker exceeded or changed admitted ordered prefix")
        completed[slot].update(record["mutation_id"] for record in delta["records"])


def validate_batch_policy(policy, planned, expected_binding, forecasted, sizing):
    require(set(policy) == {"algorithm", "max_mutations", "manifest_digest", "binding_digest", "shapes", "projection",
                           "whole_slot_projection", "limits", "history_attempt_ceiling"}, "unexpected batch policy fields")
    require(policy["algorithm"] == runner.BATCH_ALGORITHM
            and planned["orchestration"]["contract"]["batch_algorithm"] == runner.BATCH_ALGORITHM
            and policy["manifest_digest"] == policy["shapes"]["full_manifest_digest"] == model.digest(planned["manifest"])
            and policy["binding_digest"] == model.digest(expected_binding), "batch policy computation binding changed")
    require(policy["limits"] == {"member_bytes": artifacts.MAX_MEMBER, "expanded_bytes": artifacts.MAX_ARCHIVE,
        "member_count": artifacts.MAX_MEMBERS, "headroom_fraction": .8}, "batch policy changed fixed byte bounds")
    count = policy["max_mutations"]
    model.validate_manifest(planned["manifest"])
    counts = [0] * model.SLOT_COUNT
    for item in planned["manifest"]["mutations"]:
        counts[item["slot"]] += 1
    largest = max(counts)
    require(type(count) is int and 1 <= count <= largest, "invalid admitted batch count")
    for key, value in policy["shapes"].items():
        if key.endswith("_bytes"):
            require(type(value) is int and value >= 0, "invalid raw member shape")
    projection = raw_projection(policy["shapes"], count)
    require(projection == policy["projection"] and projection["fits_projected_headroom"]
            and (count == largest or not raw_projection(policy["shapes"], count + 1)["fits_projected_headroom"])
            and policy["whole_slot_projection"] == raw_projection(policy["shapes"], largest),
            "admitted batch is not the largest fitting typed raw envelope")
    require(policy["history_attempt_ceiling"] == forecasted["admitted_total_history_attempts"] == sizing["admitted_total_history_attempts"]
            and sizing["batch_policy_digest"] == model.digest(policy), "batch/history admission binding changed")


def admitted_batch_policy(data, settings):
    validate_admitted(data, settings)
    require(settings["scope"] == "production", "fixture cannot consume a native batch policy")
    return runner.AuthenticatedBatchPolicy(data["native_admission"]["batch_policy"], data["planned"], data["chain"], settings)


def validate_native_phase(data, job):
    validate_admitted(data)
    proofs = data["native_admission"]["proofs"].values()
    matching = [proof for proof in proofs if proof["receipt"]["job_id"] == str(job["id"])]
    require(len(matching) == 1 and matching[0]["job"] == job and JOBS[matching[0]["receipt"]["kind"]] == job["name"],
            "started native phase is outside fixed admitted history")


def load_admission(api, selected, planned, chain, repository):
    admitted = authenticate(api, selected, "admission", planned, chain, repository)
    require(admitted["payload"]["state"] == "admitted", "native spending decision still requires external review")
    pilot = authenticate(api, admitted["payload"]["pilot_reference"], "pilot", planned, chain, repository)
    report = authenticate(api, admitted["payload"]["report_reference"], "report", planned, chain, repository)
    review = authenticate(api, admitted["payload"]["review_reference"], "admission", planned, chain, repository)
    expected = admission_decision({"run_id": admitted["receipt"]["run_id"], "attempt": admitted["receipt"]["attempt"]},
                                 planned, chain, report, pilot, [pilot, report, review])
    for key in ("state", "report_reference", "pilot_reference", "review_reference", "admitted_total_history_attempts", "report_upload", "batch_policy", "batch_policy_digest"):
        require(admitted["payload"][key] == expected[key], "native admitted verdict changed its original measurement")
    return [pilot, report, review, admitted]
