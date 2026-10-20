"""Enforced production prefixes and typed retained-artifact capacity."""
import base64
import contextlib
import copy
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import unittest
from unittest import mock

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_native as native
import mutation_runner as runner
import mutation_workflow as workflow
import mutation_recovery as recovery
import mutation_tool as tool
from test_mutation_artifacts import archive
from test_mutation_campaign import raw_report
from test_mutation_native import NativeFixture
import test_mutation_native as native_tests
import test_mutation_recovery as recovery_tests


class OutgoingInventoryTests(unittest.TestCase):
    def test_separate_members_are_not_summed_into_one_member(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(3):
                (root / f"member-{index}.log").write_bytes(bytes([index]) * 800)
            with mock.patch.object(artifacts, "MAX_MEMBER", 1000), mock.patch.object(artifacts, "MAX_ARCHIVE", 2500):
                self.assertTrue(hasattr(artifacts, "outgoing_inventory"), "outgoing artifact inventory is missing")
                actual = artifacts.outgoing_inventory(root)
                self.assertEqual(actual["expanded_bytes"], 2400)
                self.assertEqual(actual["maximum_member_bytes"], 800)
                self.assertEqual(actual["violations"], [])
                accepted = artifacts.unpack(archive({p.name: p.read_bytes() for p in root.iterdir()}))
                self.assertEqual(len(accepted), 3)


    def test_member_total_and_count_bounds_fail_independently(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(3):
                (root / str(index)).write_bytes(b"x" * 800)
            for member, total, count, expected in ((700, 10000, 10, "member_bytes"), (1000, 2000, 10, "expanded_bytes"), (1000, 10000, 2, "member_count")):
                with self.subTest(expected=expected), mock.patch.object(artifacts, "MAX_MEMBER", member), \
                    mock.patch.object(artifacts, "MAX_ARCHIVE", total), mock.patch.object(artifacts, "MAX_MEMBERS", count):
                    inventory = artifacts.outgoing_inventory(root)
                    self.assertEqual(inventory["violations"], [expected])
                    self.assertEqual(artifacts.validate_outgoing_inventory(inventory), [expected])
                    with self.assertRaises(ValueError):
                        artifacts.unpack(archive({p.name: p.read_bytes() for p in root.iterdir()}))


    def test_isolated_member_limit_control_rejects_the_expected_assertion(self):
        source = Path(artifacts.__file__)
        original = source.read_bytes()
        old = '    if largest > MAX_MEMBER:\n        violations.append("member_bytes")'
        self.assertEqual(original.decode().count(old), 1)
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, source.name).write_bytes(original.decode().replace(old, '    if False:\n        violations.append("member_bytes")').encode())
            script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");sys.path.insert(0," + repr(temporary) + ");"
                "s=unittest.defaultTestLoader.loadTestsFromNames(["
                "'test_mutation_batch_budget.OutgoingInventoryTests.test_separate_members_are_not_summed_into_one_member',"
                "'test_mutation_batch_budget.OutgoingInventoryTests.test_member_total_and_count_bounds_fail_independently']);"
                "r=unittest.TextTestRunner().run(s);sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
            result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)


