"""CI graph adapter. External controllers own all reruns and continuation dispatches."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile
import zlib

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_qualification as qualification
import mutation_recovery as recovery
import mutation_runner as runner
import mutation_tool as tool

require = artifacts.require
CAMPAIGN_DAYS = 7
RETENTION_DAYS = 30
MAX_CHAIN_RUNS = 8


def output(key, value):
    encoded = json.dumps(value, separators=(",", ":")) if isinstance(value, (dict, list)) else str(value)
    require("\n" not in encoded and "\r" not in encoded, "invalid workflow output")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
        stream.write(f"{key}={encoded}\n")


def current_settings(api, root, scope, job_name, slot):
    repository, run_id, attempt = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_RUN_ID"], int(os.environ["GITHUB_RUN_ATTEMPT"])
    require(1 <= attempt <= 51, "same-run attempt budget exhausted")
    run = api.json(f"repos/{repository}/actions/runs/{run_id}")
    require(run["repository"]["full_name"] == repository and run["head_repository"]["full_name"] == repository
            and run["path"] == tool.WORKFLOW, "foreign run or workflow")
    jobs = list(artifacts.pages(api, f"repos/{repository}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs"))
    matches = [job for job in jobs if job["name"] == job_name and job["status"] == "in_progress"]
    require(len(matches) == 1, "current numeric job identity is ambiguous")
    job = matches[0]
    require(job["run_id"] == int(run_id) and job["run_attempt"] == attempt, "current job attempt mismatch")
    return {"repository": repository, "workflow": tool.WORKFLOW, "workflow_sha": os.environ["GITHUB_WORKFLOW_SHA"],
        "run_id": run_id, "attempt": attempt, "head_sha": run["head_sha"], "job_id": str(job["id"]),
        "slot": slot, "scope": scope, "opt_level": 2, "cargo_jobs": 2,
        "runner_image": {key: os.environ[key] for key in ("ImageOS", "ImageVersion")},
        "job_started_at": job["started_at"], "build_cap_seconds": 600,
        "log_retention_days": int(os.environ["GITHUB_RETENTION_DAYS"]),
        # Conservative initial reserves. Retained fixture and campaign timing measures them.
        "shutdown_seconds": 30, "validation_seconds": 120, "upload_seconds": 240,
        "survivor_baseline": str(Path(root).resolve() / "docs/mutants-baseline.txt")}


def current_entry(root, settings):
    checkout, _ = runner.checkout_inventory(root, settings["repository"])
    return {"run_id": settings["run_id"], "head_sha": settings["head_sha"], "workflow_sha": settings["workflow_sha"],
            **{key: checkout[key] for key in ("commit", "tree", "ref")}, "predecessor": None}


def initial_chain(root, settings):
    now = dt.datetime.now(dt.timezone.utc)
    return {"version": 1, "started_at": now.isoformat(), "expires_at": (now + dt.timedelta(days=CAMPAIGN_DAYS)).isoformat(),
            "max_attempts": 51, "retention_days": RETENTION_DAYS, "runs": [current_entry(root, settings)]}


def extend_chain(chain, entry, predecessor, sealed_attempt=None):
    require(1 <= len(chain["runs"]) < MAX_CHAIN_RUNS, "cross-run chain budget exhausted")
    require(predecessor == chain["runs"][-1]["run_id"] and predecessor != entry["run_id"], "explicit predecessor mismatch")
    require(all(item["head_sha"] == entry["head_sha"] for item in chain["runs"]), "changed head stops continuation")
    entry = dict(entry, predecessor=predecessor)
    previous = [dict(item) for item in chain["runs"]]
    if sealed_attempt is not None:
        previous[-1]["sealed_attempt"] = sealed_attempt
    chain = dict(chain, runs=[*previous, entry])
    artifacts.validate_chain(chain, current_run_id=entry["run_id"], now=dt.datetime.now(dt.timezone.utc))
    return chain


def run_artifacts(api, settings):
    return list(artifacts.pages(api, f"repos/{settings['repository']}/actions/runs/{settings['run_id']}/artifacts", "artifacts"))


def original_plan_reference(api, settings):
    scope_prefix = "fixture-" if settings["scope"] == "fixture" else ""
    pattern = re.compile(rf"mutation-{scope_prefix}plan-run-{settings['run_id']}-attempt-([1-9][0-9]*)$")
    choices = []
    for artifact in run_artifacts(api, settings):
        match = pattern.fullmatch(artifact["name"])
        if match:
            attempt = int(match.group(1))
            require(attempt < settings["attempt"], "same-attempt plan collision")
            choices.append((attempt, artifact["id"]))
    require(len(choices) <= 1, "multiple original plans in one run")
    if choices:
        attempt, artifact_id = choices[0]
        return {"run_id": settings["run_id"], "attempt": attempt, "artifact_id": artifact_id}
    return None


def read_plan_envelope(api, repository, reference):
    # This preliminary read supplies authentication parameters only. recover_plan
    # authenticates every field and byte before any calibration, tool or result use.
    artifact = api.json(f"repos/{repository}/actions/artifacts/{reference['artifact_id']}")
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{reference['artifact_id']}/zip")
    require(artifact["digest"] == "sha256:" + artifacts.sha(raw), "plan archive digest mismatch")
    return artifacts.strict_json(artifacts.unpack(raw)["plan.json"])


def bind_chain_to_plan(planned, chain):
    """Only the run list may grow; campaign policy belongs to the original plan."""
    original = planned["orchestration"]["chain"]
    require(type(original["version"]) is int and original["version"] == 1
            and type(original["max_attempts"]) is int and original["max_attempts"] == 51
            and type(original["retention_days"]) is int and original["retention_days"] == RETENTION_DAYS
            and artifacts.timestamp(original["expires_at"]) - artifacts.timestamp(original["started_at"])
                == dt.timedelta(days=CAMPAIGN_DAYS), "original plan violates fixed campaign policy")
    for key in ("version", "started_at", "expires_at", "max_attempts", "retention_days"):
        require(type(chain[key]) is type(original[key]) and chain[key] == original[key],
                "campaign policy differs from original plan: " + key)
    frozen, supplied = original["runs"], chain["runs"]
    require(1 <= len(frozen) <= len(supplied) <= MAX_CHAIN_RUNS, "invalid append-only run-chain length")
    fields = {"run_id", "predecessor", "head_sha", "workflow_sha", "commit", "tree", "ref"}
    for index, entry in enumerate(supplied):
        require(set(entry) <= fields | {"sealed_attempt"} and fields <= set(entry), "unexpected run-chain fields")
        require(entry["predecessor"] == (None if index == 0 else supplied[index - 1]["run_id"]),
                "run chain is not an ordered append-only extension")
        require(entry["head_sha"] == frozen[0]["head_sha"], "changed head stops continuation")
        if index < len(frozen):
            require(all(entry[key] == value for key, value in frozen[index].items()), "original run-chain entry changed")
        if index < len(supplied) - 1:
            require(type(entry.get("sealed_attempt")) is int and 1 <= entry["sealed_attempt"] <= 51,
                    "predecessor requires a bounded sealed attempt")
        else:
            require("sealed_attempt" not in entry, "current run cannot be pre-sealed")


def load_plan(api, root, settings, reference, chain=None):
    envelope = read_plan_envelope(api, settings["repository"], reference)
    chain = chain or dict(envelope["orchestration"]["chain"], plan=reference)
    chain["plan"] = reference
    planned = artifacts.recover_plan(api, chain, current_run_id=settings["run_id"], current_attempt=settings["attempt"],
        repository=settings["repository"], workflow=tool.WORKFLOW,
        workflow_digest=artifacts.sha((root / tool.WORKFLOW).read_bytes()), scope=settings["scope"])
    bind_chain_to_plan(planned, chain)
    require(planned["orchestration"]["contract"] == tool.committed_contract(root), "plan orchestration inputs changed")
    entry = current_entry(root, settings)
    selected = next(item for item in chain["runs"] if item["run_id"] == settings["run_id"])
    require(all(selected[key] == entry[key] for key in ("head_sha", "workflow_sha", "commit", "tree", "ref")), "current chain checkout changed")
    required_until = artifacts.timestamp(chain["expires_at"]) + tool.MARGIN
    for item in chain["runs"]:
        run = api.json(f"repos/{settings['repository']}/actions/runs/{item['run_id']}")
        for artifact in recovery.artifact_inventory(api, settings["repository"], item["run_id"]):
            if artifact["id"] == reference["artifact_id"] or artifact["name"].startswith("mutation-" + planned["manifest"]["campaign_id"] + "-"):
                tool.retained_until(api, settings["repository"], artifact, run, required_until,
                                    planned["orchestration"]["log_retention_days"])
    return planned, chain


def require_prior_worker_evidence(api, settings, manifest, chain):
    """A failed worker with no upload cannot disappear on a favorable rerun."""
    prefix = "mutation-fixture-slot-" if settings["scope"] == "fixture" else "mutation-slot-"
    for entry in chain["runs"]:
        run_id = entry["run_id"]
        run = api.json(f"repos/{settings['repository']}/actions/runs/{run_id}")
        last = settings["attempt"] - 1 if run_id == settings["run_id"] else run["run_attempt"]
        names = {artifact["name"] for artifact in artifacts.pages(api,
            f"repos/{settings['repository']}/actions/runs/{run_id}/artifacts", "artifacts")}
        for attempt in range(1, last + 1):
            jobs = artifacts.pages(api, f"repos/{settings['repository']}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
            for job in jobs:
                match = re.fullmatch(re.escape(prefix) + r"([0-7])", job["name"])
                if match and job.get("started_at") and job.get("conclusion") != "skipped":
                    expected = artifacts.artifact_name(manifest["campaign_id"], run_id, attempt, int(match.group(1)))
                    require(expected in names, "prior worker missing immutable evidence; terminal infrastructure failure")


def bind_tool(api, root, settings, reference, contract, scratch, chain):
    require(reference["repository"] == settings["repository"], "foreign tool repository")
    path, authenticated = tool.authenticate(api, reference, contract, scratch / "verified-tool", root,
        settings["runner_image"], artifacts.timestamp(chain["expires_at"]) + tool.MARGIN)
    settings.update(require_authenticated_tool=True, tool_executable=str(path),
                    tool_sha256=reference["executable_sha256"], tool_contract=authenticated)


def check_qualification(api, settings, orchestration, chain):
    if settings["scope"] == "production":
        selected = orchestration["qualification"]
        artifact = api.json(f"repos/{settings['repository']}/actions/artifacts/{selected['artifact_id']}")
        require(artifact["digest"] == selected["archive_digest"], "selected qualification changed")
        proof = qualification.verify(api, settings["repository"], selected["artifact_id"], orchestration["contract"],
            artifacts.timestamp(chain["expires_at"]) + tool.MARGIN)
        require(proof["tool"] == orchestration["tool"], "production tool differs from qualified executable")
        return proof


def prepare_tool(api, root, settings, scratch):
    api.rate_status(100)
    existing = [item for item in run_artifacts(api, settings) if
                re.fullmatch(rf"mutation-tool-run-{settings['run_id']}-attempt-[1-9][0-9]*", item["name"])]
    require(len(existing) <= 1, "ambiguous tool producer")
    if existing:
        reference = tool.reference_for(api, settings["repository"], existing[0]["id"])
        require(reference["attempt"] < settings["attempt"], "same-attempt tool collision")
        bind_tool(api, root, settings, reference, tool.committed_contract(root), scratch, initial_chain(root, settings))
        output("tool_id", existing[0]["id"])
        output("reused", "true")
        return
    tool.build(root, settings, scratch / "tool")
    output("reused", "false")


def prepare_plan(api, root, settings, scratch):
    api.rate_status(400)
    reference = original_plan_reference(api, settings)
    supplied_chain = os.environ.get("RESUME_CHAIN", "")
    predecessor = os.environ.get("RESUME_RUN_ID", "")
    explicit_plan = os.environ.get("RESUME_PLAN_ARTIFACT_ID", "")
    if supplied_chain or predecessor or explicit_plan:
        require(supplied_chain and predecessor and explicit_plan and reference is None, "incomplete or conflicting continuation inputs")
        chain = artifacts.strict_json(supplied_chain)
        require(chain["plan"]["artifact_id"] == int(explicit_plan), "explicit plan ID mismatch")
        reference = chain["plan"]
        if settings["run_id"] not in {entry["run_id"] for entry in chain["runs"]}:
            predecessor_run = api.json(f"repos/{settings['repository']}/actions/runs/{predecessor}")
            chain = extend_chain(chain, current_entry(root, settings), predecessor, predecessor_run["run_attempt"])
    else:
        chain = None
    if reference:
        planned, chain = load_plan(api, root, settings, reference, chain)
        check_qualification(api, settings, planned["orchestration"], chain)
        bind_tool(api, root, settings, planned["orchestration"]["tool"], planned["orchestration"]["contract"], scratch, chain)
        runner.validate_current_plan(root, planned, settings)
        output("plan_id", reference["artifact_id"])
        output("chain", chain)
        output("reused", "true")
        return
    chain = initial_chain(root, settings)
    contract = tool.committed_contract(root)
    if settings["scope"] == "fixture":
        tool_ref = tool.reference_for(api, settings["repository"], int(os.environ["TOOL_ARTIFACT_ID"]))
        qualified = None
    else:
        qualified, proof = qualification.discover(api, settings["repository"], contract,
            artifacts.timestamp(chain["expires_at"]) + tool.MARGIN, os.environ.get("QUALIFICATION_RUN_ID"))
        tool_ref = proof["tool"]
    orchestration = {"version": 1, "contract": contract, "tool": tool_ref, "qualification": qualified, "chain": chain,
                     "log_retention_days": int(os.environ["GITHUB_RETENTION_DAYS"])}
    bind_tool(api, root, settings, tool_ref, contract, scratch, chain)
    calibration = runner.calibrate(root, settings, scratch / "calibration.json")
    destination = scratch / "plan/plan.json"
    runner.plan(root, settings, calibration, destination)
    planned = runner.read_json(destination)
    planned["orchestration"] = orchestration
    runner.write_json(destination, planned)
    print("MUTATION_PLAN " + json.dumps(dict(planned["producer"], plan_digest=artifacts.sha(destination.read_bytes())),
                                        sort_keys=True, separators=(",", ":")), flush=True)
    output("chain", chain)
    output("reused", "false")


def selected_plan_input(api, root, settings):
    chain = artifacts.strict_json(os.environ["MUTATION_CHAIN"])
    plan_id = int(os.environ["PLAN_ARTIFACT_ID"])
    reference = chain.get("plan")
    if reference is None:
        artifact = api.json(f"repos/{settings['repository']}/actions/artifacts/{plan_id}")
        match = re.fullmatch(r"mutation-(?:fixture-)?plan-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)", artifact["name"])
        require(match is not None, "invalid original plan name")
        reference = {"run_id": match.group(1), "attempt": int(match.group(2)), "artifact_id": plan_id}
    require(reference["artifact_id"] == plan_id, "worker plan reference mismatch")
    return reference, dict(chain, plan=reference)


def bind_prepared_tool(api, root, settings, data, scratch):
    reference = data["planned"]["orchestration"]["tool"]
    require(reference["repository"] == settings["repository"], "foreign prepared tool repository")
    executable, contract = tool.consume_prepared(api, reference, data["tool_receipt"], data["contract"],
        scratch / "verified-tool", root, settings["runner_image"],
        artifacts.timestamp(data["chain"]["expires_at"]) + tool.MARGIN)
    settings.update(require_authenticated_tool=True, tool_executable=str(executable),
                    tool_sha256=reference["executable_sha256"], tool_contract=contract)


def refresh_recovery(api, root, settings, scratch, *, include_current):
    reference, chain = selected_plan_input(api, root, settings)
    recording = recovery.RecordingAPI(api)
    planned, chain = load_plan(recording, root, settings, reference, chain)
    require(planned["manifest"]["context"]["inputs"]["computation_scope"] == settings["scope"], "recovery scope mismatch")
    contract = tool.committed_contract(root)
    checkout, _ = runner.checkout_inventory(root, settings["repository"])
    data = {"version": 1, "planned": planned, "chain": chain, "contract": contract,
        "originals": {}, "logs": {}, "source_runs": {}, "bundles": [], "frontier": {},
        "job_inventories": {}, "current_checkout": checkout, "qualification": None}
    inventory, runs = recovery.fresh_inventory(api, data, settings, allow_current_aggregate=include_current)
    selected = recovery.latest_snapshot(inventory, data, settings, allow_prepared=include_current)
    if selected:
        restored, receipt = recovery.load(api, selected, settings["repository"], contract)
        require(restored["planned"] == planned, "snapshot replaced original plan or calibration")
        require(restored["chain"]["expires_at"] == chain["expires_at"] and
                restored["chain"]["started_at"] == chain["started_at"], "snapshot changed original lifetime")
        data = dict(restored, chain=chain, current_checkout=checkout)
        # A validated failure remains fatal even if a later caller has complete coverage.
        require(receipt["verdict"]["state"] in {"complete", "incomplete_with_progress", "incomplete_without_progress"},
                "terminal recovery verdict stops continuation")
        recovery.retain_recording(recording, data)
        inventory, runs = recovery.fresh_inventory(api, data, settings, allow_current_aggregate=include_current)
        if settings["scope"] == "production":
            proof = data["qualification"]
            require(proof is not None and proof["contract"] == contract and proof["tool"] == planned["orchestration"]["tool"],
                    "prepared qualification contract changed")
        bind_prepared_tool(api, root, settings, data, scratch)
    else:
        data["qualification"] = check_qualification(recording, settings, planned["orchestration"], chain)
        bind_tool(recording, root, settings, planned["orchestration"]["tool"], contract, scratch, chain)
        data["tool_receipt"] = recording.tool_receipts[str(planned["orchestration"]["tool"]["artifact_id"])]
        recovery.retain_recording(recording, data)
        inventory, runs = recovery.fresh_inventory(api, data, settings, allow_current_aggregate=include_current)
    runner.validate_current_plan(root, planned, settings)
    recovered = recovery.ingest(api, data, settings, inventory, runs, include_current=include_current)
    # Newly ingested originals must satisfy the same original lifetime immediately.
    recovery.fresh_inventory(api, data, settings, allow_current_aggregate=include_current)
    return data, recovered


def prepare_recovery(api, root, settings, scratch):
    api.rate_status(800)
    data, recovered = refresh_recovery(api, root, settings, scratch, include_current=False)
    baseline = (root / "docs/mutants-baseline.txt").read_text(encoding="utf-8").splitlines() if settings["scope"] == "production" else []
    summary = model.summarize(data["planned"]["manifest"], recovered["records"], baseline)
    state, reason = runner.continuation_status(summary, recovered["bundles"],
        max_attempts=data["chain"]["max_attempts"], attempt=settings["attempt"] - 1)
    require(state in {"complete", "incomplete_with_progress", "incomplete_without_progress"}, "terminal prior mutation failure: " + reason)
    data["api_rate"] = api.rate_status()
    receipt = recovery.seal(data, settings, "prepared", {"state": "complete", "reason": "authenticated_preparation"}, scratch / "prepared")
    output("artifact_name", recovery.artifact_name(settings["scope"], receipt["campaign_id"], "prepared", settings["run_id"], settings["attempt"]))


def execute(api, root, settings, scratch, command):
    api.rate_status(50 if command == "slot" else 400)
    if command == "slot":
        artifact_id = int(os.environ["PREPARED_ARTIFACT_ID"])
        metadata = api.json(f"repos/{settings['repository']}/actions/artifacts/{artifact_id}")
        data, _ = recovery.load(api, {"artifact_id": artifact_id, "archive_digest": metadata["digest"]},
            settings["repository"], tool.committed_contract(root),
            consumer={"run_id": settings["run_id"], "attempt": settings["attempt"]})
        require(data["planned"]["manifest"]["context"]["inputs"]["computation_scope"] == settings["scope"], "prepared recovery scope mismatch")
        bind_prepared_tool(api, root, settings, data, scratch)
        runner.validate_current_plan(root, data["planned"], settings)
        recovered = recovery.recovered(data, settings, include_current=False)
    else:
        data, recovered = refresh_recovery(api, root, settings, scratch, include_current=True)
    planned, chain = data["planned"], data["chain"]
    campaign_id = planned["manifest"]["campaign_id"]
    output("campaign_id", campaign_id)
    output("artifact_name", artifacts.artifact_name(campaign_id, settings["run_id"], settings["attempt"], settings["slot"]))
    if command == "slot":
        if settings["scope"] == "fixture" and settings["attempt"] == 1:
            settings["fixture_stop_after_records"] = 1
        result = runner.execute_slot(root, settings, planned, chain, scratch / "result", api, recovered=recovered)
        status = result["status"]
    else:
        status = runner.aggregate(root, planned, chain, settings, scratch / "aggregate.json", api, recovered=recovered)
        data["api_rate"] = status["api_rate"] = api.rate_status()
        detailed = runner.read_json(scratch / "aggregate.json")
        detailed["continuation"] = {"chain": chain, "original_plan_artifact_id": chain["plan"]["artifact_id"],
            "tool": planned["orchestration"]["tool"], "next_action": "Rerun the authenticated numeric mutation-prepare job and its dependents."}
        runner.write_json(scratch / "aggregate.json", detailed)
        receipt = recovery.seal(data, settings, "aggregate", status, scratch / "snapshot")
        output("snapshot_name", recovery.artifact_name(settings["scope"], campaign_id, "aggregate", settings["run_id"], settings["attempt"]))
        if status["state"] == "complete" and settings["scope"] == "fixture":
            qualification.emit(settings, planned["orchestration"]["contract"], planned, chain, detailed, scratch / "qualification")
            output("qualified", "true")
    runner.write_json(scratch / "status.json", status)
    return runner.STATES[status["state"]]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("tool", "plan", "prepare", "slot", "aggregate"))
    parser.add_argument("--root", default=".")
    parser.add_argument("--scope", required=True, choices=("fixture", "production"))
    parser.add_argument("--slot", type=int, default=0)
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    scratch = Path(os.environ["RUNNER_TEMP"]) / "mutation-job"
    scratch.mkdir(exist_ok=True)
    require(not scratch.resolve().is_relative_to(root), "workflow scratch overlaps checkout")
    api = recovery.WorkflowAPI()
    try:
        settings = current_settings(api, root, args.scope, os.environ["MUTATION_JOB_NAME"], args.slot)
        runner.bound_setup(settings)
        if args.command == "tool":
            prepare_tool(api, root, settings, scratch)
        elif args.command == "plan":
            prepare_plan(api, root, settings, scratch)
        elif args.command == "prepare":
            prepare_recovery(api, root, settings, scratch)
        else:
            return execute(api, root, settings, scratch, args.command)
        return 0
    except runner.CapacityFailure as error:
        status = {"state": "capacity_failure", "reason": str(error)}
        if hasattr(api, "last_rate_observation"):
            status["api_rate"] = api.last_rate_observation
        runner.write_json(scratch / "status.json", status)
        print(json.dumps(status, sort_keys=True))
        return runner.STATES[status["state"]]
    except (ValueError, KeyError, OSError, TypeError, subprocess.SubprocessError, zipfile.BadZipFile, zlib.error) as error:
        status = {"state": "infrastructure_failure", "reason": str(error)}
        runner.write_json(scratch / "status.json", status)
        print(json.dumps(status, sort_keys=True))
        return runner.STATES[status["state"]]


if __name__ == "__main__":
    sys.exit(main())
