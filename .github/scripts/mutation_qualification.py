"""Bounded fixture discovery; no production result discovery or downloaded code."""

import datetime as dt
import json
from pathlib import Path
import re

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_tool as tool
import mutation_native as native

require = artifacts.require
MAX_CANDIDATES = 30
MAX_DISCOVERY_PAGES = 3


def bounded_artifacts(api, repository, run_id):
    result = []
    for page in range(1, MAX_DISCOVERY_PAGES + 1):
        rows = api.json(f"repos/{repository}/actions/runs/{run_id}/artifacts?per_page=100&page={page}")["artifacts"]
        result.extend(rows)
        if len(rows) < 100:
            return result
    raise ValueError("qualification artifact discovery exceeds bounded pages")


def proof_name(run_id, attempt):
    return f"mutation-fixture-qualification-run-{run_id}-attempt-{attempt}"


def validate_recovery(manifest, recovered, run_id, attempt):
    require(manifest["context"]["inputs"]["computation_scope"] == "fixture", "qualification is not fixture evidence")
    require(all(bundle["status"]["state"] in {"complete", "incomplete_with_progress", "incomplete_without_progress"}
                for bundle in recovered["bundles"]), "qualification contains a terminal prior failure")
    summary = model.summarize(manifest, recovered["records"], [])
    require(summary["complete"] and not summary["failing"] and summary["planned"], "fixture coverage is incomplete or failing")
    interrupted = [bundle for bundle in recovered["bundles"] if
        (bundle["receipt"]["run_id"] != run_id or bundle["receipt"]["attempt"] < attempt)
        and bundle["status"]["state"] == "incomplete_with_progress"
        and bundle["status"]["reason"] == "fixture_checkpoint" and bundle["delta"] and bundle["delta"]["records"]]
    require(interrupted, "qualification lacks authenticated interruption with progress")
    for previous in interrupted:
        slot = previous["receipt"]["slot"]
        later = [bundle for bundle in recovered["bundles"] if bundle["receipt"]["slot"] == slot
            and bundle["receipt"]["run_id"] == previous["receipt"]["run_id"]
            and previous["receipt"]["attempt"] < bundle["receipt"]["attempt"]
            and (bundle["receipt"]["run_id"] != run_id or bundle["receipt"]["attempt"] <= attempt)
            and bundle["status"]["state"] == "complete" and bundle["delta"] and bundle["delta"]["records"]]
        require(later, "qualification lacks same-run resumed pending execution")
    return summary


def verify(api, repository, artifact_id, contract, required_until):
    artifact = api.json(f"repos/{repository}/actions/artifacts/{artifact_id}")
    raw = api.bytes(f"repos/{repository}/actions/artifacts/{artifact_id}/zip")
    require(artifact["digest"] == "sha256:" + artifacts.sha(raw), "qualification archive digest mismatch")
    files = artifacts.unpack(raw)
    require(set(files) == {"qualification.json"}, "unexpected qualification archive members")
    proof = artifacts.strict_json(files["qualification.json"])
    require(proof["version"] == 1 and proof["repository"] == repository and proof["contract"] == contract,
            "qualification computation contract mismatch")
    require(artifact["name"] == proof_name(proof["run_id"], proof["attempt"])
            and str(artifact["workflow_run"]["id"]) == proof["run_id"]
            and artifact["workflow_run"]["head_sha"] == proof["head_sha"], "qualification artifact producer mismatch")
    entry = tool.entry_from_receipt(proof)
    run = artifacts.authenticate_run(api, repository, tool.WORKFLOW, entry, contract["files"][tool.WORKFLOW])
    require(run["event"] == "workflow_dispatch", "qualification requires manual fixture run")
    tool.retained_until(api, repository, artifact, run, required_until, proof["log_retention_days"])
    tool.verify_committed_contract(api, repository, proof["workflow_sha"], contract)
    tool.verify_committed_contract(api, repository, proof["checkout"]["commit"], contract)
    artifacts.authenticate_producer(api, repository, entry, artifact, proof,
        now=dt.datetime.now(dt.timezone.utc), job_name="mutation-fixture-aggregate", marker="MUTATION_QUALIFICATION")
    jobs = list(artifacts.pages(api, f"repos/{repository}/actions/runs/{proof['run_id']}/attempts/{proof['attempt']}/jobs", "jobs"))
    require(any(str(job["id"]) == proof["job_id"] and job["status"] == "completed" and job["conclusion"] == "success"
                for job in jobs), "qualification producer did not pass")
    planned = artifacts.recover_plan(api, proof["chain"], current_run_id=proof["run_id"], current_attempt=proof["attempt"],
        repository=repository, workflow=tool.WORKFLOW, workflow_digest=contract["files"][tool.WORKFLOW], scope="fixture")
    plan_files = artifacts.unpack(api.bytes(f"repos/{repository}/actions/artifacts/{proof['chain']['plan']['artifact_id']}/zip"))
    native.validate_plan_files(plan_files, planned)
    require(planned["orchestration"]["tool"] == proof["tool"], "qualification tool differs from original plan")
    identity = planned["manifest"]["context"]["inputs"]["cargo_mutants_identity"]
    require(identity["binary_sha256"] == proof["tool"]["executable_sha256"] and
            identity["authenticated_contract"]["recipe"] == contract, "qualification tool computation mismatch")
    recovered = artifacts.recover(api, planned["manifest"], proof["chain"], current_run_id=proof["run_id"],
        current_attempt=proof["attempt"], include_current=True)
    summary = validate_recovery(planned["manifest"], recovered, proof["run_id"], proof["attempt"])
    require(proof["planned"] == summary["planned"] and proof["completed"] == summary["completed"], "qualification identity set mismatch")
    # Every original piece must remain recoverable throughout the next campaign.
    for chain_entry in proof["chain"]["runs"]:
        chain_run = api.json(f"repos/{repository}/actions/runs/{chain_entry['run_id']}")
        for item in artifacts.pages(api, f"repos/{repository}/actions/runs/{chain_entry['run_id']}/artifacts", "artifacts"):
            if item["id"] == proof["chain"]["plan"]["artifact_id"] or item["name"].startswith("mutation-" + planned["manifest"]["campaign_id"] + "-"):
                tool.retained_until(api, repository, item, chain_run, required_until,
                                    planned["orchestration"]["log_retention_days"])
    return proof