class CapacityFailureHistoryTests(unittest.TestCase):
    def setUp(self):
        self.f = recovery_tests.SnapshotFixture(self)
        f = self.f
        f.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 3
        self.job = dict(f.q.fixture.job, id=50001, run_id=100, run_attempt=3, name="mutation-fixture-slot-0", conclusion="failure")
        f.api.responses["repos/owner/repo/actions/runs/100/attempts/3"] = {"id": 100, "run_attempt": 3, "head_sha": "d" * 40}
        f.api.responses["repos/owner/repo/actions/runs/100/attempts/3/jobs?per_page=100&page=1"] = {"jobs": [self.job]}
        self.receipt = dict(f.plan["producer"], job_id="50001", attempt=3, slot=0)
        self.directory = Path(f.q.fixture.temp.name) / "overflow"
        self.directory.mkdir()
        self.bundle = {"manifest": f.q.manifest, "receipt": self.receipt, "status": {"state": "complete", "reason": "tool_completed"}}
        with (self.directory / "raw.log").open("wb") as stream:
            block = b"x" * (1024 * 1024)
            for _ in range(33):
                stream.write(block)
        self.inventory = artifacts.outgoing_inventory(self.directory)
        self.log_path = "repos/owner/repo/actions/jobs/50001/logs"
        self.publish(self.bundle, self.inventory)

    def publish(self, bundle, inventory):
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            artifacts.emit_capacity_failure(bundle, inventory)
        self.f.api.blobs[self.log_path] = stream.getvalue().encode()

    def ingest(self, data=None):
        f = self.f
        data = copy.deepcopy(data or f.data)
        settings = dict(f.settings, attempt=3, job_id="60000")
        api = recovery.WorkflowAPI(f.api)
        inventory, runs = recovery.fresh_inventory(api, data, settings, allow_current_aggregate=True)
        recovered = recovery.ingest(api, data, settings, inventory, runs, include_current=True)
        return data, settings, recovered

    def test_authenticated_capacity_failure_never_imports_records_or_disappears_on_complete_history(self):
        original = artifacts.outgoing_inventory(self.directory)["members"][0]["sha256"]
        runner_temp = Path(self.f.q.fixture.temp.name) / "capacity-runner"
        runner_temp.mkdir()
        outputs, captured = [], io.StringIO()
        def overflowing(*args):
            destination = runner_temp / "mutation-job/result"
            shutil.copytree(self.directory, destination)
            runner.write_json(destination / "bundle.json", self.bundle)
            return 0
        with mock.patch.dict(os.environ, {"RUNNER_TEMP": str(runner_temp), "MUTATION_JOB_NAME": "mutation-fixture-slot-0"}), \
            mock.patch.object(workflow, "current_settings", return_value=dict(self.f.settings, attempt=3)), \
            mock.patch.object(workflow, "execute", side_effect=overflowing), \
            mock.patch.object(workflow, "output", side_effect=lambda *args: outputs.append(args)), contextlib.redirect_stdout(captured):
            self.assertEqual(workflow.main(["slot", "--root", str(self.f.root), "--scope", "fixture"]), 23)
        self.assertNotIn(("bundle_ready", "true"), outputs)
        self.f.api.blobs[self.log_path] = captured.getvalue().encode()
        data, settings, recovered = self.ingest()
        self.assertEqual(len(recovered["records"]), 24)
        self.assertIn("50001", data["capacity_failures"])
        summary = model.summarize(self.f.q.manifest, recovered["records"], [])
        self.assertTrue(summary["complete"])
        self.assertEqual(runner.continuation_status(summary, recovered["bundles"])[0], "capacity_failure")
        self.assertEqual(artifacts.outgoing_inventory(self.directory)["members"][0]["sha256"], original)
        self.f.api.responses["repos/owner/repo/actions/runs/100/attempts/3/jobs?per_page=100&page=1"]["jobs"].append(
            dict(self.job, id=60000, name="mutation-fixture-aggregate", status="in_progress", conclusion=None))
        with mock.patch.object(runner, "validate_current_plan", return_value=self.f.q.manifest["context"]):
            result = runner.aggregate(self.f.root, self.f.plan, self.f.q.chain, settings,
                self.directory / "aggregate.json", self.f.api, recovered=recovered)
        self.assertEqual(result["state"], "capacity_failure")
        destination = self.directory / "snapshot"
        with contextlib.redirect_stdout(io.StringIO()):
            recovery.seal(data, settings, "aggregate", result, destination)
        retained = recovery.decode(b"".join(path.read_bytes() for path in sorted(destination.glob("chunk-*.bin"))))
        self.assertEqual(retained["capacity_failures"], data["capacity_failures"])
        recovery.validate_retained(retained, pending_aggregate={"run_id": "100", "attempt": 3, "job_id": "60000"})
        self.assertEqual(runner.continuation_status(summary, recovery.recovered(retained, settings, include_current=True)["bundles"])[0], "capacity_failure")

    def test_wrong_binding_missing_tampered_inventory_and_upload_contradiction_fail(self):
        f = self.f
        payload = artifacts.capacity_marker(f.api.blobs[self.log_path])
        bad = copy.deepcopy(self.bundle)
        bad["receipt"]["input_fingerprint"] = "f" * 64
        self.publish(bad, self.inventory)
        with self.assertRaisesRegex(ValueError, "computation binding"):
            self.ingest()
        self.publish(self.bundle, self.inventory)
        f.api.blobs[self.log_path] += b"MUTATION_ARTIFACT_ID=1234\n"
        with self.assertRaisesRegex(ValueError, "contradicts uploaded"):
            self.ingest()
        bad_inventory = copy.deepcopy(self.inventory)
        bad_inventory["members"][0]["sha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "digest changed"):
            self.publish(self.bundle, bad_inventory)
        for field in ("missing_inventory", "inventory_digest", "batch_policy"):
            changed = copy.deepcopy(payload)
            if field == "missing_inventory":
                del changed["inventory"]
            elif field == "inventory_digest":
                changed["inventory"]["inventory_digest"] = "f" * 64
            else:
                changed["batch_policy_digest"] = changed["receipt"]["batch_policy_digest"] = "f" * 64
            raw = json.dumps(changed, separators=(",", ":")).encode()
            encoded = base64.b64encode(raw).decode()
            chunks = [encoded[i:i + 3072] for i in range(0, len(encoded), 3072)]
            header = {"job_id": "50001", "sha256": artifacts.sha(raw), "bytes": len(raw), "chunks": len(chunks)}
            lines = ["MUTATION_CAPACITY_START " + json.dumps(header)]
            lines += ["MUTATION_CAPACITY_CHUNK " + json.dumps({"job_id": "50001", "index": index, "data": part}) for index, part in enumerate(chunks)]
            lines.append("MUTATION_CAPACITY_END " + json.dumps(header))
            f.api.blobs[self.log_path] = ("\n".join(lines) + "\n").encode()
            with self.subTest(field=field), self.assertRaises((ValueError, KeyError)):
                self.ingest()
        self.publish(self.bundle, self.inventory)
        f.api.blobs[self.log_path] = b"\n".join(f.api.blobs[self.log_path].splitlines()[:-1])
        with self.assertRaisesRegex(ValueError, "incomplete or conflicting"):
            self.ingest()


class BoundedExecutionTests(unittest.TestCase):
    def setUp(self):
        self.f = NativeFixture(self, count=40)
        self.ctx = copy.deepcopy(self.f.manifest["context"])
        self.ctx["inputs"]["input_inventory"] = {"entries": []}
        self.manifest = model.build_manifest(self.f.items, self.ctx)
        self.planned = dict(self.f.planned, manifest=self.manifest)
        self.settings = dict(self.f.settings, attempt=1)
        self.slot = self.manifest["mutations"][0]["slot"]
        self.settings["slot"] = self.slot
        self.ids = runner.ordered_remaining(self.manifest, [], self.slot)
        self.assertGreater(len(self.ids), 2)
        self.selected_calls = []
        self.launches = []
        for item in self.f.items:
            path = self.f.root / item["file"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((b"        " + b"x" * 80 + b"\n") * 100)
        (self.f.root / "Cargo.lock").write_bytes(b"version = 4\n")
        self.binary = Path(self.f.base.temp.name) / "only-tool"
        self.binary.write_bytes(b"fixed executable bytes")
        self.executable = {"version": "27.1.0", "binary_sha256": artifacts.sha(self.binary.read_bytes()), "executable": str(self.binary)}
        self.by_name = {item["name"]: item for item in self.f.items}

    def policy(self, settings):
        return runner.AuthenticatedBatchPolicy({"algorithm": runner.BATCH_ALGORITHM, "max_mutations": 2,
            "manifest_digest": model.digest(self.manifest)}, self.planned, self.f.chain, settings)

    def run_batch(self, attempt, deltas, *, interrupted=False):
        settings = dict(self.settings, attempt=attempt)
        records = model.merge_deltas(self.manifest, deltas, allowed_run_ids={"300"}, current_run_id="300", current_attempt=attempt)
        recovered = artifacts.AuthenticatedRecovery({"records": records, "deltas": deltas, "bundles": [], "allowed_run_ids": ["300"]},
            self.manifest, "300", attempt, False)
        def command(argv, cwd, env=None):
            if argv[:2] == ["git", "clone"]:
                shutil.copytree(self.f.root, Path(argv[-1]))
            if "--list" in argv:
                patterns = tomllib.loads(Path(argv[argv.index("--config") + 1]).read_text())["examine_re"]
                selected = [item for item in self.f.items if any(re.fullmatch(pattern, item["name"]) for pattern in patterns)]
                self.selected_calls.append([item["name"] for item in selected])
                return json.dumps(selected)
            return ""
        real_controller = runner.run_controller
        def completed(argv, **kwargs):
            batch_ids = kwargs["batch_ids"]
            self.launches.append(list(batch_ids))
            by_id = {item["id"]: item for item in self.manifest["mutations"]}
            selected = [self.by_name[by_id[mid]["name"]] for mid in batch_ids]
            report = raw_report(selected)
            raw = json.dumps(report).encode()
            report_path = Path(kwargs["report_path"])
            report_path.parent.mkdir(parents=True)
            if not interrupted:
                report_path.write_bytes(raw)
            for name, contents in {"log/baseline.log": b"baseline", "log/mutant.log": b"mutant", "diff/mutant.diff": b"diff"}.items():
                path = report_path.parent / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(contents)
            if interrupted:
                initial = json.dumps(raw_report(selected[:1], interrupted=True)).encode()
                class Process:
                    def __init__(self, *args, **unused):
                        self.stopped = False
                        report_path.write_bytes(initial)
                    def poll(self):
                        return 101 if self.stopped else None
                    def stop(self, seconds):
                        self.stopped = True
                        report_path.write_bytes(raw)
                self.assertIsNone(kwargs["stop_after_records"])
                return real_controller(argv, **dict(kwargs, deadline=0, process_factory=Process))
            Path(kwargs["log_path"]).write_bytes(b"process output")
            delta = model.validate_report(self.manifest, self.slot, batch_ids, report, provenance=kwargs["provenance"],
                raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(report)}, exit_kind="completed")
            return {"state": "complete", "reason": "tool_completed", "returncode": 0, "snapshot": (raw, delta)}
        output = Path(self.f.base.temp.name) / f"result-{attempt}"
        with mock.patch.object(runner, "installed_tool", return_value=self.executable), \
            mock.patch.object(runner, "execution_environment", return_value=({}, {})), \
            mock.patch.object(runner, "collect_context", return_value=(self.ctx, {}, self.f.items)), \
            mock.patch.object(runner, "checkout_inventory", return_value=(self.ctx["checkout"], self.ctx["inputs"]["input_inventory"])), \
            mock.patch.object(runner, "command", side_effect=command), mock.patch.object(runner, "capacity", return_value={"admit": True}), \
            mock.patch.object(runner, "run_controller", side_effect=completed), contextlib.redirect_stdout(io.StringIO()):
            return runner.execute_slot(self.f.root, settings, self.planned, self.f.chain, output,
                recovered=recovered, batch_policy=self.policy(settings))

    def test_fast_normal_prefix_is_incomplete_then_resumes_without_loss_or_duplication(self):
        deltas = []
        while sum(len(delta["records"]) for delta in deltas) < len(self.ids):
            before = sum(len(delta["records"]) for delta in deltas)
            bundle = self.run_batch(len(deltas) + 1, deltas)
            self.assertEqual(self.launches[-1], self.ids[before:before + 2])
            self.assertEqual(len(self.selected_calls[-1]), min(2, len(self.ids) - before))
            deltas.append(bundle["delta"])
            complete = sum(len(delta["records"]) for delta in deltas) == len(self.ids)
            self.assertEqual(bundle["status"]["state"], "complete" if complete else "incomplete_with_progress")
            self.assertEqual(bundle["status"]["remaining"], sorted(self.ids[before + 2:]))
        self.assertEqual([mid for batch in self.launches for mid in batch], self.ids)

    def test_bounded_interruption_keeps_active_identity_first_and_ignores_post_signal_claim(self):
        first = self.run_batch(1, [], interrupted=True)
        self.assertEqual(first["status"]["state"], "incomplete_with_progress")
        self.assertEqual([record["mutation_id"] for record in first["delta"]["records"]], self.ids[:1])
        self.run_batch(2, [first["delta"]])
        self.assertEqual(self.launches[1], self.ids[1:3])
        retained = Path(self.f.base.temp.name) / "result-1"
        self.assertEqual(len(runner.read_json(retained / "raw/outcomes.json")["outcomes"]), 2)
        self.assertEqual(len(runner.read_json(retained / "diagnostic/post-shutdown-outcomes.json")["outcomes"]), 3)

    def test_isolated_prefix_and_truthful_status_guards(self):
        source = Path(runner.__file__)
        original = source.read_bytes()
        controls = [('ids = ids[:checked_budget["max_mutations"]]', 'ids = ids'),
                    ('result.update(state="incomplete_with_progress", reason="bounded_batch_complete")', 'pass')]
        for old, new in controls:
            with self.subTest(guard=old), tempfile.TemporaryDirectory() as temporary:
                self.assertEqual(original.decode().count(old), 1)
                Path(temporary, source.name).write_bytes(original.decode().replace(old, new).encode())
                script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                    "sys.path.insert(0," + repr(temporary) + ");"
                    "s=unittest.defaultTestLoader.loadTestsFromNames(["
                    "'test_mutation_batch_budget.BoundedExecutionTests.test_optional_typed_batch_interface_exists_without_a_cli_count',"
                    "'test_mutation_batch_budget.BoundedExecutionTests.test_fast_normal_prefix_is_incomplete_then_resumes_without_loss_or_duplication']);"
                    "r=unittest.TextTestRunner().run(s);sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)

    def test_optional_typed_batch_interface_exists_without_a_cli_count(self):
        import inspect
        self.assertIn("batch_policy", inspect.signature(runner.execute_slot).parameters)
        self.assertEqual(inspect.signature(runner.execute_slot).parameters["batch_policy"].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertNotIn("--batch-count", Path(runner.__file__).read_text())


class TypedRawBudgetTests(unittest.TestCase):
    def test_actual_separate_log_bundle_fits_and_process_growth_limits_batch(self):
        f = NativeFixture(self, count=800)
        slot = 0
        ids = runner.ordered_remaining(f.manifest, [], slot)
        by_id = {item["id"]: item for item in f.manifest["mutations"]}
        by_name = {item["name"]: item for item in f.items}
        selected = [by_name[by_id[mid]["name"]] for mid in ids]
        report = raw_report(selected)
        for index, outcome in enumerate(report["outcomes"]):
            outcome["log_path"] = f"log/scenario-{index}.log"
            if index:
                outcome["diff_path"] = f"diff/scenario-{index}.diff"
        raw = json.dumps(report, indent=2).encode()
        provenance = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "run_id": "300", "attempt": 2,
            "batch_id": model.digest(ids), "execution_id": "full-synthetic-slot", "checkout": f.manifest["context"]["checkout"],
            "input_fingerprint": f.manifest["input_fingerprint"]}
        delta = model.validate_report(f.manifest, slot, ids, report, provenance=provenance,
            raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(report)}, exit_kind="completed")
        source = Path(f.base.temp.name) / "producer-raw"
        source.mkdir()
        diagnostic = {"batch-0/frozen-outcomes.json": raw, "batch-0/process.log": b"process output"}
        log = b"x" * 300000
        for outcome in report["outcomes"]:
            for field, contents in (("log_path", log), ("diff_path", b"diff")):
                if outcome[field] is None:
                    continue
                path = source / outcome[field]
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(contents)
                diagnostic["batch-0/mutants.out/" + outcome[field]] = contents
        receipt = dict(f.planned["producer"], **{k: provenance[k] for k in ("batch_id", "execution_id")})
        destination = Path(f.base.temp.name) / "raw-bundle"
        with contextlib.redirect_stdout(io.StringIO()):
            runner.retain_bundle(destination, f.manifest, receipt,
                {"state": "complete", "reason": "exact_coverage", "snapshot": (raw, delta)}, report_parent=source)
        (destination / "process.log").write_bytes(b"process output")
        (destination / "diagnostic").mkdir()
        (destination / "diagnostic/post-shutdown-outcomes.json").write_bytes(raw)
        native.compact_json(destination / "bundle.json")
        inventory = artifacts.outgoing_inventory(destination)
        self.assertEqual(inventory["member_count"], 205)
        self.assertEqual(inventory["violations"], [])
        self.assertLess(inventory["expanded_bytes"], artifacts.MAX_ARCHIVE * .8)
        files = artifacts.unpack(archive({p.relative_to(destination).as_posix(): p.read_bytes() for p in destination.rglob("*") if p.is_file()}))
        metadata = dict(f.base.artifact, name=artifacts.artifact_name(f.manifest["campaign_id"], "300", 2, 0), workflow_run={"id": 300, "head_sha": "d" * 40})
        validated = artifacts.validate_bundle(files, f.manifest, f.chain["runs"][0], metadata, repository="owner/repo", workflow=tool.WORKFLOW)
        self.assertEqual(len(validated["delta"]["records"]), 100)
        batches = [{"logical_slot": 0, "delta": delta}]
        policy = native.choose_batch_policy(f.planned, f.chain, delta["records"], batches, diagnostic)
        self.assertEqual(policy["max_mutations"], 100)
        self.assertGreater(300000 * 100, artifacts.MAX_MEMBER * .8, "the old scalar member estimate falsely refused this layout")
        diagnostic["batch-0/process.log"] = log
        limited = native.choose_batch_policy(f.planned, f.chain, delta["records"], batches, diagnostic)
        self.assertLess(limited["max_mutations"], 100)
        self.assertTrue(limited["projection"]["fits_projected_headroom"])
        self.assertFalse(native.raw_projection(limited["shapes"], limited["max_mutations"] + 1)["fits_projected_headroom"])
        metrics = {"clone_setup_seconds": [1], "job_initial_setup_seconds": 1}
        now = dt.datetime.now(dt.timezone.utc)
        chain = dict(f.chain, expires_at=(now + dt.timedelta(seconds=50000)).isoformat())
        native.forecast(f.planned, chain, f.settings, delta["records"], metrics)
        with self.assertRaisesRegex(runner.CapacityFailure, "finite campaign"):
            native.forecast(f.planned, chain, f.settings, delta["records"], metrics, batch_limit=limited["max_mutations"])
        changed = copy.deepcopy(policy["shapes"])
        changed["outcome_pretty_bytes"] = artifacts.MAX_MEMBER
        self.assertFalse(native.raw_projection(changed, 1)["fits_projected_headroom"])
        with mock.patch.object(native, "raw_shape_budget", return_value=changed):
            with self.assertRaisesRegex(runner.CapacityFailure, "one production identity"):
                native.choose_batch_policy(f.planned, f.chain, delta["records"], batches, diagnostic)

    def test_full_manifest_maximum_includes_longer_row_in_a_smaller_slot(self):
        f = NativeFixture(self, count=41)
        pilot = f.passing_pilot()
        records = native.validate_samples(f.planned, pilot["payload"]["selection"], pilot["payload"]["batches"], f.baseline.splitlines())
        original = native.raw_shape_budget(f.planned, records, pilot["payload"]["batches"], pilot["files"])
        # Identity descriptors remain actual full-manifest inputs; only this disposable fixture is rebuilt.
        listing = copy.deepcopy(f.items)
        listing[20]["replacement"] = "x" * 5000
        manifest = model.build_manifest(listing, f.manifest["context"])
        large = next(item for item in manifest["mutations"] if item["replacement"] == "x" * 5000)
        self.assertLess(len(model.slot_ids(manifest, large["slot"])), max(len(model.slot_ids(manifest, slot)) for slot in range(8)))
        shape = native.raw_shape_budget(dict(f.planned, manifest=manifest), records, pilot["payload"]["batches"], pilot["files"])
        self.assertGreater(shape["record_compact_bytes"], original["record_compact_bytes"] + 4000)
        self.assertGreater(shape["outcome_pretty_bytes"], original["outcome_pretty_bytes"] + 4000)


