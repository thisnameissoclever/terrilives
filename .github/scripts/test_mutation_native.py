"""Native diagnostics are spending evidence and never production coverage."""

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
import mutation_native as native
import mutation_recovery as recovery
import mutation_runner as runner
import mutation_tool as tool
import mutation_workflow as workflow
import mutation_qualification as qualification
import test_mutation_recovery as recovery_tests
from test_mutation_artifacts import archive
import test_mutation_artifacts as artifact_tests
from test_mutation_campaign import context, inventory, raw_report
import test_mutation_tool as tool_tests
import test_mutation_qualification as qualification_tests


class NativeFixture:
    def __init__(self, owner, *, count=40, base=None):
        self.base = base or tool_tests.ToolAuthenticationTests()
        if base is None:
            self.base.setUp()
            owner.addCleanup(self.base.doCleanups)
        self.api, self.root = self.base.api, self.base.root
        self.now = self.base.now
        self.run_id = "300"
        self.run = dict(self.api.responses["repos/owner/repo/actions/runs/100"], id=300, run_attempt=3, event="pull_request")
        self.api.responses["repos/owner/repo/actions/runs/300"] = self.run
        self.items = inventory(count)
        for index, item in enumerate(self.items):
            package = runner.PACKAGES[index % 4]
            item.update(package=package, file=f"crates/{package}/src/lib.rs")
            item["function"]["function_name"] = f"sample_{index}"
            item["name"] = f"{item['file']}:{item['span']['start']['line']}:9: replace sample_{index} -> f32 with 0.0"
        self.items[0].update(package="terri-core", file="crates/terri-core/src/appearance.rs",
            name="crates/terri-core/src/appearance.rs:14:9: replace F32Bits::value -> f32 with 0.0")
        self.items[0]["function"]["function_name"] = "F32Bits::value"
        self.items[1].update(package="terri-core", file="crates/terri-core/src/rng.rs", genre="BinaryOperator", replacement="^",
            name="crates/terri-core/src/rng.rs:15:9: replace | with ^ in SimRng::from_seed")
        self.items[1]["function"]["function_name"] = "SimRng::from_seed"
        self.baseline = self.items[1]["name"] + "\n"
        ctx = context()
        ctx["checkout"] = copy.deepcopy(self.base.receipt["checkout"])
        ctx["run"]["run_id"] = self.run_id
        ctx["inputs"].update(computation_scope="production", workflow_file_digest=self.base.contract["files"][tool.WORKFLOW],
            generation_order=[item["name"] for item in self.items],
            survivor_baseline_file_digest=artifacts.sha(self.baseline.encode()),
            cargo_mutants_identity={"version": "27.1.0", "binary_sha256": self.base.reference["executable_sha256"],
                "authenticated_contract": {"recipe": self.base.contract, "runtime": self.base.runtime, "reference": self.base.reference}})
        self.calibration = {"build_seconds": 1, "test_seconds": 1, "test_cap_seconds": 120,
                            "cargo_mutants_identity": ctx["inputs"]["cargo_mutants_identity"]}
        ctx["inputs"]["calibration_digest"] = model.digest(self.calibration)
        self.manifest = model.build_manifest(self.items, ctx)
        started = self.now - dt.timedelta(hours=1)
        self.chain = {"version": 1, "max_attempts": 51, "retention_days": 30,
            "started_at": started.isoformat(), "expires_at": (started + dt.timedelta(days=7)).isoformat(),
            "plan": {"run_id": self.run_id, "attempt": 2, "artifact_id": 3000},
            "runs": [dict(tool.entry_from_receipt(self.base.receipt), run_id=self.run_id)]}
        producer = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "workflow_sha": "e" * 40,
            "run_id": self.run_id, "attempt": 2, "job_id": "3001", "slot": 0, "scope": "production",
            "checkout": ctx["checkout"], "input_fingerprint": self.manifest["input_fingerprint"],
            "campaign_id": self.manifest["campaign_id"], "log_retention_days": 30}
        self.plan_logs = {"calibration/build.log": b"complete original cold build log", "calibration/test.log": b"all workspace tests passed"}
        self.planned = {"version": 1, "manifest": self.manifest, "calibration": self.calibration, "producer": producer,
            "orchestration": {"contract": self.base.contract, "tool": self.base.reference,
                "qualification": {"artifact_id": 79, "archive_digest": "sha256:" + "a" * 64}, "chain": copy.deepcopy(self.chain), "log_retention_days": 30},
            "calibration_evidence": {name: {"size": len(raw), "sha256": artifacts.sha(raw)} for name, raw in self.plan_logs.items()}}
        self.settings = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "workflow_sha": "e" * 40,
            "head_sha": "d" * 40, "run_id": self.run_id, "attempt": 2, "job_id": "3002", "scope": "production", "slot": 0,
            "log_retention_days": 30, "runtime": self.base.image, "job_started_at": self.now.isoformat(),
            "build_cap_seconds": 600, "shutdown_seconds": 30, "validation_seconds": 120, "upload_seconds": 240}
        self.artifacts, self.jobs = [], {1: [], 2: [], 3: []}
        self.api.probe_job_logs = lambda repository, run_id, attempt, job_id: self.api.calls.append(f"PROBE repos/{repository}/actions/jobs/{job_id}/logs")
        (self.root / "docs").mkdir(exist_ok=True)
        (self.root / "docs/mutants-baseline.txt").write_bytes(self.baseline.encode())
        (self.root / tool.WORKFLOW).parent.mkdir(parents=True)
        (self.root / tool.WORKFLOW).write_bytes((Path(__file__).resolve().parents[2] / tool.WORKFLOW).read_bytes())
        self.publish_plan()
        self.next_id = 3100

    def publish_plan(self):
        raw = (json.dumps(self.planned, sort_keys=True, separators=(",", ":")) + "\n").encode()
        files = {"plan.json": raw, **self.plan_logs}
        self.add_archive(3000, artifacts.plan_artifact_name("production", self.run_id, 2), files,
            dict(self.planned["producer"], plan_digest=artifacts.sha(raw)), "MUTATION_PLAN", "mutation-plan", "success")

    def add_archive(self, artifact_id, name, files, receipt, marker, job_name, conclusion):
        raw = archive(files)
        item = dict(self.base.artifact, id=artifact_id, name=name, digest="sha256:" + artifacts.sha(raw), size_in_bytes=len(raw),
                    workflow_run={"id": int(self.run_id), "head_sha": "d" * 40})
        self.artifacts[:] = [existing for existing in self.artifacts if existing["id"] != artifact_id] + [item]
        self.api.responses[f"repos/owner/repo/actions/artifacts/{artifact_id}"] = item
        self.api.blobs[f"repos/owner/repo/actions/artifacts/{artifact_id}/zip"] = raw
        job = dict(self.base.job, id=int(receipt["job_id"]), run_id=int(self.run_id), run_attempt=receipt["attempt"],
            name=job_name, status="completed", conclusion=conclusion,
            steps=[{"name": native.UPLOADS[receipt["kind"]] if "kind" in receipt else "Upload immutable original plan",
                    "status": "completed", "conclusion": "success", "started_at": (self.now - dt.timedelta(minutes=21)).isoformat(),
                    "completed_at": (self.now - dt.timedelta(minutes=20)).isoformat()}])
        self.jobs[receipt["attempt"]] = [existing for existing in self.jobs[receipt["attempt"]] if existing["id"] != job["id"]] + [job]
        for attempt in (1, 2, 3):
            self.api.responses[f"repos/owner/repo/actions/runs/{self.run_id}/attempts/{attempt}"] = {
                "id": int(self.run_id), "run_attempt": attempt, "head_sha": "d" * 40}
            self.api.responses[f"repos/owner/repo/actions/runs/{self.run_id}/attempts/{attempt}/jobs?per_page=100&page=1"] = {"jobs": self.jobs[attempt]}
        self.api.responses[f"repos/owner/repo/actions/runs/{self.run_id}/artifacts?per_page=100&page=1"] = {"artifacts": self.artifacts}
        self.api.blobs[f"repos/owner/repo/actions/jobs/{job['id']}/logs"] = (
            marker + " " + json.dumps(receipt) + f"\nMUTATION_ARTIFACT_ID={artifact_id}\n").encode()
        return {"artifact_id": artifact_id, "archive_digest": item["digest"]}

    def publish(self, kind, payload, *, attempt=2, raw_files=None):
        artifact_id = self.next_id
        self.next_id += 1
        directory = Path(self.base.temp.name) / str(artifact_id)
        directory.mkdir()
        for name, raw in (raw_files or {}).items():
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        settings = dict(self.settings, attempt=attempt, job_id=str(artifact_id))
        with contextlib.redirect_stdout(io.StringIO()):
            receipt, _ = native.emit(directory, kind, payload, settings, self.planned, self.chain, self.manifest["context"]["checkout"])
        files = {path.relative_to(directory).as_posix(): path.read_bytes() for path in directory.rglob("*") if path.is_file()}
        selected = self.add_archive(artifact_id, native.artifact_name(kind, self.manifest["campaign_id"], self.run_id, attempt),
            files, receipt, native.MARKERS[kind], native.JOBS[kind], "success" if payload["state"] in ("complete", "admitted") else "failure")
        return native.authenticate(self.api, selected, kind, self.planned, self.chain, "owner/repo")

    def passing_pilot(self, *, phase_seconds=None):
        selected = native.select_samples(self.manifest, self.baseline.splitlines())
        selected_ids = {item["identity"]["id"] for item in selected["identities"]}
        by_name = {item["name"]: item for item in self.items}
        batches, files = [], {"baseline-policy.txt": self.baseline.encode()}
        for slot in sorted({item["logical_slot"] for item in selected["identities"]}):
            ids = [mid for mid in runner.ordered_remaining(self.manifest, [], slot) if mid in selected_ids]
            selected_items = [by_name[next(item["name"] for item in self.manifest["mutations"] if item["id"] == mid)] for mid in ids]
            report = raw_report(selected_items)
            if phase_seconds:
                for outcome in report["outcomes"]:
                    for phase in outcome["phase_results"]:
                        phase["duration"] = phase_seconds[phase["phase"]]
            raw = json.dumps(report).encode()
            provenance = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "run_id": self.run_id, "attempt": 2,
                "batch_id": model.digest(ids), "execution_id": f"diagnostic-{slot}", "checkout": self.manifest["context"]["checkout"],
                "input_fingerprint": self.manifest["input_fingerprint"]}
            delta = model.validate_report(self.manifest, slot, ids, report, provenance=provenance,
                raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(report)}, exit_kind="completed")
            files[f"batch-{slot}/frozen-outcomes.json"] = raw
            files[f"batch-{slot}/process.log"] = b"measured diagnostic process output"
            for relative, content in {"log/baseline.log": b"baseline", "log/mutant.log": b"mutant", "diff/mutant.diff": b"diff"}.items():
                files[f"batch-{slot}/mutants.out/{relative}"] = content
            batches.append({"logical_slot": slot, "physical_slot": 0, "batch_ids": ids, "delta": delta, "state": "complete"})
        records = native.validate_samples(self.planned, selected, batches, self.baseline.splitlines())
        metrics = {"clone_setup_seconds": [1], "source_validation_seconds": [.1], "process_start_seconds": [.1],
            "shutdown_seconds": [.1], "owned_cleanup_seconds": [.1], "authentication_setup_seconds": 1, "job_initial_setup_seconds": 1, "final_validation_seconds": 1}
        policy = native.choose_batch_policy(self.planned, self.chain, records, batches, files)
        forecasted = native.forecast(self.planned, self.chain, self.settings, records, metrics, batch_limit=policy["max_mutations"])
        policy["history_attempt_ceiling"] = forecasted["admitted_total_history_attempts"]
        size = {"diagnostic_sizing_only": True, "accepted_production_outcomes": 0, "mutation_count": len(self.items),
            "admitted_total_history_attempts": forecasted["admitted_total_history_attempts"],
            "logical_bytes": 100000, "expanded_chunk_bytes": 50000, "compressed_bytes": 20000, "maximum_member_bytes": 50000,
            "raw_bundle_member_bytes": policy["projection"]["fixed_and_aggregate_members"]["bundle.json"],
            "raw_member_projection_bytes": policy["projection"]["maximum_member_bytes"],
            "raw_archive_projection_bytes": policy["projection"]["expanded_bytes"], "admitted_bound_fraction": .8,
            "batch_policy_digest": model.digest(policy)}
        payload = {"state": "complete", "selection": selected, "batches": batches,
            "batch_policy": policy, "batch_policy_digest": model.digest(policy),
            "shutdown_probe": {"reason": "controller_deadline", "accepted_production_outcomes": 0},
            "measurements": metrics, "forecast": forecasted, "sizing": size,
            "reserves": {"shutdown_seconds": 30, "validation_seconds": 120, "upload_seconds": 240}, "full_manifest_unchanged": True}
        return self.publish("pilot", payload, raw_files=files)


class NativeAuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.f = NativeFixture(self)

    def admitted_proofs(self):
        f = self.f
        pilot = f.passing_pilot()
        report = f.publish("report", native.finished_report(pilot, f.planned))
        review = f.publish("admission", native.admission_decision(f.settings, f.planned, f.chain, report, pilot, [pilot, report]))
        self.assertEqual(review["payload"]["state"], native.REVIEW_REQUIRED)
        admitted = f.publish("admission", native.admission_decision(dict(f.settings, attempt=3), f.planned, f.chain,
            report, pilot, [pilot, report, review]), attempt=3)
        return pilot, report, review, admitted

    def test_authenticated_same_attempt_requires_review_and_later_exact_transition_admits(self):
        pilot, report, review, admitted = self.admitted_proofs()
        self.assertEqual(admitted["payload"]["state"], "admitted")
        self.assertEqual(admitted["payload"]["review_reference"], review["reference"])
        restored = native.load_admission(self.f.api, admitted["reference"], self.f.planned, self.f.chain, "owner/repo")
        self.assertEqual({item["reference"]["artifact_id"] for item in restored},
                         {item["reference"]["artifact_id"] for item in (pilot, report, review, admitted)})

    def test_later_attempt_without_expected_review_is_not_admission(self):
        f = self.f
        pilot = f.passing_pilot()
        report = f.publish("report", native.finished_report(pilot, f.planned))
        with self.assertRaisesRegex(ValueError, "expected review-required"):
            native.admission_decision(dict(f.settings, attempt=3), f.planned, f.chain, report, pilot, [pilot, report])

    def test_different_previous_verdict_is_not_the_review_boundary(self):
        f = self.f
        pilot = f.passing_pilot()
        report = f.publish("report", native.finished_report(pilot, f.planned))
        payload = native.admission_decision(f.settings, f.planned, f.chain, report, pilot, [pilot, report])
        payload["state"] = "capacity_failure"
        terminal = f.publish("admission", payload)
        with self.assertRaisesRegex(ValueError, "expected review-required"):
            native.admission_decision(dict(f.settings, attempt=3), f.planned, f.chain, report, pilot, [pilot, report, terminal])
        with self.assertRaisesRegex(ValueError, "terminal native decision"):
            native.initial_history(f.api, dict(f.settings, attempt=3, job_id="4000"), f.planned, f.chain,
                f.artifacts, current_kind="admission")

    def test_metadata_admission_rechecks_current_inputs_and_runtime(self):
        f = self.f
        f.calibration.update(inventory_digest=model.digest({}), environment={}, toolchain={"rustc": "pinned rustc", "cargo": "pinned cargo"})
        f.manifest["context"]["inputs"]["timeout_policy"]["build_seconds"] = 600
        with mock.patch.object(runner, "checkout_inventory", return_value=(f.manifest["context"]["checkout"], {})), \
            mock.patch.object(runner, "execution_environment", return_value=({}, {})), \
            mock.patch.object(runner, "installed_tool", return_value=f.calibration["cargo_mutants_identity"]), \
            mock.patch.object(runner, "command", side_effect=lambda argv, *args: "pinned " + argv[0]):
            native.current_binding(f.root, f.settings, f.planned)
            with mock.patch.object(runner, "checkout_inventory", return_value=({}, {"changed": "source"})):
                with self.assertRaisesRegex(ValueError, "current source or runtime changed"):
                    native.current_binding(f.root, f.settings, f.planned)
            with mock.patch.object(runner, "command", return_value="host default differs"):
                with self.assertRaisesRegex(ValueError, "current source or runtime changed"):
                    native.current_binding(f.root, f.settings, f.planned)

    def test_raw_native_records_never_validate_as_production_delta(self):
        pilot = self.f.passing_pilot()
        with self.assertRaisesRegex(ValueError, "missing delta bundle"):
            artifacts.validate_bundle(pilot["files"], self.f.manifest, self.f.chain["runs"][0], pilot["artifact"],
                repository="owner/repo", workflow=tool.WORKFLOW)
        self.assertEqual(pilot["payload"]["accepted_production_outcomes"], 0)

    def test_actual_upload_step_and_original_reserve_are_enforced(self):
        f = self.f
        pilot = f.passing_pilot()
        self.assertEqual(native.upload_measurement(pilot)["upload_seconds"], 60)
        changed = copy.deepcopy(pilot)
        changed["job"]["steps"][0]["completed_at"] = (self.f.now - dt.timedelta(minutes=10)).isoformat()
        with self.assertRaisesRegex(ValueError, "upload exceeds original reserve"):
            native.finished_report(changed, f.planned)
        changed["job"]["steps"] = []
        with self.assertRaisesRegex(ValueError, "authenticated completed step"):
            native.upload_measurement(changed)

    def test_raw_diagnostic_logs_and_diffs_are_required(self):
        pilot = self.f.passing_pilot()
        native.validate_pilot(pilot, self.f.planned)
        name = next(name for name in pilot["files"] if name.endswith("mutant.log"))
        del pilot["files"][name]
        with self.assertRaisesRegex(ValueError, "lost referenced log or diff"):
            native.validate_pilot(pilot, self.f.planned)

    def test_caught_control_cannot_become_unviable_timeout_or_new_survivor(self):
        pilot = self.f.passing_pilot()
        selection = pilot["payload"]["selection"]
        for summary in ("Unviable", "Timeout", "MissedMutant"):
            batches = copy.deepcopy(pilot["payload"]["batches"])
            batch = next(batch for batch in batches if selection["control_id"] in batch["batch_ids"])
            by_id = {item["id"]: item for item in self.f.manifest["mutations"]}
            by_name = {item["name"]: item for item in self.f.items}
            selected = [by_name[by_id[mid]["name"]] for mid in batch["batch_ids"]]
            summaries = [summary if mid == selection["control_id"] else "CaughtMutant" for mid in batch["batch_ids"]]
            report = raw_report(selected, summaries)
            raw = json.dumps(report).encode()
            batch["delta"] = model.validate_report(self.f.manifest, batch["logical_slot"], batch["batch_ids"], report,
                provenance=batch["delta"]["provenance"], raw_report_ref={"path": "raw/outcomes.json",
                "digest": artifacts.sha(raw), "content_digest": model.digest(report)}, exit_kind="completed")
            with self.subTest(summary=summary), self.assertRaisesRegex(ValueError, "caught control|timeout or unaccepted survivor"):
                native.validate_samples(self.f.planned, selection, batches, self.f.baseline.splitlines())

    def test_native_source_tool_reference_and_expiry_cannot_be_substituted(self):
        pilot = self.f.passing_pilot()
        changed = copy.deepcopy(self.f.planned)
        changed["orchestration"]["tool"]["executable_sha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "contract mismatch"):
            native.authenticate(self.f.api, pilot["reference"], "pilot", changed, self.f.chain, "owner/repo")
        self.f.api.responses[f"repos/owner/repo/actions/artifacts/{pilot['reference']['artifact_id']}"]["expired"] = True
        with self.assertRaisesRegex(ValueError, "artifact retention"):
            native.authenticate(self.f.api, pilot["reference"], "pilot", self.f.planned, self.f.chain, "owner/repo")

    def test_started_failed_native_decision_without_artifact_cannot_disappear(self):
        f = self.f
        failed = dict(f.base.job, id=3999, run_id=300, run_attempt=2, name=native.JOBS["pilot"], conclusion="failure")
        f.jobs[2].append(failed)
        settings = dict(f.settings, attempt=3, job_id="4000")
        with self.assertRaisesRegex(ValueError, "lacks immutable evidence"):
            native.initial_history(f.api, settings, f.planned, f.chain, f.artifacts, current_kind="pilot")

    def test_snapshot_admission_binding_and_total_history_ceiling_are_mandatory(self):
        proofs = self.admitted_proofs()
        data = {"planned": self.f.planned, "chain": self.f.chain, "logs": {}, "originals": {}, "source_runs": {}}
        with self.assertRaisesRegex(ValueError, "lacks exact native admission"):
            native.validate_admitted(data, dict(self.f.settings, attempt=3))
        native.install_admission(data, proofs)
        native.validate_admitted(data, dict(self.f.settings, attempt=3))
        with self.assertRaisesRegex(runner.CapacityFailure, "history ceiling exhausted"):
            native.validate_admitted(data, dict(self.f.settings, attempt=data["native_admission"]["admitted_total_history_attempts"] + 1))
        data["native_admission"]["proofs"][str(proofs[-1]["reference"]["artifact_id"])]["payload"]["state"] = native.REVIEW_REQUIRED
        with self.assertRaisesRegex(ValueError, "successful decision"):
            native.validate_admitted(data, self.f.settings)


class NativeTransportTests(unittest.TestCase):
    def test_complete_original_plan_crosses_real_archive_boundary_only_when_compact(self):
        f = NativeFixture(self)
        f.planned["transport_shape"] = [{"a": {"b": {"c": index, "value": "all content retained"}}} for index in range(300)]
        pretty = (json.dumps(f.planned, indent=2, sort_keys=True) + "\n").encode()
        compact = (json.dumps(f.planned, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        cap = (len(pretty) + len(compact)) // 2
        kwargs = {"current_run_id": "300", "current_attempt": 3, "repository": "owner/repo", "workflow": tool.WORKFLOW,
                  "workflow_digest": f.base.contract["files"][tool.WORKFLOW], "scope": "production"}
        def publish(raw):
            f.add_archive(3000, artifacts.plan_artifact_name("production", "300", 2), {"plan.json": raw, **f.plan_logs},
                dict(f.planned["producer"], plan_digest=artifacts.sha(raw)), "MUTATION_PLAN", "mutation-plan", "success")
        with mock.patch.object(artifacts, "MAX_MEMBER", cap):
            publish(pretty)
            with self.assertRaisesRegex(ValueError, "oversized archive member"):
                artifacts.recover_plan(f.api, f.chain, **kwargs)
            destination = Path(f.base.temp.name) / "complete-plan.json"
            destination.write_bytes(pretty)
            native.compact_json(destination)
            self.assertLessEqual(destination.stat().st_size, cap)
            publish(destination.read_bytes())
            restored = artifacts.recover_plan(f.api, f.chain, **kwargs)
            self.assertEqual(restored, f.planned)
            self.assertEqual(len(restored["manifest"]["mutations"]), len(f.items))
            native.validate_plan_files(artifacts.unpack(f.api.blobs["repos/owner/repo/actions/artifacts/3000/zip"]), restored)

    def test_complete_bundle_and_receipt_survive_compaction_without_touching_raw_evidence(self):
        f = artifact_tests.ArtifactTests()
        f.setUp()
        f.bundle["transport_shape"] = [{"a": {"b": {"c": index}}} for index in range(300)]
        pretty = (json.dumps(f.bundle, indent=2, sort_keys=True) + "\n").encode()
        compact = (json.dumps(f.bundle, sort_keys=True, separators=(",", ":")) + "\n").encode()
        cap = (len(pretty) + len(compact)) // 2
        original_raw = {key: value for key, value in f.files.items() if key != "bundle.json"}
        def publish(raw):
            f.files["bundle.json"] = raw
            body = archive(f.files)
            f.metadata["digest"] = "sha256:" + artifacts.sha(body)
            f.api.blobs["repos/owner/repo/actions/artifacts/77/zip"] = body
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(artifacts, "MAX_MEMBER", cap):
            publish(pretty)
            with self.assertRaisesRegex(ValueError, "oversized archive member"):
                f.recover()
            destination = Path(temporary) / "bundle.json"
            destination.write_bytes(pretty)
            native.compact_json(destination)
            publish(destination.read_bytes())
            restored = f.recover()["bundles"][0]
            self.assertEqual(restored, f.bundle)
            self.assertEqual(restored["receipt"], f.receipt)
            self.assertEqual({key: value for key, value in f.files.items() if key != "bundle.json"}, original_raw)

    def test_original_calibration_logs_reject_missing_changed_extra_or_oversized_members(self):
        f = NativeFixture(self)
        files = {"plan.json": b"plan", **f.plan_logs}
        native.validate_plan_files(files, f.planned)
        for changed in ({"plan.json": b"plan", "calibration/build.log": f.plan_logs["calibration/build.log"]},
                        dict(files, **{"calibration/test.log": b"changed"}), dict(files, extra=b"unexpected")):
            with self.subTest(members=list(changed)), self.assertRaises(ValueError):
                native.validate_plan_files(changed, f.planned)
        with mock.patch.object(artifacts, "MAX_MEMBER", 1), self.assertRaisesRegex(ValueError, "calibration log changed"):
            native.validate_plan_files(files, f.planned)

    def test_failure_exit_still_compacts_existing_bundle_without_changing_the_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "source"
            root.mkdir()
            temp = Path(temporary) / "runner"
            temp.mkdir()
            path = temp / "mutation-job/result/bundle.json"
            payload = {"receipt": {"job": "failed"}, "nested": [{"value": index} for index in range(50)]}
            def failed(*args):
                path.parent.mkdir(parents=True)
                runner.write_json(path, payload)
                raise ValueError("failing current validation remains failed")
            with mock.patch.dict(os.environ, {"RUNNER_TEMP": str(temp), "MUTATION_JOB_NAME": "mutation-slot-0"}), \
                mock.patch.object(workflow, "current_settings", return_value={}), mock.patch.object(runner, "bound_setup"), \
                mock.patch.object(workflow, "execute", side_effect=failed), mock.patch.object(workflow, "output"), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(workflow.main(["slot", "--root", str(root), "--scope", "production"]), 22)
            self.assertEqual(artifacts.strict_json(path.read_bytes()), payload)
            self.assertEqual(path.read_text(), json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")


    def test_oversized_bundle_never_enables_workflow_upload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, temp = Path(temporary) / "source", Path(temporary) / "runner"
            root.mkdir()
            temp.mkdir()
            outputs = []
            def completed(*args):
                runner.write_json(temp / "mutation-job/result/bundle.json", {"complete_payload": "x" * 1000})
                return 0
            with mock.patch.dict(os.environ, {"RUNNER_TEMP": str(temp), "MUTATION_JOB_NAME": "mutation-slot-0"}), \
                mock.patch.object(workflow, "current_settings", return_value={}), mock.patch.object(runner, "bound_setup"), \
                mock.patch.object(workflow, "execute", side_effect=completed), mock.patch.object(workflow, "output", side_effect=lambda *args: outputs.append(args)), \
                mock.patch.object(artifacts, "MAX_MEMBER", 100):
                with self.assertRaisesRegex(runner.CapacityFailure, "unchanged member bound"):
                    workflow.main(["slot", "--root", str(root), "--scope", "production"])
            self.assertNotIn(("bundle_ready", "true"), outputs)
            self.assertEqual(runner.read_json(temp / "mutation-job/result/bundle.json")["complete_payload"], "x" * 1000)


class NativeSkippedHistoryTests(unittest.TestCase):
    def test_timestamped_skips_are_not_execution_but_upload_contradictions_fail(self):
        from test_mutation_recovery import SnapshotFixture
        f = SnapshotFixture(self)
        f.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 3
        jobs = [dict(f.q.fixture.job, id=800 + index, run_attempt=3, name=name, conclusion="skipped")
                for index, name in enumerate(("mutation-fixture-prepare", "mutation-fixture-aggregate", *native.JOBS.values()))]
        f.api.responses["repos/owner/repo/actions/runs/100/attempts/3/jobs?per_page=100&page=1"] = {"jobs": jobs}
        settings = dict(f.settings, attempt=3)
        api = recovery.WorkflowAPI(f.api)
        inventory, runs = recovery.fresh_inventory(api, f.data, settings)
        restored = recovery.ingest(api, copy.deepcopy(f.data), settings, inventory, runs, include_current=True)
        self.assertEqual(len(restored["records"]), 24)
        for kind, name in (("prepared", "mutation-fixture-prepare"), ("aggregate", "mutation-fixture-aggregate")):
            contradicted = dict(inventory, contradiction={"name": recovery.artifact_name("fixture", f.q.manifest["campaign_id"], kind, "100", 3)})
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "skipped decision phase has executed"):
                recovery.ingest(api, copy.deepcopy(f.data), settings, contradicted, runs, include_current=True)


class NativeExecutionTests(unittest.TestCase):
    def exercise(self, *, interrupt=False, drift=False, selection_drift=False):
        f = NativeFixture(self)
        directory = Path(f.base.temp.name) / "owned"
        directory.mkdir()
        source = directory / "source"
        source.mkdir()
        for item in f.items:
            path = source / item["file"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((b"        " + b"x" * 80 + b"\n") * 100)
        (source / "Cargo.lock").write_bytes(b"version = 4\n")
        env = runner.owned_environment(dict(os.environ), directory)
        slot = f.manifest["mutations"][0]["slot"]
        ids = runner.ordered_remaining(f.manifest, [], slot)[:2]
        by_name = {item["name"]: item for item in f.items}
        selected = [by_name[next(item["name"] for item in f.manifest["mutations"] if item["id"] == mid)] for mid in ids]
        tool_value = dict(f.calibration["cargo_mutants_identity"], executable=str(Path(sys.executable).resolve()),
            binary_sha256=artifacts.sha(Path(sys.executable).read_bytes()))
        f.planned["calibration"]["cargo_mutants_identity"] = runner.tool_identity(tool_value)
        metrics = {"source_validation_seconds": [], "process_start_seconds": [], "shutdown_seconds": []}
        initial = raw_report(selected[:1] if interrupt else selected, interrupted=interrupt)
        final = raw_report(selected)
        captures = []
        observed = native.process_observer(metrics)
        class FixtureProcess(observed):
            def __init__(self, argv, **kwargs):
                captures.append(argv)
                report = Path(argv[argv.index("--output") + 1]) / "mutants.out"
                script = ("import pathlib,signal,sys,time; p=pathlib.Path(" + repr(str(report)) + "); p.mkdir();"
                    "(p/'outcomes.json').write_text(" + repr(json.dumps(initial)) + ");"
                    "(p/'log').mkdir();(p/'diff').mkdir();"
                    "(p/'log/baseline.log').write_text('baseline');(p/'log/mutant.log').write_text('mutant');"
                    "(p/'diff/mutant.diff').write_text('diff');")
                if drift:
                    script += "pathlib.Path('Cargo.lock').write_text('changed compiled input');"
                if interrupt:
                    script += ("exec(" + repr("def stop(*args):\n (p/'outcomes.json').write_text(" + repr(json.dumps(final)) + ")\n sys.exit(101)\n") + ");"
                        "signal.signal(signal.SIGBREAK if sys.platform=='win32' else signal.SIGTERM,stop);time.sleep(30)")
                super().__init__([sys.executable, "-B", "-c", script], **kwargs)
        with mock.patch.object(runner, "installed_tool", return_value=tool_value), \
            mock.patch.object(runner, "command", return_value=json.dumps(selected[1:] if selection_drift else selected)), \
            mock.patch.object(native, "process_observer", return_value=FixtureProcess):
            result = native.diagnostic_batch(f.root, f.settings, f.planned, directory, source, env, slot, ids,
                directory / "retained", metrics, interrupt=interrupt)
        self.assertEqual(len(f.planned["manifest"]["mutations"]), 40)
        argv = captures[0]
        for expected in ("--cargo-arg=--workspace", "--cargo-arg=--locked", "--in-place", "--no-shuffle"):
            self.assertIn(expected, argv)
        self.assertEqual(argv[argv.index("--build-timeout") + 1], "600")
        self.assertEqual(argv[argv.index("--timeout") + 1], "120")
        self.assertTrue(metrics["source_validation_seconds"])
        self.assertTrue(metrics["shutdown_seconds"])
        return result

    def test_owned_diagnostic_directory_cleanup_is_measured(self):
        f = NativeFixture(self)
        f.planned["manifest"]["context"]["inputs"]["input_inventory"] = {}
        metrics = {"clone_setup_seconds": []}
        def command(argv, *args):
            if argv[1] == "clone":
                Path(argv[-1]).mkdir()
            return ""
        with mock.patch.object(runner, "command", side_effect=command), \
            mock.patch.object(runner, "checkout_inventory", return_value=({}, {})), \
            mock.patch.object(runner, "execution_environment", return_value=(dict(os.environ), {})):
            with native.owned_native(f.root, f.settings, f.planned, metrics) as (directory, source, env):
                self.assertTrue(source.is_dir())
                (directory / "target/owned.tmp").write_bytes(b"only this diagnostic owns these bytes")
            self.assertFalse(directory.exists())
            self.assertEqual(len(metrics["owned_cleanup_seconds"]), 1)
            self.assertGreaterEqual(metrics["owned_cleanup_seconds"][0], 0)

    def test_real_process_uses_full_manifest_and_exact_production_argv(self):
        result = self.exercise()
        self.assertEqual(result["state"], "complete")
        self.assertEqual(result["physical_slot"], 0)
        self.assertEqual(len(result["delta"]["records"]), 2)

    def test_real_process_source_drift_and_selector_drift_stop_diagnostics(self):
        with self.assertRaisesRegex(native.NativeFailure, "infrastructure_failure/owned_inputs_changed"):
            self.exercise(drift=True)
        with self.assertRaisesRegex(ValueError, "tool selection differs from requested batch"):
            self.exercise(selection_drift=True)

    def test_real_shutdown_probe_excludes_post_signal_terminal_records(self):
        result = self.exercise(interrupt=True)
        self.assertEqual(result["reason"], "controller_deadline")
        self.assertEqual(result["accepted_production_outcomes"], 0)
        self.assertEqual(result["ignored_terminal_records"], 1)


class NativeSnapshotFixture(recovery_tests.SnapshotFixture):
    def __init__(self, owner):
        self.q = qualification_tests.QualificationAuthenticationTests()
        self.q.setUp()
        owner.addCleanup(self.q.doCleanups)
        self.native = n = NativeFixture(owner, count=1600, base=self.q.fixture)
        self.api, self.root, self.contract = n.api, n.root, n.base.contract
        recorder = recovery.RecordingAPI(recovery.WorkflowAPI(self.api))
        proof = qualification.verify(recorder, "owner/repo", 79, self.contract, self.q.fixture.required)
        n.planned["orchestration"]["qualification"] = {"artifact_id": 79,
            "archive_digest": self.api.responses["repos/owner/repo/actions/artifacts/79"]["digest"]}
        n.publish_plan()
        self.plan = n.planned
        self.data = {"version": 1, "planned": self.plan, "chain": n.chain, "contract": self.contract,
            "originals": {}, "logs": {}, "source_runs": {}, "bundles": [], "frontier": {"300": 3},
            "job_inventories": {}, "phase_inventories": {}, "current_checkout": n.manifest["context"]["checkout"],
            "qualification": proof, "tool_receipt": n.base.receipt}
        recovery.retain_recording(recorder, self.data)
        artifacts.recover_plan(recorder, n.chain, current_run_id="300", current_attempt=3, repository="owner/repo",
            workflow=tool.WORKFLOW, workflow_digest=self.contract["files"][tool.WORKFLOW], scope="production")
        recovery.retain_recording(recorder, self.data)
        pilot = n.passing_pilot(phase_seconds={"Build": 600, "Test": 120})
        report = n.publish("report", native.finished_report(pilot, n.planned))
        review = n.publish("admission", native.admission_decision(n.settings, n.planned, n.chain, report, pilot, [pilot, report]))
        admitted = n.publish("admission", native.admission_decision(dict(n.settings, attempt=3), n.planned, n.chain,
            report, pilot, [pilot, report, review]), attempt=3)
        native.install_admission(self.data, native.load_admission(self.api, admitted["reference"], n.planned, n.chain, "owner/repo"))
        self.settings = dict(n.settings, attempt=3, job_id="3999", survivor_baseline=str(n.root / "docs/mutants-baseline.txt"),
            opt_level=2, cargo_jobs=2)
        by_name = {item["name"]: item for item in n.items}
        for slot in range(8):
            ids = runner.ordered_remaining(n.manifest, [], slot)
            by_id = {item["id"]: item for item in n.manifest["mutations"]}
            selected = [by_name[by_id[mid]["name"]] for mid in ids]
            report = raw_report(selected)
            raw = json.dumps(report).encode()
            provenance = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "run_id": "300", "attempt": 3,
                "batch_id": model.digest(ids), "execution_id": f"execution-{slot}",
                "checkout": n.manifest["context"]["checkout"], "input_fingerprint": n.manifest["input_fingerprint"]}
            delta = model.validate_report(n.manifest, slot, ids, report, provenance=provenance,
                raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(report)}, exit_kind="completed")
            receipt = dict(provenance, workflow_sha="e" * 40, job_id=str(4000 + slot), slot=slot,
                campaign_id=n.manifest["campaign_id"], log_retention_days=30,
                batch_policy_digest=self.data["native_admission"]["batch_policy_digest"])
            compact = {"version": 1, "receipt": receipt, "delta": delta,
                "status": {"state": "complete", "reason": "exact_coverage", "recorded_at": n.base.artifact["created_at"]}}
            files = {"bundle.json": json.dumps(dict(compact, manifest=n.manifest)).encode(), "raw/outcomes.json": raw,
                "evidence/log/baseline.log": b"baseline", "evidence/log/mutant.log": b"mutant", "evidence/diff/mutant.diff": b"diff"}
            n.add_archive(4000 + slot, artifacts.artifact_name(n.manifest["campaign_id"], "300", 3, slot), files,
                receipt, "MUTATION_PRODUCER", f"mutation-slot-{slot}", "success")
        recorder = recovery.RecordingAPI(recovery.WorkflowAPI(self.api))
        recovered = artifacts.recover(recorder, n.manifest, n.chain, current_run_id="300", current_attempt=3, include_current=True)
        for bundle in recovered["bundles"]:
            compact = {key: value for key, value in bundle.items() if key != "manifest"}
            self.data["bundles"].append({"artifact_id": int(bundle["receipt"]["job_id"]), "bundle": compact, "bundle_digest": model.digest(compact)})
        recovery.retain_recording(recorder, self.data)
        for attempt in (1, 2, 3):
            self.data["job_inventories"][f"300/{attempt}"] = [job for job in n.jobs[attempt] if "slot-" in job["name"]]
            self.data["phase_inventories"][f"300/{attempt}"] = [job for job in n.jobs[attempt] if job["name"] in native.JOBS.values()]
        self.q.manifest = n.manifest
        self.q.artifacts.extend(n.artifacts)
        self.next_id = 10000
        self.paginate()


# These component bounds cover the measured shared/distinct-root fixtures below.
# The additional runtime recipe subtree costs one request per independent API cache.
# Broader valid histories remain subject to WorkflowAPI's unchanged capacity guard.
REQUEST_COMPONENT_BOUNDS = {"worker": 22, "aggregate": 204, "measurement": 141}


def checked_request_components(test, consumers=None, measurement=None):
    if consumers is not None:
        test.assertLessEqual(max(consumers["workers"]), REQUEST_COMPONENT_BOUNDS["worker"], "worker request bound exceeded")
        test.assertLessEqual(consumers["aggregate"], REQUEST_COMPONENT_BOUNDS["aggregate"], "aggregate request bound exceeded")
    if measurement is not None:
        test.assertLessEqual(measurement, REQUEST_COMPONENT_BOUNDS["measurement"], "measurement request bound exceeded")
    return 8 * REQUEST_COMPONENT_BOUNDS["worker"] + REQUEST_COMPONENT_BOUNDS["aggregate"]


class NativeWrapperBudgetTests(unittest.TestCase):
    def test_complete_production_wrapper_with_retained_native_admission(self):
        results = []
        for history, runs, prior, gap, padded in ((10, 1, 51, 0, False), (30, 1, 51, 0, False),
                (50, 1, 51, 0, False), (6, 8, 6, 3, True)):
            with self.subTest(history=history, runs=runs):
                fixture = NativeSnapshotFixture(self)
                result = recovery_tests.FullWrapperBudgetTests.exercise(self, history, runs, fixture=fixture,
                    prior_history=prior, gap=gap, padded=padded, extra_sources=1 if padded else 0)
                checked_request_components(self, result)
                result["admitted_total_history_attempts"] = fixture.data["native_admission"]["admitted_total_history_attempts"]
                results.append(result)
        if destination := os.environ.get("MUTATION_NATIVE_API_COST_REPORT"):
            Path(destination).write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")

    def test_distinct_workflow_checkout_and_snapshot_roots_keep_complete_consumer_budget(self):
        fixture = NativeSnapshotFixture(self)
        tool_tests.recipe_revision(fixture.api, fixture.contract, "e" * 40,
            ("4" * 40, "5" * 40, "6" * 40, "7" * 40))
        tool_tests.recipe_revision(fixture.api, fixture.contract, "8" * 40,
            ("9" * 40, "a" * 40, "6" * 40, "7" * 40))
        fixture.data["current_checkout"] = dict(fixture.data["current_checkout"], commit="8" * 40, tree="9" * 40)
        fixture.api.calls.clear()
        result = recovery_tests.FullWrapperBudgetTests.exercise(self, 6, 8, fixture=fixture,
            prior_history=6, gap=3, padded=True, extra_sources=1)
        checked_request_components(self, result)
        self.assertEqual(result["workers"], [22] * 8)
        self.assertIn("repos/owner/repo/git/commits/" + "8" * 40, fixture.api.calls)
        tree_calls = [path for path in fixture.api.calls if "/git/trees/" in path]
        self.assertTrue(all("?" not in path for path in tree_calls))
        self.assertEqual({path.rsplit("/", 1)[-1] for path in tree_calls},
            {character * 40 for character in "c123456789a"} | {tool_tests.AUTHORIZATION_TREE})
        result["distinct_recipe_root_count"] = 3
        result["shared_subtree_count"] = 4
        result["admitted_total_history_attempts"] = fixture.data["native_admission"]["admitted_total_history_attempts"]
        if destination := os.environ.get("MUTATION_DISTINCT_ROOT_API_COST_REPORT"):
            Path(destination).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    def test_composed_budget_refuses_a_measured_component_above_its_bound(self):
        consumers = {"workers": [REQUEST_COMPONENT_BOUNDS["worker"]] * 8,
                     "aggregate": REQUEST_COMPONENT_BOUNDS["aggregate"]}
        checked_request_components(self, consumers, REQUEST_COMPONENT_BOUNDS["measurement"])
        for component in ("worker", "aggregate", "measurement"):
            changed = copy.deepcopy(consumers)
            measurement = REQUEST_COMPONENT_BOUNDS["measurement"]
            if component == "worker":
                changed["workers"][0] += 1
            elif component == "aggregate":
                changed["aggregate"] += 1
            else:
                measurement += 1
            with self.subTest(component=component), self.assertRaisesRegex(AssertionError, component + " request bound"):
                checked_request_components(self, changed, measurement)


class NativeGateBudgetTests(unittest.TestCase):
    def test_complete_native_stage_wrappers_count_all_authentication_calls(self):
        q = qualification_tests.QualificationAuthenticationTests()
        q.setUp()
        self.addCleanup(q.doCleanups)
        tool_tests.recipe_revision(q.fixture.api, q.fixture.contract, "e" * 40,
            ("4" * 40, "5" * 40, "6" * 40, "7" * 40))
        f = NativeFixture(self, base=q.fixture)
        f.planned["orchestration"]["qualification"] = {"artifact_id": 79,
            "archive_digest": f.api.responses["repos/owner/repo/actions/artifacts/79"]["digest"]}
        f.publish_plan()
        pilot = f.passing_pilot()
        report = f.publish("report", native.finished_report(pilot, f.planned))
        review = f.publish("admission", native.admission_decision(f.settings, f.planned, f.chain, report, pilot, [pilot, report]))
        admitted = f.publish("admission", native.admission_decision(dict(f.settings, attempt=3), f.planned, f.chain,
            report, pilot, [pilot, report, review]), attempt=3)
        all_jobs = copy.deepcopy(f.jobs)
        all_artifacts = copy.deepcopy(f.artifacts)
        proofs = [pilot, report, review, admitted]
        real_authenticate = tool.authenticate
        def authenticate(*args, **kwargs):
            return real_authenticate(*args, **kwargs, runtime=lambda *unused: f.base.runtime)
        def measured(*args):
            output = Path(args[4])
            for name, raw in pilot["files"].items():
                if name not in ("native.json", "receipt.json"):
                    destination = output / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(raw)
            return copy.deepcopy(pilot["payload"])
        counts = []
        for index, proof in enumerate(proofs):
            kind, attempt = proof["receipt"]["kind"], proof["receipt"]["attempt"]
            visible = {3000, *(item["reference"]["artifact_id"] for item in proofs[:index])}
            current_job_id = proof["receipt"]["job_id"]
            for number, jobs in all_jobs.items():
                jobs = [copy.deepcopy(job) for job in jobs if job["name"] == "mutation-plan" or
                        any(str(job["id"]) == item["receipt"]["job_id"] for item in proofs[:index + 1])]
                for job in jobs:
                    if str(job["id"]) == current_job_id:
                        job.update(status="in_progress", conclusion=None)
                f.api.responses[f"repos/owner/repo/actions/runs/300/attempts/{number}/jobs?per_page=100&page=1"] = {"jobs": jobs}
            f.api.responses["repos/owner/repo/actions/runs/300/artifacts?per_page=100&page=1"] = {
                "artifacts": [item for item in all_artifacts if item["id"] in visible]}
            environment = {"GITHUB_REPOSITORY": "owner/repo", "GITHUB_RUN_ID": "300", "GITHUB_RUN_ATTEMPT": str(attempt),
                "GITHUB_WORKFLOW_SHA": "e" * 40, "GITHUB_RETENTION_DAYS": "30", "ImageOS": "ubuntu24", "ImageVersion": "fixture-image",
                "MUTATION_CHAIN": json.dumps(f.chain), "PLAN_ARTIFACT_ID": "3000",
                "NATIVE_PILOT_ARTIFACT_ID": str(pilot["reference"]["artifact_id"]),
                "NATIVE_REPORT_ARTIFACT_ID": str(report["reference"]["artifact_id"])}
            scratch = Path(f.base.temp.name) / f"gate-client-{index}"
            scratch.mkdir()
            with mock.patch.dict(os.environ, environment), contextlib.redirect_stdout(io.StringIO()), \
            mock.patch.object(workflow.runtime, "identity", return_value=f.base.image), \
                mock.patch.object(tool, "committed_contract", return_value=f.base.contract), \
                mock.patch.object(tool, "authenticate", side_effect=authenticate), \
                mock.patch.object(runner, "checkout_inventory", return_value=(f.manifest["context"]["checkout"], {})), \
                mock.patch.object(native, "current_binding", return_value=f.manifest["context"]["checkout"]), \
                mock.patch.object(native, "run_pilot", side_effect=measured), mock.patch.object(workflow, "output"):
                api = recovery.WorkflowAPI(f.api)
                settings = workflow.current_settings(api, f.root, "production", native.JOBS[kind], 0)
                result = workflow.native_stage(api, f.root, settings, scratch, kind)
                self.assertEqual(result, 24 if index == 2 else 0, (scratch / "native/native.json").read_text())
                counts.append(api.requests)
        # First preparation has no production snapshot and no production records.
        for number, jobs in all_jobs.items():
            f.api.responses[f"repos/owner/repo/actions/runs/300/attempts/{number}/jobs?per_page=100&page=1"] = {"jobs": copy.deepcopy(jobs)}
        f.api.responses["repos/owner/repo/actions/runs/300/artifacts?per_page=100&page=1"] = {"artifacts": all_artifacts}
        job = dict(f.base.job, id=3999, run_id=300, run_attempt=3, name="mutation-prepare", status="in_progress", conclusion=None)
        f.api.responses["repos/owner/repo/actions/runs/300/attempts/3/jobs?per_page=100&page=1"]["jobs"].append(job)
        environment["NATIVE_ADMISSION_ARTIFACT_ID"] = str(admitted["reference"]["artifact_id"])
        scratch = Path(f.base.temp.name) / "first-preparation-client"
        scratch.mkdir()
        with mock.patch.dict(os.environ, environment), contextlib.redirect_stdout(io.StringIO()), \
            mock.patch.object(workflow.runtime, "identity", return_value=f.base.image), \
            mock.patch.object(tool, "committed_contract", return_value=f.base.contract), \
            mock.patch.object(tool, "authenticate", side_effect=authenticate), \
            mock.patch.object(runner, "checkout_inventory", return_value=(f.manifest["context"]["checkout"], {})), \
            mock.patch.object(runner, "validate_current_plan", return_value=f.manifest["context"]), mock.patch.object(workflow, "output"):
            api = recovery.WorkflowAPI(f.api)
            settings = workflow.current_settings(api, f.root, "production", "mutation-prepare", 0)
            workflow.prepare_recovery(api, f.root, settings, scratch)
            receipt = runner.read_json(scratch / "prepared/receipt.json")
            self.assertEqual(receipt["verdict"]["state"], "complete")
            first_preparation = api.requests
        consumer_bound = checked_request_components(self, measurement=sum(counts[:3]))
        self.assertLessEqual(counts[3] + first_preparation + consumer_bound, 800)
        self.assertLessEqual(sum(counts[:3]), 800)
        self.assertLessEqual(counts[3], 150)
        if destination := os.environ.get("MUTATION_NATIVE_GATE_API_COST_REPORT"):
            Path(destination).write_text(json.dumps({"pilot": counts[0], "finished_report": counts[1],
                "review_required": counts[2], "admission_rerun": counts[3],
                "measurement_attempt_total": sum(counts[:3]), "first_preparation_no_snapshot": first_preparation,
                "component_bounds": REQUEST_COMPONENT_BOUNDS,
                "first_admission_plus_preparation_consumers_padded_aggregate_bound": counts[3] + first_preparation + consumer_bound}, indent=2) + "\n", encoding="utf-8")


class NativePlanBudgetTests(unittest.TestCase):
    def test_original_plan_wrapper_includes_qualification_tool_and_calibration_transport(self):
        q = qualification_tests.QualificationAuthenticationTests()
        q.setUp()
        self.addCleanup(q.doCleanups)
        tool_tests.recipe_revision(q.fixture.api, q.fixture.contract, "e" * 40,
            ("4" * 40, "5" * 40, "6" * 40, "7" * 40))
        f = NativeFixture(self, base=q.fixture)
        f.api.responses["repos/owner/repo/actions/runs/300/artifacts?per_page=100&page=1"] = {"artifacts": []}
        job = dict(f.jobs[2][0], status="in_progress", conclusion=None)
        f.api.responses["repos/owner/repo/actions/runs/300/attempts/2/jobs?per_page=100&page=1"] = {"jobs": [job]}
        scratch = Path(f.base.temp.name) / "original-plan-client"
        scratch.mkdir()
        environment = {"GITHUB_REPOSITORY": "owner/repo", "GITHUB_RUN_ID": "300", "GITHUB_RUN_ATTEMPT": "2",
            "GITHUB_WORKFLOW_SHA": "e" * 40, "GITHUB_RETENTION_DAYS": "30", "ImageOS": "ubuntu24", "ImageVersion": "fixture-image",
            "QUALIFICATION_RUN_ID": "100", "RESUME_CHAIN": "", "RESUME_RUN_ID": "", "RESUME_PLAN_ARTIFACT_ID": ""}
        real_authenticate = tool.authenticate
        def authenticate(*args, **kwargs):
            return real_authenticate(*args, **kwargs, runtime=lambda *unused: f.base.runtime)
        def calibrate(root, settings, path):
            Path(str(path) + ".build.log").write_bytes(f.plan_logs["calibration/build.log"])
            Path(str(path) + ".test.log").write_bytes(f.plan_logs["calibration/test.log"])
            return f.calibration
        def plan(root, settings, calibration, path):
            runner.write_json(path, f.planned)
        with mock.patch.dict(os.environ, environment), contextlib.redirect_stdout(io.StringIO()), \
            mock.patch.object(workflow.runtime, "identity", return_value=f.base.image), \
            mock.patch.object(tool, "committed_contract", return_value=f.base.contract), \
            mock.patch.object(tool, "authenticate", side_effect=authenticate), \
            mock.patch.object(runner, "checkout_inventory", return_value=(f.manifest["context"]["checkout"], {})), \
            mock.patch.object(runner, "calibrate", side_effect=calibrate), mock.patch.object(runner, "plan", side_effect=plan), \
            mock.patch.object(workflow, "output"):
            api = recovery.WorkflowAPI(f.api)
            settings = workflow.current_settings(api, f.root, "production", "mutation-plan", 0)
            workflow.prepare_plan(api, f.root, settings, scratch)
            files = {path.relative_to(scratch / "plan").as_posix(): path.read_bytes() for path in (scratch / "plan").rglob("*") if path.is_file()}
            planned = artifacts.strict_json(files["plan.json"])
            native.validate_plan_files(files, planned)
            self.assertEqual(planned["manifest"], f.manifest)
            self.assertLessEqual(api.requests + REQUEST_COMPONENT_BOUNDS["measurement"], 800)
        if destination := os.environ.get("MUTATION_NATIVE_PLAN_API_COST_REPORT"):
            Path(destination).write_text(json.dumps({"original_plan": api.requests,
                "with_native_measurement_stages": api.requests + REQUEST_COMPONENT_BOUNDS["measurement"]}, indent=2) + "\n")


class NativeCappedForecastTests(unittest.TestCase):
    def setUp(self):
        self.f = NativeFixture(self, count=800)
        self.pilot = self.f.passing_pilot()
        self.records = native.validate_samples(self.f.planned, self.pilot["payload"]["selection"],
            self.pilot["payload"]["batches"], self.f.baseline.splitlines())

    def forecast(self, remaining):
        now = dt.datetime.now(dt.timezone.utc)
        chain = dict(self.f.chain, expires_at=(now + dt.timedelta(seconds=remaining)).isoformat(),
            started_at=(now + dt.timedelta(seconds=remaining) - dt.timedelta(days=7)).isoformat())
        return native.forecast(self.f.planned, chain, self.f.settings, self.records, self.pilot["payload"]["measurements"])

    def test_mutation_subtotal_fits_but_capped_campaign_overhead_does_not(self):
        result = self.forecast(80000)
        self.assertEqual(result["per_slot_counts"], [100] * 8)
        self.assertEqual(result["pessimistic_mutation_cap_seconds_per_slot"], [72000] * 8)
        self.assertFalse(result["pessimistic_cap_bound_fits_remaining"])
        capped = result["pessimistic_capped_campaign"]
        self.assertEqual(capped["baseline_cap_seconds_per_wave"], 720)
        self.assertEqual(capped["mutations_per_wave"], 8)
        self.assertEqual(capped["per_slot_waves"], [13] * 8)
        self.assertEqual(capped["per_slot_wall_seconds"], [109856] * 8)
        self.assertEqual(capped["reason"], "remaining_lifetime_exceeded")
        self.assertLess(result["envelope_wall_seconds"], result["remaining_wall_seconds"])

    def test_capped_campaign_fits_with_explicit_conditional_allowances(self):
        result = self.forecast(200000)
        self.assertTrue(result["pessimistic_cap_bound_fits_remaining"])
        capped = result["pessimistic_capped_campaign"]
        self.assertEqual(capped["wall_seconds"], 109856)
        self.assertEqual(capped["setup_seconds_per_wave"], 2)
        self.assertEqual(capped["reserves_seconds_per_wave"], {"shutdown_seconds": 30, "validation_seconds": 120, "upload_seconds": 240})
        self.assertEqual(capped["queue_seconds_per_wave"], 1800)
        self.assertFalse(capped["is_guarantee"])
        self.assertEqual(capped["reason"], "fits_declared_assumptions")

    def test_finished_evidence_recomputes_the_complete_capped_projection(self):
        native.validate_pilot(self.pilot, self.f.planned)
        changed = copy.deepcopy(self.pilot)
        changed["payload"]["forecast"]["pessimistic_capped_campaign"]["baseline_cap_seconds_per_wave"] = 2
        with self.assertRaisesRegex(ValueError, "capped campaign projection changed"):
            native.validate_pilot(changed, self.f.planned)

    def test_isolated_mutation_subtotal_only_control_fails_bad_case_and_keeps_fit_case(self):
        source = Path(native.__file__)
        original = source.read_bytes()
        old = '"pessimistic_cap_bound_fits_remaining": capped["fits_remaining"]'
        new = '"pessimistic_cap_bound_fits_remaining": max(counts) * capped["mutation_cap_seconds"] <= remaining'
        self.assertEqual(original.decode().count(old), 1)
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, source.name).write_bytes(original.decode().replace(old, new).encode())
            script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                "sys.path.insert(0," + repr(temporary) + ");"
                "s=unittest.defaultTestLoader.loadTestsFromNames(["
                "'test_mutation_native.NativeCappedForecastTests.test_capped_campaign_fits_with_explicit_conditional_allowances',"
                "'test_mutation_native.NativeCappedForecastTests.test_mutation_subtotal_fits_but_capped_campaign_overhead_does_not']);"
                "r=unittest.TextTestRunner().run(s);sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
            result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("True is not false", result.stderr)
        self.assertEqual(source.read_bytes(), original)

    def test_no_capped_mutation_fits_reports_null_projection_without_blocking_sample_envelope(self):
        self.f.planned["calibration"]["test_cap_seconds"] = 3600
        result = self.forecast(600000)
        self.assertFalse(result["pessimistic_cap_bound_fits_remaining"])
        capped = result["pessimistic_capped_campaign"]
        self.assertEqual(capped["mutations_per_wave"], 0)
        self.assertEqual(capped["per_slot_waves"], [None] * 8)
        self.assertEqual(capped["per_slot_wall_seconds"], [None] * 8)
        self.assertIsNone(capped["wall_seconds"])
        self.assertEqual(capped["reason"], "baseline_and_capped_mutation_do_not_fit")
        self.assertEqual(json.loads(json.dumps(result, allow_nan=False)), result)
        self.assertLess(result["envelope_wall_seconds"], result["remaining_wall_seconds"])


class NativeSizingTests(unittest.TestCase):
    def test_complete_shape_has_raw_and_snapshot_headroom_and_exhaustion_is_fatal(self):
        f = NativeFixture(self)
        pilot = f.passing_pilot()
        records = native.validate_samples(f.planned, pilot["payload"]["selection"], pilot["payload"]["batches"], f.baseline.splitlines())
        seed = {"version": 1, "planned": f.planned, "chain": f.chain, "contract": f.base.contract,
            "originals": {}, "logs": {}, "source_runs": {}, "qualification": {"fixture_shape": True},
            "tool_receipt": f.base.receipt, "current_checkout": f.manifest["context"]["checkout"]}
        result = native.sizing_probe(f.planned, records, pilot["payload"]["forecast"], [b"authenticated producer log"], {"log": b"raw log"}, batch_policy=pilot["payload"]["batch_policy"], history_seed=seed)
        self.assertEqual(result["mutation_count"], 40)
        self.assertGreater(result["raw_bundle_member_bytes"], len(json.dumps(f.manifest)))
        self.assertEqual(result["admitted_bound_fraction"], .8)
        self.assertEqual(result["producer_log_shape_count"], result["admitted_total_history_attempts"] * 10 + 4)
        with mock.patch.object(artifacts, "MAX_ARCHIVE", int(result["logical_bytes"] * 1.1)):
            with self.assertRaisesRegex(ValueError, "twenty percent headroom"):
                native.sizing_probe(f.planned, records, pilot["payload"]["forecast"], [b"authenticated producer log"], {"log": b"raw log"}, batch_policy=pilot["payload"]["batch_policy"], history_seed=seed)


class NativeFaultControls(unittest.TestCase):
    def test_isolated_native_guards_fail_bad_cases_and_keep_valid_case(self):
        controls = [
            ('previous[0]["payload"]["state"] == REVIEW_REQUIRED', 'True',
             'test_different_previous_verdict_is_not_the_review_boundary'),
            ('proof["payload"]["state"] == "admitted"', 'True',
             'test_snapshot_admission_binding_and_total_history_ceiling_are_mandatory'),
            ('consumed > native["admitted_total_history_attempts"]', 'False',
             'test_snapshot_admission_binding_and_total_history_ceiling_are_mandatory'),
            ('uploaded["upload_seconds"] <= payload["reserves"]["upload_seconds"]', 'True',
             'test_actual_upload_step_and_original_reserve_are_enforced'),
            ("""f"batch-{batch['logical_slot']}/mutants.out/{path}" in files""", 'True',
             'test_raw_diagnostic_logs_and_diffs_are_required')]
        source = Path(native.__file__)
        original = source.read_bytes()
        for old, new, test in controls:
            with self.subTest(test=test), tempfile.TemporaryDirectory() as temporary:
                text = original.decode()
                self.assertEqual(text.count(old), 1)
                Path(temporary, source.name).write_text(text.replace(old, new), encoding="utf-8")
                # Import a real production contract before the isolated helper shadows its implementation.
                script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                    "sys.path.insert(0," + repr(temporary) + ");"
                    "s=unittest.defaultTestLoader.loadTestsFromNames([" +
                    repr("test_mutation_native.NativeAuthenticationTests.test_authenticated_same_attempt_requires_review_and_later_exact_transition_admits") + "," +
                    repr("test_mutation_native.NativeAuthenticationTests." + test) + "]);"
                    "r=unittest.TextTestRunner().run(s);sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)


class NativeGraphTests(unittest.TestCase):
    def test_production_cannot_release_workers_without_separate_admission(self):
        source = (Path(__file__).resolve().parents[1] / "workflows/ci.yml").read_text()
        self.assertIn("  mutation-native-pilot:\n", source)
        self.assertIn("  mutation-native-pilot-report:\n", source)
        self.assertIn("  mutation-admission:\n", source)
        prepare = source.split("  mutation-prepare:\n", 1)[1].split("  mutants:\n", 1)[0]
        self.assertIn("needs.mutation-admission.result == 'success'", prepare)
        aggregate = source.split("  mutation-aggregate:\n", 1)[1].split("  web:\n", 1)[0]
        self.assertIn("needs.mutation-admission.result == 'success'", aggregate)


if __name__ == "__main__":
    unittest.main()
