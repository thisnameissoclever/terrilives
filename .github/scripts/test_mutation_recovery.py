"""Lossless compact proofs, original availability, and complete wrapper request costs."""

import base64
import contextlib
import copy
import datetime as dt
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest import mock

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_qualification as qualification
import mutation_recovery as recovery
import mutation_runner as runner
import mutation_tool as tool
import mutation_workflow as workflow
from test_mutation_artifacts import archive
import test_mutation_qualification as qualification_tests


class SnapshotFixture:
    def __init__(self, owner):
        self.q = qualification_tests.QualificationAuthenticationTests()
        self.q.setUp()
        owner.addCleanup(self.q.doCleanups)
        self.api = self.q.api
        self.api.probe_logs = lambda repository, run_id: self.api.calls.append(f"PROBE repos/{repository}/actions/runs/{run_id}/logs")
        self.root = Path(self.q.fixture.temp.name) / "source"
        (self.root / "docs").mkdir()
        (self.root / "docs/mutants-baseline.txt").write_text("")
        self.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 3
        self.contract = self.q.contract
        recorder = recovery.RecordingAPI(recovery.WorkflowAPI(self.api))
        proof = qualification.verify(recorder, "owner/repo", 79, self.contract, self.q.fixture.required)
        tool.authenticate(recorder, self.q.fixture.reference, self.contract, self.q.fixture.destination,
                          self.root, self.q.fixture.image, self.q.fixture.required, runtime=lambda *args: self.q.fixture.runtime)
        self.plan = artifacts.strict_json(artifacts.unpack(self.api.blobs["repos/owner/repo/actions/artifacts/78/zip"])["plan.json"])
        self.data = {"version": 1, "planned": self.plan, "chain": self.q.chain, "contract": self.contract,
            "originals": {}, "logs": {}, "source_runs": {}, "bundles": [], "frontier": {"100": 2},
            "job_inventories": {}, "phase_inventories": {}, "current_checkout": self.q.proof["checkout"], "qualification": proof,
            "tool_receipt": self.q.fixture.receipt}
        recovered = artifacts.recover(recorder, self.q.manifest, self.q.chain, current_run_id="100", current_attempt=2,
                                      include_current=True)
        for bundle in recovered["bundles"]:
            receipt = bundle["receipt"]
            artifact_id = 1000 + receipt["attempt"] * 10 + receipt["slot"]
            compact = {key: value for key, value in bundle.items() if key != "manifest"}
            self.data["bundles"].append({"artifact_id": artifact_id, "bundle": compact, "bundle_digest": model.digest(compact)})
        for attempt in (1, 2):
            self.data["job_inventories"][f"100/{attempt}"] = [job for job in self.q.jobs[attempt] if "slot-" in job["name"]]
            self.data["phase_inventories"][f"100/{attempt}"] = []
        recovery.retain_recording(recorder, self.data)
        # A fixture aggregate seals before publishing its own qualification.
        self.data["originals"].pop("79")
        self.data["logs"].pop("repos/owner/repo/actions/jobs/999/logs")
        self.data["qualification"] = None
        self.settings = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "workflow_sha": "e" * 40,
            "head_sha": "d" * 40, "run_id": "100", "attempt": 2, "job_id": "999", "slot": 0,
            "scope": "fixture", "log_retention_days": 30, "runner_image": self.q.fixture.image,
            "survivor_baseline": str(self.root / "docs/mutants-baseline.txt"),
            "job_started_at": dt.datetime.now(dt.timezone.utc).isoformat(), "opt_level": 2, "cargo_jobs": 2,
            "build_cap_seconds": 600, "shutdown_seconds": 30, "validation_seconds": 120, "upload_seconds": 240}
        self.next_id = 10000

    def upload_snapshot(self, data=None, settings=None, kind="aggregate", state="complete"):
        data, settings = data or self.data, settings or self.settings
        artifact_id = self.next_id
        self.next_id += 1
        directory = Path(self.q.fixture.temp.name) / f"snapshot-{artifact_id}"
        with contextlib.redirect_stdout(io.StringIO()):
            receipt = recovery.seal(data, settings, kind, {"state": state, "reason": "fixture"}, directory)
        raw = archive({path.name: path.read_bytes() for path in directory.iterdir()})
        name = recovery.artifact_name(settings["scope"], data["planned"]["manifest"]["campaign_id"], kind, settings["run_id"], settings["attempt"])
        metadata = dict(self.q.fixture.artifact, id=artifact_id, name=name, digest="sha256:" + artifacts.sha(raw))
        self.api.responses[f"repos/owner/repo/actions/artifacts/{artifact_id}"] = metadata
        self.api.blobs[f"repos/owner/repo/actions/artifacts/{artifact_id}/zip"] = raw
        self.q.artifacts.append(metadata)
        job_name = ("mutation-fixture-prepare" if kind == "prepared" else "mutation-fixture-aggregate") if settings["scope"] == "fixture" else ("mutation-prepare" if kind == "prepared" else "mutation-production-aggregate")
        jobs_path = f"repos/owner/repo/actions/runs/{settings['run_id']}/attempts/{settings['attempt']}/jobs?per_page=100&page=1"
        jobs = self.api.responses.setdefault(jobs_path, {"jobs": []})["jobs"]
        existing = next((job for job in jobs if str(job["id"]) == settings["job_id"]), None)
        if existing is None:
            jobs.append(dict(self.q.fixture.job, id=int(settings["job_id"]), run_id=int(settings["run_id"]),
                             run_attempt=settings["attempt"], name=job_name, conclusion="success" if state == "complete" else "failure"))
        else:
            existing.update(status="completed", conclusion="success" if state == "complete" else "failure")
        self.api.responses[f"repos/owner/repo/actions/runs/{settings['run_id']}/attempts/{settings['attempt']}"] = {
            "id": int(settings["run_id"]), "run_attempt": settings["attempt"], "head_sha": "d" * 40}
        path = f"repos/owner/repo/actions/jobs/{settings['job_id']}/logs"
        self.api.blobs[path] = self.api.blobs.get(path, b"") + (
            "MUTATION_RECOVERY " + json.dumps(receipt) + f"\nMUTATION_ARTIFACT_ID={artifact_id}\n").encode()
        return {"artifact_id": artifact_id, "archive_digest": metadata["digest"]}, receipt

    def add_completed_history(self, run_id, attempt):
        jobs = []
        for slot in range(8):
            artifact_id = int(run_id) * 10000 + attempt * 10 + slot
            receipt = dict(self.plan["producer"], run_id=run_id, attempt=attempt, job_id=str(artifact_id), slot=slot)
            if "native_admission" in self.data:
                receipt["batch_policy_digest"] = self.data["native_admission"]["batch_policy_digest"]
            compact = {"version": 1, "receipt": receipt, "delta": None,
                "status": {"state": "complete", "reason": "exact_coverage", "recorded_at": self.q.fixture.artifact["created_at"]}}
            raw = archive({"bundle.json": json.dumps(dict(compact, manifest=self.q.manifest)).encode()})
            metadata = dict(self.q.fixture.artifact, id=artifact_id,
                name=artifacts.artifact_name(self.q.manifest["campaign_id"], run_id, attempt, slot),
                digest="sha256:" + artifacts.sha(raw), workflow_run={"id": int(run_id), "head_sha": "d" * 40})
            self.q.artifacts.append(metadata)
            self.api.responses[f"repos/owner/repo/actions/artifacts/{artifact_id}"] = metadata
            self.api.blobs[f"repos/owner/repo/actions/artifacts/{artifact_id}/zip"] = raw
            path = f"repos/owner/repo/actions/jobs/{artifact_id}/logs"
            log = ("MUTATION_PRODUCER " + json.dumps(receipt) + f"\nMUTATION_ARTIFACT_ID={artifact_id}\n").encode()
            self.api.blobs[path] = log
            self.data["logs"][path] = {"bytes": base64.b64encode(log).decode(), "sha256": artifacts.sha(log),
                "run_id": run_id, "attempt": attempt, "job_id": str(artifact_id), "observed_at": self.q.now.isoformat(),
                "original_retention_days": 30, "expires_at": (self.q.now + dt.timedelta(days=29)).isoformat()}
            self.data["originals"][str(artifact_id)] = {"metadata": recovery.original_metadata(metadata), "producer_log": path}
            self.data["bundles"].append({"artifact_id": artifact_id, "bundle": compact, "bundle_digest": model.digest(compact)})
            jobs.append(dict(self.q.fixture.job, id=artifact_id, run_id=int(run_id), run_attempt=attempt, name=f"mutation-{'fixture-' if self.settings['scope'] == 'fixture' else ''}slot-{slot}"))
        self.data["job_inventories"][f"{run_id}/{attempt}"] = jobs
        self.data["phase_inventories"][f"{run_id}/{attempt}"] = []
        self.data["frontier"][run_id] = attempt
        self.api.responses[f"repos/owner/repo/actions/runs/{run_id}/attempts/{attempt}"] = {
            "id": int(run_id), "run_attempt": attempt, "head_sha": "d" * 40}
        self.api.responses[f"repos/owner/repo/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100&page=1"] = {"jobs": jobs}

    def paginate(self):
        run_ids = {str(item["workflow_run"]["id"]) for item in self.q.artifacts}
        for run_id in run_ids:
            rows = [item for item in self.q.artifacts if str(item["workflow_run"]["id"]) == run_id]
            for page in range(1, len(rows) // 100 + 2):
                self.api.responses[f"repos/owner/repo/actions/runs/{run_id}/artifacts?per_page=100&page={page}"] = {
                    "artifacts": rows[(page - 1) * 100:page * 100]}

    def upload_directory(self, directory, settings, kind, state="complete"):
        receipt = runner.read_json(Path(directory) / "receipt.json")
        artifact_id = self.next_id
        self.next_id += 1
        raw = archive({path.name: path.read_bytes() for path in Path(directory).iterdir()})
        metadata = dict(self.q.fixture.artifact, id=artifact_id,
            name=recovery.artifact_name(settings["scope"], self.q.manifest["campaign_id"], kind, settings["run_id"], settings["attempt"]),
            digest="sha256:" + artifacts.sha(raw), workflow_run={"id": int(settings["run_id"]), "head_sha": "d" * 40})
        self.q.artifacts.append(metadata)
        self.api.responses[f"repos/owner/repo/actions/artifacts/{artifact_id}"] = metadata
        self.api.blobs[f"repos/owner/repo/actions/artifacts/{artifact_id}/zip"] = raw
        job_name = ("mutation-fixture-prepare" if kind == "prepared" else "mutation-fixture-aggregate") if settings["scope"] == "fixture" else ("mutation-prepare" if kind == "prepared" else "mutation-production-aggregate")
        job = dict(self.q.fixture.job, id=int(settings["job_id"]), run_id=int(settings["run_id"]),
                   run_attempt=settings["attempt"], name=job_name, conclusion="success" if state == "complete" else "failure")
        path = f"repos/owner/repo/actions/runs/{settings['run_id']}/attempts/{settings['attempt']}/jobs?per_page=100&page=1"
        self.api.responses.setdefault(path, {"jobs": []})["jobs"].append(job)
        self.api.responses[f"repos/owner/repo/actions/runs/{settings['run_id']}/attempts/{settings['attempt']}"] = {
            "id": int(settings["run_id"]), "run_attempt": settings["attempt"], "head_sha": "d" * 40}
        self.api.blobs[f"repos/owner/repo/actions/jobs/{settings['job_id']}/logs"] = (
            "MUTATION_RECOVERY " + json.dumps(receipt) + f"\nMUTATION_ARTIFACT_ID={artifact_id}\n").encode()
        self.paginate()
        return artifact_id


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.f = SnapshotFixture(self)

    def test_lossless_dictionary_interning_preserves_original_digests_without_mutable_aliases(self):
        raw = recovery.encode(self.f.data)
        rebuilt = recovery.decode(raw)
        self.assertEqual(rebuilt, self.f.data)
        self.assertEqual(model.digest(rebuilt), model.digest(self.f.data))
        aliases = recovery.decode(recovery.encode({"a": [], "b": []}))
        aliases["a"].append(1)
        self.assertEqual(aliases["b"], [])
        self.assertLess(len(raw), len(json.dumps(self.f.data).encode()))

    def test_snapshot_authentication_reconstructs_exact_records_and_retained_log_bytes(self):
        reference, _ = self.f.upload_snapshot()
        restored, _ = recovery.load(recovery.WorkflowAPI(self.f.api), reference, "owner/repo", self.f.contract)
        expected = recovery.recovered(self.f.data, dict(self.f.settings, attempt=3), include_current=False)
        observed = recovery.recovered(restored, dict(self.f.settings, attempt=3), include_current=False)
        self.assertEqual(observed, expected)
        self.assertEqual(len(observed["records"]), 24)
        for path, log in restored["logs"].items():
            self.assertEqual(base64.b64decode(log["bytes"]), self.f.api.blobs[path])

    def test_stale_preparation_fails_before_any_worker_execution(self):
        settings = dict(self.f.settings, job_id="888", attempt=3)
        reference, _ = self.f.upload_snapshot(settings=settings, kind="prepared")
        with self.assertRaisesRegex(ValueError, "stale preparation"):
            recovery.load(recovery.WorkflowAPI(self.f.api), reference, "owner/repo", self.f.contract,
                          consumer={"run_id": "100", "attempt": 4})

    def test_original_deletion_digest_change_expiry_and_log_corruption_remain_fatal(self):
        settings = dict(self.f.settings, attempt=3)
        inventory = self.f.api.responses["repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"]["artifacts"]
        original = inventory.pop(0)
        with self.assertRaisesRegex(ValueError, "original artifact missing"):
            recovery.fresh_inventory(recovery.WorkflowAPI(self.f.api), self.f.data, settings)
        inventory.insert(0, original)
        previous = original["digest"]
        original["digest"] = "sha256:" + "f" * 64
        with self.assertRaisesRegex(ValueError, "original artifact missing or changed"):
            recovery.fresh_inventory(recovery.WorkflowAPI(self.f.api), self.f.data, settings)
        original["digest"] = previous
        changed = copy.deepcopy(self.f.data)
        next(iter(changed["logs"].values()))["bytes"] = base64.b64encode(b"changed").decode()
        with self.assertRaisesRegex(ValueError, "log changed or expired"):
            recovery.validate_retained(changed)
        next(iter(changed["logs"].values()))["expires_at"] = self.f.q.now.isoformat()
        with self.assertRaisesRegex(ValueError, "log changed or expired"):
            recovery.validate_retained(changed)

    def test_missing_worker_and_three_attempt_gap_are_not_silent_omissions(self):
        settings = dict(self.f.settings, attempt=3)
        api = recovery.WorkflowAPI(self.f.api)
        inventory, runs = recovery.fresh_inventory(api, self.f.data, settings)
        job = dict(self.f.q.fixture.job, id=888, run_attempt=3, name="mutation-fixture-slot-0", conclusion="failure")
        self.f.api.responses["repos/owner/repo/actions/runs/100/attempts/3/jobs?per_page=100&page=1"] = {"jobs": [job]}
        self.f.api.responses["repos/owner/repo/actions/runs/100/attempts/3"] = {
            "id": 100, "run_attempt": 3, "head_sha": "d" * 40}
        with self.assertRaisesRegex(ValueError, "started worker is missing"):
            recovery.ingest(api, self.f.data, settings, inventory, runs, include_current=True)
        with self.assertRaisesRegex(runner.CapacityFailure, "three attempts"):
            recovery.ingest(api, self.f.data, dict(settings, attempt=7), inventory, runs, include_current=False)

    def test_malformed_newest_snapshot_is_not_replaced_by_an_older_favorable_one(self):
        old, _ = self.f.upload_snapshot()
        advanced = copy.deepcopy(self.f.data)
        advanced["frontier"]["100"] = 3
        advanced["job_inventories"]["100/3"] = []
        newest, _ = self.f.upload_snapshot(data=advanced, settings=dict(self.f.settings, attempt=3, job_id="888"))
        self.f.api.blobs[f"repos/owner/repo/actions/artifacts/{newest['artifact_id']}/zip"] += b"changed"
        inventory = {str(item["id"]): item for item in self.f.q.artifacts}
        selected = recovery.latest_snapshot(inventory, self.f.data, dict(self.f.settings, attempt=4))
        self.assertEqual(selected, newest)
        with self.assertRaisesRegex(ValueError, "archive digest"):
            recovery.load(recovery.WorkflowAPI(self.f.api), selected, "owner/repo", self.f.contract)

    def test_plain_json_cannot_enter_runner_recovery_seam(self):
        recovered = recovery.recovered(self.f.data, dict(self.f.settings, attempt=3), include_current=False)
        with self.assertRaisesRegex(ValueError, "unverified or stale"):
            artifacts.checked_recovery(dict(recovered), self.f.q.manifest, run_id="100", attempt=3, include_current=False)
        with self.assertRaisesRegex(ValueError, "unverified or stale"):
            artifacts.checked_recovery(recovered, self.f.q.manifest, run_id="100", attempt=4, include_current=False)

    def test_sealed_predecessor_advancement_is_refused(self):
        data = copy.deepcopy(self.f.data)
        previous = dict(data["chain"]["runs"][0], sealed_attempt=2)
        current = dict(previous, run_id="200", predecessor="100")
        current.pop("sealed_attempt")
        data["chain"]["runs"] = [previous, current]
        self.f.api.responses["repos/owner/repo/actions/runs/200"] = dict(
            self.f.api.responses["repos/owner/repo/actions/runs/100"], id=200, run_attempt=1)
        self.f.api.responses["repos/owner/repo/actions/runs/200/artifacts?per_page=100&page=1"] = {"artifacts": []}
        with self.assertRaisesRegex(ValueError, "sealed predecessor advanced"):
            recovery.fresh_inventory(recovery.WorkflowAPI(self.f.api), data, dict(self.f.settings, run_id="200", attempt=1))

    def test_future_snapshot_frontier_cannot_hide_unseen_attempts(self):
        data = copy.deepcopy(self.f.data)
        data["frontier"]["100"] = 3
        reference, _ = self.f.upload_snapshot(data=data)
        with self.assertRaisesRegex(ValueError, "frontier includes future"):
            recovery.load(recovery.WorkflowAPI(self.f.api), reference, "owner/repo", self.f.contract)

    def test_terminal_failure_cannot_be_sealed_as_successful_preparation(self):
        recovered = recovery.recovered(self.f.data, dict(self.f.settings, attempt=3), include_current=False)
        recovered["bundles"].append({"receipt": {"slot": 0}, "status": {"state": "infrastructure_failure"}})
        scratch = Path(self.f.q.fixture.temp.name) / "terminal-preparation"
        scratch.mkdir()
        with mock.patch.object(workflow, "refresh_recovery", return_value=(self.f.data, recovered)), \
            mock.patch.object(recovery, "seal", return_value={"campaign_id": "fake"}), mock.patch.object(workflow, "output"):
            with self.assertRaisesRegex(ValueError, "terminal prior mutation failure"):
                workflow.prepare_recovery(self.f.api, self.f.root, dict(self.f.settings, attempt=3), scratch)

    def test_actual_job_token_budget_refuses_before_preparation_or_native_work(self):
        self.f.api.rate_status = lambda: {"resources": {"core": {"limit": 1000, "remaining": 799, "reset": 2_000_000_000}}}
        api = recovery.WorkflowAPI(self.f.api)
        with mock.patch.object(workflow, "refresh_recovery") as refresh:
            with self.assertRaisesRegex(runner.CapacityFailure, "REST budget is insufficient"):
                workflow.prepare_recovery(api, self.f.root, self.f.settings, self.f.root)
            refresh.assert_not_called()
        self.assertEqual(api.last_rate_observation["remaining"], 799)
        self.assertEqual(api.requests, 1)

    def test_snapshot_limits_reject_cycles_expansion_and_oversized_inventory(self):
        with self.assertRaisesRegex(ValueError, "cyclic"):
            recovery.decode(json.dumps({"version": 1, "root": 0, "nodes": [["l", [0]]]}).encode())
        nodes = [["v", "x"]]
        for index in range(1, 35):
            nodes.append(["l", [index - 1, index - 1]])
        with self.assertRaisesRegex(ValueError, "reconstruction capacity"):
            recovery.decode(json.dumps({"version": 1, "root": 34, "nodes": nodes}).encode())
        for page in range(1, recovery.MAX_PAGES + 1):
            self.f.api.responses[f"repos/owner/repo/actions/runs/100/artifacts?per_page=100&page={page}"] = {
                "artifacts": [{"id": page * 100 + index} for index in range(100)]}
        with self.assertRaisesRegex(runner.CapacityFailure, "page capacity"):
            recovery.artifact_inventory(self.f.api, "owner/repo", "100")


class FullWrapperBudgetTests(unittest.TestCase):
    def exercise(self, history, run_count=1, *, gap=0, padded=False, extra_sources=0, fixture=None, prior_history=51):
        f = fixture or SnapshotFixture(self)
        first_run = int(f.settings["run_id"])
        base_run = f.api.responses[f"repos/owner/repo/actions/runs/{first_run}"]
        scope = f.settings["scope"]
        prefix = "mutation-fixture" if scope == "fixture" else "mutation"
        chain = copy.deepcopy(f.data["chain"])
        for index in range(run_count):
            run_id = str(first_run + index * 100)
            attempts = history if index == run_count - 1 else prior_history
            if index:
                chain["runs"][-1]["sealed_attempt"] = prior_history
                chain["runs"].append(dict(chain["runs"][0], run_id=run_id, predecessor=str(first_run + (index - 1) * 100)))
                chain["runs"][-1].pop("sealed_attempt", None)
            f.api.responses[f"repos/owner/repo/actions/runs/{run_id}"] = dict(base_run, id=int(run_id), run_attempt=attempts + (index == run_count - 1))
            for attempt in range(f.data["frontier"][str(first_run)] + 1 if index == 0 else 1, attempts + 1):
                f.add_completed_history(run_id, attempt)
            f.data["source_runs"][run_id] = dict(chain["runs"][-1])
        f.data["chain"] = chain
        current_run = str(first_run + (run_count - 1) * 100)
        if gap:
            cutoff = history - gap
            removed = [item for item in f.data["bundles"] if item["bundle"]["receipt"]["run_id"] == current_run
                       and item["bundle"]["receipt"]["attempt"] > cutoff]
            f.data["bundles"] = [item for item in f.data["bundles"] if item not in removed]
            for item in removed:
                original = f.data["originals"].pop(str(item["artifact_id"]))
                f.data["logs"].pop(original["producer_log"])
            f.data["job_inventories"] = {key: jobs for key, jobs in f.data["job_inventories"].items()
                if not (key.split("/")[0] == current_run and int(key.split("/")[1]) > cutoff)}
            f.data["frontier"][current_run] = cutoff
        for index in range(extra_sources):
            run_id = str(1900 + index)
            f.api.responses[f"repos/owner/repo/actions/runs/{run_id}"] = dict(base_run, id=int(run_id), run_attempt=2)
            f.data["source_runs"][run_id] = dict(chain["runs"][0], run_id=run_id)
            artifact_id = 50_000_000 + index
            path = f"repos/owner/repo/actions/jobs/{artifact_id}/logs"
            raw = b"retained authenticated qualification-source log"
            f.data["logs"][path] = {"bytes": base64.b64encode(raw).decode(), "sha256": artifacts.sha(raw),
                "run_id": run_id, "attempt": 2, "job_id": str(artifact_id), "observed_at": f.q.now.isoformat(),
                "original_retention_days": 30, "expires_at": (f.q.now + dt.timedelta(days=29)).isoformat()}
            metadata = dict(f.q.fixture.artifact, id=artifact_id, name=f"qualification-source-{run_id}",
                digest="sha256:" + artifacts.sha(raw), workflow_run={"id": int(run_id), "head_sha": "d" * 40})
            f.q.artifacts.append(metadata)
            f.data["originals"][str(artifact_id)] = {"metadata": recovery.original_metadata(metadata), "producer_log": path}
        if padded:
            for entry in chain["runs"]:
                run_id = entry["run_id"]
                count = sum(str(item["workflow_run"]["id"]) == run_id for item in f.q.artifacts)
                for index in range(1580 - count):
                    f.q.artifacts.append({"id": 90_000_000 + int(run_id) * 10000 + index, "name": f"unrelated-{run_id}-{index}",
                                         "workflow_run": {"id": int(run_id)}})
        settings = dict(f.settings, run_id=current_run, attempt=history - gap, job_id="9999")
        f.upload_snapshot(settings=settings)
        # SnapshotFixture's original metadata defaults to run100; fix this transport reference for later runs.
        snapshot_meta = f.q.artifacts[-1]
        snapshot_meta["workflow_run"] = {"id": int(current_run), "head_sha": "d" * 40}
        f.paginate()
        source = Path(__file__).resolve().parents[2]
        (f.root / tool.WORKFLOW).parent.mkdir(parents=True, exist_ok=True)
        (f.root / tool.WORKFLOW).write_bytes((source / tool.WORKFLOW).read_bytes())
        current = history + 1
        current_jobs = f"repos/owner/repo/actions/runs/{current_run}/attempts/{current}/jobs?per_page=100&page=1"
        f.api.responses[current_jobs] = {"jobs": []}
        f.api.responses[f"repos/owner/repo/actions/runs/{current_run}/attempts/{current}"] = {
            "id": int(current_run), "run_attempt": current, "head_sha": "d" * 40}
        environment = {"GITHUB_REPOSITORY": "owner/repo", "GITHUB_RUN_ID": current_run,
            "GITHUB_RUN_ATTEMPT": str(current), "GITHUB_WORKFLOW_SHA": "e" * 40,
            "GITHUB_RETENTION_DAYS": "30", "ImageOS": "ubuntu24", "ImageVersion": "fixture-image",
            "MUTATION_CHAIN": json.dumps(chain), "PLAN_ARTIFACT_ID": str(chain["plan"]["artifact_id"])}
        context_value = f.q.manifest["context"]
        actual_consume = tool.consume_prepared
        def consume(*args, **kwargs):
            return actual_consume(*args, **kwargs, runtime=lambda *unused: f.q.fixture.runtime)
        counts = []
        def client(job_id, name):
            job = dict(f.q.fixture.job, id=job_id, run_id=int(current_run), run_attempt=current,
                       name=name, status="in_progress", conclusion=None)
            f.api.responses[current_jobs]["jobs"].append(job)
            api = recovery.WorkflowAPI(f.api)
            settings = workflow.current_settings(api, f.root, scope, name, 0)
            return api, settings, job
        with mock.patch.dict(os.environ, environment), contextlib.redirect_stdout(io.StringIO()), \
            mock.patch.object(tool, "committed_contract", return_value=f.contract), \
            mock.patch.object(tool, "consume_prepared", side_effect=consume), \
            mock.patch.object(runner, "checkout_inventory", return_value=(context_value["checkout"], {})), \
            mock.patch.object(runner, "validate_current_plan", return_value=context_value), \
            mock.patch.object(runner, "collect_context", return_value=(context_value, {}, [])), \
            mock.patch.object(runner, "execution_environment", return_value=({}, {})), \
            mock.patch.object(runner, "installed_tool", return_value={}), mock.patch.object(workflow, "output"):
            api, prepared_settings, job = client(90000, prefix + "-prepare")
            scratch = Path(f.q.fixture.temp.name) / "preparation-client"
            scratch.mkdir()
            workflow.prepare_recovery(api, f.root, prepared_settings, scratch)
            counts.append(api.requests)
            job.update(status="completed", conclusion="success")
            prepared_id = f.upload_directory(scratch / "prepared", prepared_settings, "prepared")
            # Replace the duplicate fixture upload record with the already completed job.
            f.api.responses[current_jobs]["jobs"].pop()
            os.environ["PREPARED_ARTIFACT_ID"] = str(prepared_id)
            for slot in range(8):
                api, worker_settings, job = client(90010 + slot, f"{prefix}-slot-{slot}")
                worker_settings["slot"] = slot
                scratch = Path(f.q.fixture.temp.name) / f"worker-{slot}"
                scratch.mkdir()
                self.assertEqual(workflow.execute(api, f.root, worker_settings, scratch, "slot"), 0)
                counts.append(api.requests)
                job.update(status="completed", conclusion="success")
                bundle = runner.read_json(scratch / "result/bundle.json")
                artifact_id = 90010 + slot
                raw = archive({path.relative_to(scratch / "result").as_posix(): path.read_bytes()
                               for path in (scratch / "result").rglob("*") if path.is_file()})
                metadata = dict(f.q.fixture.artifact, id=artifact_id,
                    name=artifacts.artifact_name(f.q.manifest["campaign_id"], current_run, current, slot),
                    digest="sha256:" + artifacts.sha(raw), workflow_run={"id": int(current_run), "head_sha": "d" * 40})
                f.q.artifacts.append(metadata)
                f.api.responses[f"repos/owner/repo/actions/artifacts/{artifact_id}"] = metadata
                f.api.blobs[f"repos/owner/repo/actions/artifacts/{artifact_id}/zip"] = raw
                f.api.blobs[f"repos/owner/repo/actions/jobs/{job['id']}/logs"] = (
                    "MUTATION_PRODUCER " + json.dumps(bundle["receipt"]) + f"\nMUTATION_ARTIFACT_ID={artifact_id}\n").encode()
            f.paginate()
            api, aggregate_settings, job = client(90030, "mutation-fixture-aggregate" if scope == "fixture" else "mutation-production-aggregate")
            scratch = Path(f.q.fixture.temp.name) / "aggregate-client"
            scratch.mkdir()
            self.assertEqual(workflow.execute(api, f.root, aggregate_settings, scratch, "aggregate"), 0)
            counts.append(api.requests)
        self.assertLessEqual(sum(counts), 800)
        return {"scope": scope, "historical_attempts_last_run": history, "run_count": run_count, "gap": gap,
                "padded_to_sixteen_pages": padded, "external_proof_runs": extra_sources,
                "preparation": counts[0], "workers": counts[1:9], "aggregate": counts[9], "total": sum(counts)}

    def test_complete_wrapper_request_budget_at_ten_thirty_fifty_and_eight_runs(self):
        results = []
        for history, run_count in ((10, 1), (30, 1), (50, 1), (50, 8)):
            with self.subTest(history=history, run_count=run_count):
                results.append(self.exercise(history, run_count))
        results.append(self.exercise(50, 8, gap=3, padded=True, extra_sources=2))
        if destination := os.environ.get("MUTATION_API_COST_REPORT"):
            Path(destination).write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")


class AggregateVerdictRegressionTests(unittest.TestCase):
    def setUp(self):
        self.f = SnapshotFixture(self)
        self.reference, _ = self.f.upload_snapshot()

    def aggregate_only(self, *, bad_predecessor):
        f = self.f
        f.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 4
        failed = dict(f.q.fixture.job, id=333, run_attempt=3, name="mutation-fixture-aggregate", conclusion="failure")
        current = dict(f.q.fixture.job, id=444, run_attempt=4, name="mutation-fixture-aggregate", status="in_progress", conclusion=None)
        f.api.responses["repos/owner/repo/actions/runs/100/attempts/3/jobs?per_page=100&page=1"] = {"jobs": [failed] if bad_predecessor else []}
        f.api.responses["repos/owner/repo/actions/runs/100/attempts/4/jobs?per_page=100&page=1"] = {"jobs": [current]}
        settings = dict(f.settings, attempt=4, job_id="444")
        api = recovery.WorkflowAPI(f.api)
        data, _ = recovery.load(api, self.reference, "owner/repo", f.contract)
        inventory, runs = recovery.fresh_inventory(api, data, settings, allow_current_aggregate=True)
        verified = recovery.ingest(api, data, settings, inventory, runs, include_current=True)
        with mock.patch.object(runner, "validate_current_plan", return_value=f.q.manifest["context"]):
            return runner.aggregate(f.root, data["planned"], data["chain"], settings,
                Path(f.q.fixture.temp.name) / f"aggregate-only-{bad_predecessor}.json", api, recovered=verified)

    def test_failed_historical_aggregate_without_snapshot_cannot_disappear(self):
        self.assertEqual(self.aggregate_only(bad_predecessor=False)["state"], "complete")
        with self.assertRaisesRegex(ValueError, "historical aggregate lacks authenticated verdict evidence"):
            self.aggregate_only(bad_predecessor=True)

    def test_authenticated_terminal_aggregate_cannot_be_laundered_through_another_snapshot(self):
        f = self.f
        data, _ = recovery.load(recovery.WorkflowAPI(f.api), self.reference, "owner/repo", f.contract)
        data["frontier"]["100"] = 3
        data["job_inventories"]["100/3"] = []
        bad_settings = dict(f.settings, attempt=3, job_id="333")
        reference, receipt = f.upload_snapshot(data=data, settings=bad_settings, state="infrastructure_failure")
        f.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 4
        with self.assertRaisesRegex(ValueError, "terminal historical aggregate verdict"):
            recovery.load(recovery.WorkflowAPI(f.api), reference, "owner/repo", f.contract)
        artifact = f.api.responses[f"repos/owner/repo/actions/artifacts/{reference['artifact_id']}"]
        files = artifacts.unpack(f.api.blobs[f"repos/owner/repo/actions/artifacts/{reference['artifact_id']}/zip"])
        decoded = recovery.decode(b"".join(files[chunk["name"]] for chunk in receipt["chunks"]))
        proof = artifacts.authenticate_producer(f.api, "owner/repo", tool.entry_from_receipt(receipt), artifact, receipt,
            now=dt.datetime.now(dt.timezone.utc), job_name="mutation-fixture-aggregate", marker="MUTATION_RECOVERY")
        recovery.retain_aggregate_verdict(decoded, receipt, proof, artifact, f.api.responses["repos/owner/repo/actions/runs/100"])
        decoded["frontier"]["100"] = 4
        decoded["job_inventories"]["100/4"] = []
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(ValueError, "terminal historical aggregate verdict"):
            recovery.seal(decoded, dict(f.settings, attempt=4, job_id="444"), "aggregate", {"state": "complete"},
                          Path(f.q.fixture.temp.name) / "laundered")

    def test_authenticated_allowed_incomplete_aggregate_permits_continuation(self):
        f = self.f
        partial = copy.deepcopy(f.data)
        partial["bundles"] = [item for item in partial["bundles"] if item["bundle"]["receipt"]["attempt"] == 1]
        for artifact_id in [str(1020 + slot) for slot in range(8)]:
            original = partial["originals"].pop(artifact_id)
            partial["logs"].pop(original["producer_log"])
        partial["frontier"]["100"] = 1
        partial["job_inventories"].pop("100/2")
        partial["phase_inventories"].pop("100/2")
        reference, _ = f.upload_snapshot(data=partial, settings=dict(f.settings, attempt=1, job_id="111"), state="incomplete_with_progress")
        restored, receipt = recovery.load(recovery.WorkflowAPI(f.api), reference, "owner/repo", f.contract)
        verified = recovery.recovered(restored, dict(f.settings, attempt=2), include_current=False)
        summary = model.summarize(f.q.manifest, verified["records"], [])
        state, _ = runner.continuation_status(summary, verified["bundles"], attempt=1)
        self.assertEqual(state, "incomplete_with_progress")
        self.assertEqual(len(summary["completed"]), 8)
        self.assertEqual(len(summary["remaining"]), 16)
        self.assertEqual(receipt["verdict"]["state"], "incomplete_with_progress")
        recovery.validate_retained(restored)
        # Exercise bounded tail ingestion too, using an older empty frontier.
        before = copy.deepcopy(partial)
        before.update(bundles=[], frontier={"100": 0}, job_inventories={}, phase_inventories={})
        for artifact_id in [str(1010 + slot) for slot in range(8)]:
            original = before["originals"].pop(artifact_id)
            before["logs"].pop(original["producer_log"])
        f.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 2
        jobs_path = "repos/owner/repo/actions/runs/100/attempts/2/jobs?per_page=100&page=1"
        f.api.responses[jobs_path]["jobs"] = [job for job in f.api.responses[jobs_path]["jobs"] if job["name"] != "mutation-fixture-aggregate"]
        f.api.responses[jobs_path]["jobs"].append(dict(f.q.fixture.job, id=222, run_attempt=2,
            name="mutation-fixture-aggregate", status="in_progress", conclusion=None))
        settings = dict(f.settings, attempt=2, job_id="222")
        api = recovery.WorkflowAPI(f.api)
        inventory, runs = recovery.fresh_inventory(api, before, settings, allow_current_aggregate=True)
        continued = recovery.ingest(api, before, settings, inventory, runs, include_current=True)
        self.assertEqual(len(continued["records"]), 24)
        self.assertEqual(before["aggregate_verdicts"]["111"]["receipt"]["verdict"]["state"], "incomplete_with_progress")
        with mock.patch.object(runner, "validate_current_plan", return_value=f.q.manifest["context"]):
            status = runner.aggregate(f.root, before["planned"], before["chain"], settings,
                Path(f.q.fixture.temp.name) / "allowed-incomplete-continuation.json", api, recovered=continued)
        self.assertEqual(status["state"], "complete")


class RecoveryFaultControls(unittest.TestCase):
    def test_isolated_snapshot_guard_removals_fail_named_assertions(self):
        controls = [(recovery, 'artifacts.sha(raw) == log["sha256"]', 'True',
                     'test_original_deletion_digest_change_expiry_and_log_corruption_remain_fatal'),
                    (recovery, 'item["digest"] == "sha256:" + artifacts.sha(raw), "snapshot archive digest mismatch"',
                     'True, "snapshot archive digest mismatch"',
                     'test_malformed_newest_snapshot_is_not_replaced_by_an_older_favorable_one'),
                    (workflow, 'state in {"complete", "incomplete_with_progress", "incomplete_without_progress"}', 'True',
                     'test_terminal_failure_cannot_be_sealed_as_successful_preparation')]
        for module, old, new, test in controls:
            source = Path(module.__file__)
            original = source.read_bytes()
            with self.subTest(test=test), tempfile.TemporaryDirectory() as temporary:
                text = original.decode()
                self.assertEqual(text.count(old), 1)
                Path(temporary, source.name).write_text(text.replace(old, new), encoding="utf-8")
                script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                    "sys.path.insert(0," + repr(temporary) + ");"
                    "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(" +
                    repr("test_mutation_recovery.RecoveryTests." + test) + "));"
                    "sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(source.read_bytes(), original)

    def test_historical_aggregate_gate_control_keeps_valid_case_and_rejects_bad_case(self):
        source = Path(recovery.__file__)
        original = source.read_bytes()
        old = "validate_aggregate_phase(data, key, job, pending_aggregate)"
        self.assertEqual(original.decode().count(old), 1)
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, source.name).write_text(original.decode().replace(old, "None"), encoding="utf-8")
            script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                "sys.path.insert(0," + repr(temporary) + ");"
                "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName("
                "'test_mutation_recovery.AggregateVerdictRegressionTests.test_failed_historical_aggregate_without_snapshot_cannot_disappear'));"
                "sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
            result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