class BatchPolicyBindingTests(unittest.TestCase):
    def test_missing_plain_stale_and_substituted_policy_refuse_before_execution(self):
        owner = native_tests.NativeAuthenticationTests()
        owner.setUp()
        self.addCleanup(owner.doCleanups)
        f = owner.f
        proofs = owner.admitted_proofs()
        data = {"planned": f.planned, "chain": f.chain, "logs": {}, "originals": {}, "source_runs": {}}
        native.install_admission(data, proofs)
        settings = dict(f.settings, attempt=3)
        token = native.admitted_batch_policy(data, settings)
        with self.assertRaises(AttributeError):
            token._raw = b"changed"
        with mock.patch.object(runner, "installed_tool") as launch:
            for supplied in (None, data["native_admission"]["batch_policy"]):
                with self.subTest(supplied=type(supplied).__name__), self.assertRaisesRegex(ValueError, "authenticated batch policy"):
                    runner.execute_slot(f.root, settings, f.planned, f.chain, f.root / "never", batch_policy=supplied)
            with self.assertRaisesRegex(ValueError, "stale production batch policy"):
                runner.execute_slot(f.root, dict(settings, attempt=4), f.planned, f.chain, f.root / "never", batch_policy=token)
            launch.assert_not_called()
        for key, value in (("batch_policy_digest", "f" * 64), ("batch_policy", dict(data["native_admission"]["batch_policy"], max_mutations=1))):
            changed = copy.deepcopy(data)
            changed["native_admission"][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "batch"):
                native.admitted_batch_policy(changed, settings)
        del data["native_admission"]["batch_policy"]
        with self.assertRaises(KeyError):
            workflow.ensure_native_admission(f.api, data, settings)