def discover(api, repository, contract, required_until, selected_run=None):
    if selected_run:
        require(re.fullmatch(r"[1-9][0-9]*", selected_run) is not None, "invalid qualification run")
        candidates = [api.json(f"repos/{repository}/actions/runs/{selected_run}")]
    else:
        candidates = api.json(f"repos/{repository}/actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page={MAX_CANDIDATES}")["workflow_runs"]
        require(len(candidates) <= MAX_CANDIDATES, "qualification candidate bound exceeded")
    failures = []
    for run in candidates:
        if run.get("event") != "workflow_dispatch" or run.get("path") != tool.WORKFLOW:
            continue
        for artifact in reversed(bounded_artifacts(api, repository, str(run["id"]))):
            if not re.fullmatch(rf"mutation-fixture-qualification-run-{run['id']}-attempt-[1-9][0-9]*", artifact["name"]):
                continue
            try:
                proof = verify(api, repository, artifact["id"], contract, required_until)
                return {"artifact_id": artifact["id"], "run_id": str(run["id"]),
                        "archive_digest": artifact["digest"]}, proof
            except (ValueError, KeyError, TypeError) as error:
                failures.append(str(error))
    raise ValueError("no authenticated interrupted/resumed fixture qualification: " + "; ".join(failures[-3:]))


def emit(settings, contract, planned, chain, detailed, output):
    recovered = {"records": model.merge_deltas(planned["manifest"], detailed["recovery"]["deltas"],
        allowed_run_ids=set(detailed["recovery"]["allowed_run_ids"]), current_run_id=settings["run_id"],
        current_attempt=settings["attempt"], include_current=True), "bundles": []}
    by_delta = {delta["delta_id"]: delta for delta in detailed["recovery"]["deltas"]}
    recovered["bundles"] = [dict(item, delta=by_delta.get(item["delta_id"])) for item in detailed["recovery"]["attempts"]]
    summary = validate_recovery(planned["manifest"], recovered, settings["run_id"], settings["attempt"])
    proof = {"version": 1, "repository": settings["repository"], "workflow": tool.WORKFLOW,
        "workflow_sha": settings["workflow_sha"], "head_sha": settings["head_sha"], "run_id": settings["run_id"],
        "attempt": settings["attempt"], "job_id": settings["job_id"], "checkout": detailed["current_checkout"],
        "contract": contract, "chain": chain, "tool": planned["orchestration"]["tool"],
        "log_retention_days": int(__import__('os').environ["GITHUB_RETENTION_DAYS"]),
        "planned": summary["planned"], "completed": summary["completed"]}
    from mutation_runner import write_json
    write_json(Path(output) / "qualification.json", proof)
    print("MUTATION_QUALIFICATION " + json.dumps(proof, sort_keys=True, separators=(",", ":")), flush=True)
    return proof