class HistoryBudgetTests(unittest.TestCase):
    def shape(self):
        f = NativeFixture(self)
        pilot = f.passing_pilot()
        records = native.validate_samples(f.planned, pilot["payload"]["selection"], pilot["payload"]["batches"], f.baseline.splitlines())
        seed = {"version": 1, "planned": f.planned, "chain": f.chain, "contract": f.base.contract, "originals": {},
            "logs": {}, "source_runs": {}, "qualification": {"fixture_shape": True}, "tool_receipt": f.base.receipt,
            "current_checkout": f.manifest["context"]["checkout"]}
        value = native.projected_history(f.planned, seed, records, pilot["payload"]["forecast"], pilot["payload"]["batch_policy"], [b"original log bytes"])
        return f, pilot, value

    def test_actual_retained_schema_preserves_full_remaining_and_logical_limit(self):
        f, pilot, value = self.shape()
        raw = recovery.encode(value)
        logical = recovery.decode(raw, materialize=False)
        restored = recovery.decode(raw)
        self.assertEqual(model.digest(restored), model.digest(value))
        self.assertEqual(sum(len(item["bundle"]["delta"]["records"]) for item in restored["bundles"]), len(f.items))
        for item in restored["bundles"]:
            bundle = item["bundle"]
            self.assertLessEqual(len(bundle["delta"]["batch_ids"]), pilot["payload"]["batch_policy"]["max_mutations"])
            self.assertEqual(bundle["status"]["remaining"], model.slot_ids(f.manifest, bundle["receipt"]["slot"]))
        self.assertTrue(any(not item["bundle"]["delta"]["records"] for item in restored["bundles"]))
        self.assertEqual(len({row["sha256"] for row in restored["logs"].values()}), len(restored["logs"]))
        self.assertTrue(restored["phase_inventories"] and restored["aggregate_verdicts"] and restored["native_admission"]["proofs"])
        self.assertLess(len(archive({"chunk.bin": raw})), logical // 20)
        with mock.patch.object(recovery, "MAX_RECONSTRUCTED_BYTES", logical - 1):
            with self.assertRaisesRegex(runner.CapacityFailure, "reconstruction capacity"):
                recovery.encode(value)

    def test_isolated_logical_limit_control_fails_capacity_assertion(self):
        source = Path(recovery.__file__)
        original = source.read_bytes()
        old = 'cost <= MAX_RECONSTRUCTED_BYTES, "snapshot reconstruction capacity exceeded"'
        self.assertEqual(original.decode().count(old), 1)
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, source.name).write_bytes(original.decode().replace(old, 'True, "snapshot reconstruction capacity exceeded"').encode())
            script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");sys.path.insert(0," + repr(temporary) + ");"
                "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName("
                "'test_mutation_batch_budget.HistoryBudgetTests.test_actual_retained_schema_preserves_full_remaining_and_logical_limit'));"
                "sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
            result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)


class PreparedBudgetTests(unittest.TestCase):
    def test_qualification_from_before_batch_recipe_is_not_transferable(self):
        q = native_tests.qualification_tests.QualificationAuthenticationTests()
        q.setUp()
        self.addCleanup(q.doCleanups)
        q.verify()
        proof = copy.deepcopy(q.proof)
        del proof["contract"]["batch_algorithm"]
        raw = archive({"qualification.json": json.dumps(proof).encode()})
        q.api.responses["repos/owner/repo/actions/artifacts/79"]["digest"] = "sha256:" + artifacts.sha(raw)
        q.api.blobs["repos/owner/repo/actions/artifacts/79/zip"] = raw
        q.api.blobs["repos/owner/repo/actions/jobs/999/logs"] = ("MUTATION_QUALIFICATION " + json.dumps(proof) + "\nMUTATION_ARTIFACT_ID=79\n").encode()
        with self.assertRaisesRegex(ValueError, "qualification computation contract mismatch"):
            q.verify()


    def test_preparation_seal_worker_and_complete_aggregate_cannot_use_substituted_policy(self):
        f = native_tests.NativeSnapshotFixture(self)
        settings = dict(f.settings, attempt=4, job_id="70001")
        f.api.responses["repos/owner/repo/actions/runs/300"]["run_attempt"] = 4
        changed = copy.deepcopy(f.data)
        changed["native_admission"]["batch_policy_digest"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "batch policy digest"):
            recovery.seal(changed, settings, "prepared", {"state": "complete"}, Path(f.q.fixture.temp.name) / "refused")
        with mock.patch.object(native, "validate_admitted"):
            selected, _ = f.upload_snapshot(data=changed, settings=settings, kind="prepared")
        metadata = f.api.responses[f"repos/owner/repo/actions/artifacts/{selected['artifact_id']}"]
        metadata["workflow_run"] = {"id": 300, "head_sha": "d" * 40}
        f.paginate()
        with self.assertRaisesRegex(ValueError, "batch policy digest"):
            recovery.load(recovery.WorkflowAPI(f.api), selected, "owner/repo", f.contract, consumer={"run_id": "300", "attempt": 4})
        env = {"PREPARED_ARTIFACT_ID": str(selected["artifact_id"]), "PLAN_ARTIFACT_ID": "3000",
               "MUTATION_CHAIN": json.dumps(f.data["chain"]), "NATIVE_ADMISSION_ARTIFACT_ID": ""}
        with mock.patch.dict(os.environ, env), mock.patch.object(tool, "committed_contract", return_value=f.contract), \
            mock.patch.object(runner, "checkout_inventory", return_value=(f.q.manifest["context"]["checkout"], {})), \
            mock.patch.object(runner, "execute_slot") as worker, mock.patch.object(runner, "aggregate") as aggregate:
            for command in ("slot", "aggregate"):
                scratch = Path(f.q.fixture.temp.name) / ("bad-policy-" + command)
                scratch.mkdir()
                with self.subTest(command=command), self.assertRaisesRegex(ValueError, "batch policy digest"):
                    workflow.execute(recovery.WorkflowAPI(f.api), f.root, settings, scratch, command)
            worker.assert_not_called()
            aggregate.assert_not_called()


class OrderedSlotValidationTests(unittest.TestCase):
    def test_one_validation_preserves_all_original_slot_orders_and_rejects_changed_manifest(self):
        f = NativeFixture(self)
        # Keep the prior public algorithm as an independent comparison without importing ignored files.
        def previous(manifest, records, slot):
            completed = {record["mutation_id"] for record in records}
            assigned = set(model.slot_ids(manifest, slot))
            by_name = {item["name"]: item["id"] for item in manifest["mutations"]}
            order = manifest["context"]["inputs"].get("generation_order", list(by_name))
            return [by_name[name] for name in order if by_name[name] in assigned and by_name[name] not in completed]
        records = [{"mutation_id": item["id"]} for item in f.manifest["mutations"][::3]]
        expected = [previous(f.manifest, records, slot) for slot in range(8)]
        with mock.patch.object(model, "validate_manifest", wraps=model.validate_manifest) as validation:
            self.assertEqual(runner.ordered_remaining_by_slot(f.manifest, records), expected)
            self.assertEqual(validation.call_count, 1)
        for slot in range(8):
            self.assertEqual(runner.ordered_remaining(f.manifest, records, slot), expected[slot])
        malformed = copy.deepcopy(f.manifest)
        malformed["mutations"][0]["slot"] = 99
        with self.assertRaises(ValueError):
            runner.ordered_remaining_by_slot(malformed, records)
        runner.ordered_remaining_by_slot(f.manifest, records)
        f.manifest["context"]["inputs"]["source_digest"] = "f" * 64
        with self.assertRaises(ValueError):
            runner.ordered_remaining_by_slot(f.manifest, records)
        with self.assertRaises(ValueError):
            runner.ordered_remaining(f.manifest, records, 0)


class MixedPayloadEnvelopeTests(unittest.TestCase):
    def exercise(self, mixed):
        f = NativeFixture(self, count=16)
        f.items[-1]["replacement"] = "x" * 5000
        f.items[-1]["diff"] = "-old\n+" + "x" * 5000 + "\n"
        manifest = model.build_manifest(f.items, f.manifest["context"])
        planned = dict(f.planned, manifest=manifest, producer=dict(f.planned["producer"], campaign_id=manifest["campaign_id"]))
        by_name = {item["name"]: item for item in f.items}
        records, batches, files = [], [], {}
        for slot in range(8):
            ids = runner.ordered_remaining(manifest, [], slot)
            selected = [by_name[item["name"]] for item in manifest["mutations"] if item["id"] in ids]
            summaries = ["Unviable" if mixed and item["replacement"] == "x" * 5000 else "CaughtMutant" for item in selected]
            report = raw_report(selected, summaries)
            raw = json.dumps(report, indent=2).encode()
            provenance = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "run_id": "300", "attempt": 2,
                "batch_id": model.digest(ids), "execution_id": f"observed-{slot}", "checkout": manifest["context"]["checkout"],
                "input_fingerprint": manifest["input_fingerprint"]}
            delta = model.validate_report(manifest, slot, ids, report, provenance=provenance,
                raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(report)}, exit_kind="completed")
            records.extend(delta["records"])
            batches.append({"logical_slot": slot, "delta": delta})
            files.update({f"batch-{slot}/frozen-outcomes.json": raw, f"batch-{slot}/process.log": b"process",
                f"batch-{slot}/mutants.out/log/baseline.log": b"baseline", f"batch-{slot}/mutants.out/log/mutant.log": b"mutant",
                f"batch-{slot}/mutants.out/diff/mutant.diff": b"diff"})
        candidates = [native.identity_record_shape(record, identity, len(f.items)) for record in records for identity in manifest["mutations"]]
        expected_record = max(native.json_size(candidate) + 1 for candidate in candidates)
        expected_outcome = max(len(json.dumps(candidate["outcome"], indent=2, ensure_ascii=False).encode()) +
            4 * len(json.dumps(candidate["outcome"], indent=2, ensure_ascii=False).splitlines()) + 2 for candidate in candidates)
        shapes = native.raw_shape_budget(planned, records, batches, files)
        self.assertGreaterEqual(shapes["record_compact_bytes"], expected_record)
        self.assertGreaterEqual(shapes["outcome_pretty_bytes"], expected_outcome)
        policy = native.choose_batch_policy(planned, f.chain, records, batches, files)
        metrics = {"clone_setup_seconds": [1], "job_initial_setup_seconds": 1}
        projected = native.forecast(planned, f.chain, f.settings, records, metrics, batch_limit=policy["max_mutations"])
        policy["history_attempt_ceiling"] = projected["admitted_total_history_attempts"]
        seed = {"version": 1, "planned": planned, "chain": f.chain, "contract": f.base.contract,
            "originals": {}, "logs": {}, "source_runs": {}, "qualification": {"fixture_shape": True},
            "tool_receipt": f.base.receipt, "current_checkout": manifest["context"]["checkout"]}
        history = native.projected_history(planned, seed, records, projected, policy, [b"original producer"])
        shaped = [record for item in history["bundles"] for record in item["bundle"]["delta"]["records"]]
        self.assertEqual(len(shaped), 16)
        self.assertTrue(all(len(record["outcome"]["phase_results"]) == 2 for record in shaped))
        self.assertTrue(all(record["outcome"]["summary"] == "CaughtMutant" for record in shaped))
        return shapes, expected_record, expected_outcome

    def test_long_unviable_identity_cannot_hide_short_two_phase_payload(self):
        self.exercise(True)

    def test_homogeneous_two_phase_payload_remains_covered(self):
        self.exercise(False)

    def test_isolated_old_shape_selection_fails_mixed_case_but_preserves_valid_control(self):
        source = Path(native.__file__)
        original = source.read_bytes()
        controls = [('        for sample in records:', '        for sample in [max(records, key=json_size)]:'),
                    ('                for observed in records:\n                    shaped = identity_record_shape',
                     '                for observed in [max(records, key=json_size)]:\n                    shaped = identity_record_shape')]
        for old, new in controls:
            with self.subTest(guard=old), tempfile.TemporaryDirectory() as temporary:
                self.assertEqual(original.decode().count(old), 1)
                Path(temporary, source.name).write_bytes(original.decode().replace(old, new).encode())
                script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");sys.path.insert(0," + repr(temporary) + ");"
                    "s=unittest.defaultTestLoader.loadTestsFromNames(["
                    "'test_mutation_batch_budget.MixedPayloadEnvelopeTests.test_homogeneous_two_phase_payload_remains_covered',"
                    "'test_mutation_batch_budget.MixedPayloadEnvelopeTests.test_long_unviable_identity_cannot_hide_short_two_phase_payload']);"
                    "r=unittest.TextTestRunner().run(s);sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)



if __name__ == "__main__":
    unittest.main()
