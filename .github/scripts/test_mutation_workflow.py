"""Small integration fixtures for bounded discovery and immutable workflow recovery."""

import copy
import contextlib
import datetime as dt
import json
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_qualification as qualification
import mutation_recovery as recovery
import mutation_runner as runner
import mutation_tool as tool
import mutation_workflow as workflow
from test_mutation_artifacts import FixtureAPI
from test_mutation_campaign import context, inventory, raw_report, report_ref
import test_mutation_qualification as qualification_tests


class ToolTransportPreflightTests(unittest.TestCase):
    def exercise(self, historical=False, bad=False):
        api = FixtureAPI()
        now = dt.datetime.now(dt.timezone.utc)
        completed = (now - dt.timedelta(minutes=2)).isoformat()
        started = (now - dt.timedelta(minutes=3)).isoformat()
        changes = {"id": 900, "run_id": 100, "run_attempt": 1, "name": "changes", "status": "completed",
                   "conclusion": "success", "started_at": started, "completed_at": completed}
        current = dict(changes, id=901, run_attempt=2, name="mutation-fixture-tool", status="in_progress",
                       conclusion=None, started_at=now.isoformat(), completed_at=None)
        if bad:
            changes["status"] = "in_progress"
        api.responses["repos/owner/repo/actions/runs/100"] = {"id": 100, "repository": {"full_name": "owner/repo"},
            "head_repository": {"full_name": "owner/repo"}, "path": tool.WORKFLOW, "head_sha": "d" * 40}
        api.responses["repos/owner/repo/actions/runs/100/jobs?filter=latest&per_page=100&page=1"] = {"jobs": [changes, current], "total_count": 2}
        api.responses["repos/owner/repo/actions/jobs/902"] = dict(changes, id=902, run_id=99, status="completed",
            url="https://api.github.com/repos/owner/repo/actions/jobs/902", run_url="https://api.github.com/repos/owner/repo/actions/runs/99")
        env = {"GITHUB_REPOSITORY": "owner/repo", "GITHUB_RUN_ID": "100", "GITHUB_RUN_ATTEMPT": "2",
               "GITHUB_WORKFLOW_SHA": "e" * 40, "GITHUB_RETENTION_DAYS": "30", "ImageOS": "ubuntu24", "ImageVersion": "test",
               "GH_TOKEN": "private-token", "TRANSPORT_PROBE_JOB_ID": "902" if historical else ""}
        opener = mock.Mock()
        def response(*args, **kwargs):
            result = mock.MagicMock(status=302, headers={"Location": "https://logs.example/signed?private=value"})
            result.__enter__.return_value = result
            return result
        opener.open.side_effect = response
        wrapper = recovery.WorkflowAPI(api)
        captured = io.StringIO()
        with mock.patch.dict(os.environ, env), mock.patch.object(recovery.urllib.request, "build_opener", return_value=opener), \
                contextlib.redirect_stdout(captured), mock.patch.object(tool, "build") as build:
            settings = workflow.current_settings(wrapper, Path.cwd(), "fixture", "mutation-fixture-tool", 0)
            if bad:
                with self.assertRaisesRegex(ValueError, "completed execution"):
                    workflow.prepare_tool(wrapper, Path.cwd(), settings, Path.cwd())
                build.assert_not_called()
                return
            result = workflow.tool_transport_preflight(wrapper, settings)
        self.assertEqual(result["requests"], 7 if historical else 5)
        self.assertEqual(result["current"]["run_attempt"], 1)
        self.assertEqual(result["historical_coverage"], "completed_job_redirect" if historical else "absent")
        self.assertEqual(opener.open.call_count, 2 if historical else 1)
        self.assertNotIn("private", captured.getvalue())

    def test_empty_input_records_five_calls_and_no_historical_claim(self):
        self.exercise()

    def test_historical_input_records_seven_calls_with_same_token(self):
        self.exercise(historical=True)

    def test_failed_preflight_cannot_reach_cargo(self):
        self.exercise(bad=True)

    def test_first_fixture_preparation_retains_plan_before_job_availability(self):
        from test_mutation_recovery import SnapshotFixture

        f = SnapshotFixture(self)
        (f.root / tool.WORKFLOW).parent.mkdir(parents=True, exist_ok=True)
        (f.root / tool.WORKFLOW).write_bytes((Path(__file__).resolve().parents[2] / tool.WORKFLOW).read_bytes())
        f.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 1
        prefix = "mutation-" + f.q.manifest["campaign_id"] + "-"
        f.q.artifacts[:] = [row for row in f.q.artifacts if not row["name"].startswith(prefix)]
        jobs = f.api.responses["repos/owner/repo/actions/runs/100/attempts/1/jobs?per_page=100&page=1"]["jobs"]
        jobs[:] = [row for row in jobs if "slot-" not in row["name"]]
        f.paginate()
        settings = dict(f.settings, attempt=1, job_id="9900")
        actual = tool.authenticate
        def authenticate(*args, **kwargs):
            return actual(*args, **kwargs, runtime=lambda *unused: f.q.fixture.runtime)
        with mock.patch.dict(os.environ, {"MUTATION_CHAIN": json.dumps(f.data["chain"]), "PLAN_ARTIFACT_ID": "78"}), \
                mock.patch.object(tool, "committed_contract", return_value=f.contract), \
                mock.patch.object(tool, "authenticate", side_effect=authenticate), \
                mock.patch.object(runner, "checkout_inventory", return_value=(f.q.manifest["context"]["checkout"], {})), \
                mock.patch.object(runner, "validate_current_plan", return_value=f.q.manifest["context"]):
            data, recovered = workflow.refresh_recovery(recovery.WorkflowAPI(f.api), f.root, settings,
                Path(f.q.fixture.temp.name) / "first-preparation", include_current=False)
        self.assertEqual(recovered["records"], [])
        self.assertIn("78", data["originals"])
        self.assertEqual(data["log_availability_anchors"]["100"]["job"]["id"], 901)
        self.assertFalse(any("actions/runs/100/logs" in path for path in f.api.calls))


def recovery_fixture():
    ctx = context()
    ctx["inputs"]["computation_scope"] = "fixture"
    items = inventory(24)
    manifest = model.build_manifest(items, ctx)
    by_name = {item["name"]: item for item in items}
    deltas, bundles = [], []
    for slot in range(8):
        ids = model.slot_ids(manifest, slot)
        selected = [by_name[item["name"]] for item in manifest["mutations"] if item["id"] in ids]
        for attempt, batch, interrupted in ((1, selected[:1], True), (2, selected[1:], False)):
            batch_ids = ids if interrupted else ids[1:]
            provenance = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "run_id": "100", "attempt": attempt,
                "batch_id": f"batch-{slot}-{attempt}", "execution_id": f"exec-{slot}-{attempt}",
                "checkout": ctx["checkout"], "input_fingerprint": manifest["input_fingerprint"]}
            report = raw_report(batch, interrupted=interrupted)
            delta = model.validate_report(manifest, slot, batch_ids, report, provenance=provenance,
                raw_report_ref=report_ref(report), exit_kind="interrupted" if interrupted else "completed")
            deltas.append(delta)
            bundles.append({"receipt": {"run_id": "100", "attempt": attempt, "slot": slot}, "delta": delta,
                "status": {"state": "incomplete_with_progress" if interrupted else "complete",
                           "reason": "fixture_checkpoint" if interrupted else "exact_coverage"}})
    records = model.merge_deltas(manifest, deltas, allowed_run_ids={"100"}, current_run_id="100", current_attempt=2, include_current=True)
    return manifest, {"records": records, "deltas": deltas, "bundles": bundles}


class QualificationTests(unittest.TestCase):
    def test_exact_fixture_coverage_requires_actual_interruption_and_resumed_execution(self):
        manifest, recovered = recovery_fixture()
        summary = qualification.validate_recovery(manifest, recovered, "100", 2)
        self.assertEqual(summary["planned"], summary["completed"])
        for change, message in (("missing", "incomplete"), ("no_interruption", "interruption"), ("no_resume", "resumed pending")):
            changed = copy.deepcopy(recovered)
            if change == "missing":
                changed["records"].pop()
            elif change == "no_interruption":
                changed["bundles"] = [bundle for bundle in changed["bundles"] if bundle["receipt"]["attempt"] == 2]
            else:
                changed["bundles"] = [bundle for bundle in changed["bundles"] if bundle["receipt"]["attempt"] == 1]
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, message):
                qualification.validate_recovery(manifest, changed, "100", 2)

    def test_production_coverage_cannot_be_fixture_qualification(self):
        manifest, recovered = recovery_fixture()
        manifest["context"]["inputs"]["computation_scope"] = "production"
        with self.assertRaisesRegex(ValueError, "not fixture"):
            qualification.validate_recovery(manifest, recovered, "100", 2)

    def test_complete_identity_coverage_cannot_hide_prior_terminal_failure(self):
        manifest, recovered = recovery_fixture()
        recovered["bundles"].append({"status": {"state": "infrastructure_failure"}})
        with self.assertRaisesRegex(ValueError, "terminal prior failure"):
            qualification.validate_recovery(manifest, recovered, "100", 2)

    def test_missing_qualification_explains_the_real_setup_and_resume_procedure(self):
        api = FixtureAPI()
        runs = "repos/owner/repo/actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=30"
        listing = "repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"
        api.responses[runs] = {"workflow_runs": [{"id": 100, "event": "workflow_dispatch", "path": tool.WORKFLOW}]}
        api.responses[listing] = {"artifacts": []}
        with self.assertRaises(ValueError) as failure:
            qualification.discover(api, "owner/repo", {}, dt.datetime.now(dt.timezone.utc))
        message = str(failure.exception)
        self.assertIn("no authenticated", message)
        self.assertIn("complete a fixture run", message)
        self.assertIn("rerun its successful preparation job", message)
        self.assertIn("docs/mutation-campaign.md", message)
        self.assertEqual(api.calls, [runs, listing])

    def test_discovery_is_read_only_bounded_and_ignores_convincing_unrelated_names(self):
        api = FixtureAPI()
        base = "repos/owner/repo/actions/workflows/ci.yml/runs?event=workflow_dispatch&per_page=30"
        api.responses[base] = {"workflow_runs": [{"id": 100, "event": "workflow_dispatch", "path": tool.WORKFLOW}]}
        path = "repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"
        api.responses[path] = {"artifacts": [{"id": 9, "name": "mutation-fixture-qualification-run-999-attempt-2"},
            {"id": 10, "name": "mutation-fixture-qualification-run-100-attempt-2", "digest": "sha256:proof"}]}
        contract = {"independent": "contract"}
        until = dt.datetime.now(dt.timezone.utc)
        with mock.patch.object(qualification, "verify", return_value={"tool": "fixed"}) as verify:
            reference, proof = qualification.discover(api, "owner/repo", contract, until)
            self.assertEqual(reference["artifact_id"], 10)
            verify.assert_called_once_with(api, "owner/repo", 10, contract, until)
        api.responses[path] = {"artifacts": [{"id": 9, "name": "mutation-fixture-qualification-run-999-attempt-2"}]}
        with self.assertRaisesRegex(ValueError, "no authenticated"):
            qualification.discover(api, "owner/repo", contract, until)
        for page in range(1, 4):
            api.responses[path.rsplit("page=", 1)[0] + f"page={page}"] = {"artifacts": [{"name": "irrelevant"}] * 100}
        with self.assertRaisesRegex(ValueError, "bounded pages"):
            qualification.discover(api, "owner/repo", contract, until)
        self.assertFalse(any("page=4" in call for call in api.calls))

    def test_explicit_candidate_still_requires_all_authentication(self):
        api = FixtureAPI()
        api.responses["repos/owner/repo/actions/runs/100"] = {"id": 100, "event": "workflow_dispatch", "path": tool.WORKFLOW}
        api.responses["repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"] = {
            "artifacts": [{"id": 10, "name": "mutation-fixture-qualification-run-100-attempt-2"}]}
        for failure in ("wrong repository", "changed workflow", "changed helper", "expired evidence", "no recovery proof"):
            with self.subTest(failure=failure), mock.patch.object(qualification, "verify", side_effect=ValueError(failure)):
                with self.assertRaisesRegex(ValueError, failure):
                    qualification.discover(api, "owner/repo", {}, dt.datetime.now(dt.timezone.utc), "100")


class WorkflowIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime.now(dt.timezone.utc)
        self.entry = {"run_id": "100", "predecessor": None, "head_sha": "a" * 40, "workflow_sha": "b" * 40,
                      "commit": "c" * 40, "tree": "d" * 40, "ref": "HEAD"}
        self.chain = {"version": 1, "max_attempts": 51, "retention_days": 30,
                      "started_at": self.now.isoformat(), "expires_at": (self.now + dt.timedelta(days=7)).isoformat(),
                      "runs": [self.entry], "plan": {"run_id": "100", "attempt": 1, "artifact_id": 77}}

    def test_explicit_continuation_preserves_plan_expiry_caps_and_stops_changed_heads(self):
        next_entry = dict(self.entry, run_id="200")
        changed = workflow.extend_chain(self.chain, next_entry, "100")
        self.assertEqual(changed["plan"], self.chain["plan"])
        self.assertEqual(changed["expires_at"], self.chain["expires_at"])
        self.assertEqual(changed["runs"][-1]["predecessor"], "100")
        with self.assertRaisesRegex(ValueError, "changed head"):
            workflow.extend_chain(self.chain, dict(next_entry, head_sha="e" * 40), "100")
        with self.assertRaisesRegex(ValueError, "predecessor mismatch"):
            workflow.extend_chain(self.chain, next_entry, "99")
        expired = dict(self.chain, expires_at=(self.now - dt.timedelta(seconds=1)).isoformat())
        with self.assertRaisesRegex(ValueError, "expired"):
            workflow.extend_chain(expired, next_entry, "100")

    def test_plan_recovery_cannot_recalibrate_or_replace_tool(self):
        settings = {"scope": "production", "repository": "owner/repo", "run_id": "100", "attempt": 2}
        planned = {"orchestration": {"tool": {"executable_sha256": "fixed"}, "contract": {"fixed": True}},
                   "calibration": {"test_cap_seconds": 317}}
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ, {
            "RESUME_CHAIN": "", "RESUME_RUN_ID": "", "RESUME_PLAN_ARTIFACT_ID": ""}), \
            mock.patch.object(workflow, "original_plan_reference", return_value=self.chain["plan"]), \
            mock.patch.object(workflow, "load_plan", return_value=(planned, self.chain)), \
            mock.patch.object(workflow, "check_qualification") as qualification_check, \
            mock.patch.object(workflow, "bind_tool") as bind, mock.patch.object(workflow, "output"), \
            mock.patch.object(runner, "validate_current_plan") as validate, \
            mock.patch.object(runner, "calibrate", side_effect=AssertionError("must not recalibrate")):
            workflow.prepare_plan(FixtureAPI(), Path(temporary), settings, Path(temporary))
            self.assertEqual(bind.call_args.args[3], planned["orchestration"]["tool"])
            validate.assert_called_once_with(Path(temporary), planned, settings)
            qualification_check.assert_called_once()

    def test_aggregate_requires_current_refresh_even_with_complete_predecessor(self):
        settings = {"scope": "production", "run_id": "100", "attempt": 2, "slot": 0, "repository": "owner/repo"}
        with tempfile.TemporaryDirectory() as temporary, \
            mock.patch.object(workflow, "refresh_recovery", side_effect=ValueError("current source invalid")) as refresh, \
            mock.patch.object(runner, "aggregate") as aggregate:
            with self.assertRaisesRegex(ValueError, "current source invalid"):
                workflow.execute(FixtureAPI(), Path(temporary), settings, Path(temporary), "aggregate")
            self.assertTrue(refresh.call_args.kwargs["include_current"])
            aggregate.assert_not_called()

    def test_prior_failed_worker_without_bundle_cannot_vanish_on_rerun(self):
        api = FixtureAPI()
        api.responses["repos/owner/repo/actions/runs/100"] = {"run_attempt": 2}
        api.responses["repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"] = {"artifacts": []}
        job = {"name": "mutation-slot-0", "started_at": self.now.isoformat(), "conclusion": "failure"}
        api.responses["repos/owner/repo/actions/runs/100/attempts/1/jobs?per_page=100&page=1"] = {"jobs": [job]}
        settings = {"repository": "owner/repo", "run_id": "100", "attempt": 2, "scope": "production"}
        with self.assertRaisesRegex(ValueError, "prior worker missing"):
            workflow.require_prior_worker_evidence(api, settings, {"campaign_id": "fixed"}, self.chain)
        api.responses["repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"] = {
            "artifacts": [{"name": artifacts.artifact_name("fixed", "100", 1, 0)}]}
        workflow.require_prior_worker_evidence(api, settings, {"campaign_id": "fixed"}, self.chain)


class IntegrationFaultControls(unittest.TestCase):
    def test_missing_identity_and_changed_head_guards_have_isolated_controls(self):
        controls = [(qualification, 'summary["complete"] and not summary["failing"] and summary["planned"]', 'True',
                     'QualificationTests.test_exact_fixture_coverage_requires_actual_interruption_and_resumed_execution'),
                    (workflow, 'all(item["head_sha"] == entry["head_sha"] for item in chain["runs"])', 'True',
                     'WorkflowIntegrationTests.test_explicit_continuation_preserves_plan_expiry_caps_and_stops_changed_heads')]
        for module, old, replacement, test in controls:
            source = Path(module.__file__)
            original = source.read_bytes()
            with self.subTest(test=test), tempfile.TemporaryDirectory() as temporary:
                changed = original.decode().replace(old, replacement)
                self.assertNotEqual(changed, original.decode())
                Path(temporary, source.name).write_text(changed, encoding="utf-8")
                script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                    "sys.path.insert(0," + repr(temporary) + ");"
                    "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(" + repr("test_mutation_workflow." + test) + "));"
                    "sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(source.read_bytes(), original)


class OriginalPlanPolicyTests(unittest.TestCase):
    def setUp(self):
        self.q = qualification_tests.QualificationAuthenticationTests()
        self.q.setUp()
        self.addCleanup(self.q.doCleanups)
        self.root = self.q.fixture.root
        path = self.root / tool.WORKFLOW
        path.parent.mkdir(parents=True)
        path.write_bytes((Path(__file__).resolve().parents[2] / tool.WORKFLOW).read_bytes())
        self.settings = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "scope": "fixture",
                         "run_id": "100", "attempt": 2}
        self.chain = copy.deepcopy(self.q.chain)

    def load(self, chain=None, *, settings=None):
        chain = copy.deepcopy(self.chain if chain is None else chain)
        settings = settings or self.settings
        current = next(item for item in chain["runs"] if item["run_id"] == settings["run_id"])
        with mock.patch.object(tool, "committed_contract", return_value=self.q.contract), \
             mock.patch.object(workflow, "current_entry", return_value=current):
            return workflow.load_plan(self.q.api, self.root, settings, chain["plan"], chain)

    def test_authenticated_plan_rejects_extended_expiry_without_any_snapshot(self):
        planned, chain = self.load()
        self.assertEqual(chain["expires_at"], planned["orchestration"]["chain"]["expires_at"])
        changed = copy.deepcopy(self.chain)
        changed["expires_at"] = (artifacts.timestamp(changed["expires_at"]) + dt.timedelta(days=7)).isoformat()
        with self.assertRaisesRegex(ValueError, "campaign policy differs from original plan: expires_at"):
            self.load(changed)
        self.assertIn("repos/owner/repo/actions/jobs/902/logs", self.q.api.calls)
        self.assertIn("repos/owner/repo/actions/artifacts/78/zip", self.q.api.calls)

    def test_authenticated_plan_rejects_changed_start_attempts_and_retention(self):
        values = {"started_at": (artifacts.timestamp(self.chain["started_at"]) - dt.timedelta(hours=1)).isoformat(),
                  "max_attempts": 50, "retention_days": 31}
        for key, value in values.items():
            changed = copy.deepcopy(self.chain)
            changed[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "campaign policy differs from original plan: " + key):
                self.load(changed)

    def test_authenticated_plan_permits_only_ordered_append_with_original_limits(self):
        changed = copy.deepcopy(self.chain)
        changed["runs"][0]["sealed_attempt"] = 2
        changed["runs"].append(dict(self.chain["runs"][0], run_id="200", predecessor="100"))
        self.q.api.responses["repos/owner/repo/actions/runs/200"] = dict(
            self.q.api.responses["repos/owner/repo/actions/runs/100"], id=200, run_attempt=1)
        self.q.api.responses["repos/owner/repo/actions/runs/200/artifacts?per_page=100&page=1"] = {"artifacts": []}
        planned, loaded = self.load(changed, settings=dict(self.settings, run_id="200", attempt=1))
        self.assertEqual(len(loaded["runs"]), 2)
        for key in ("started_at", "expires_at", "max_attempts", "retention_days"):
            self.assertEqual(loaded[key], planned["orchestration"]["chain"][key])
        for changed_field in ("commit", "tree", "ref"):
            bad = copy.deepcopy(loaded)
            bad["runs"][0][changed_field] += "changed"
            with self.subTest(changed_field=changed_field), self.assertRaisesRegex(ValueError, "original run-chain entry changed"):
                workflow.bind_chain_to_plan(planned, bad)

    def test_fixed_policy_is_checked_even_when_original_and_supplied_are_equally_wrong(self):
        planned, chain = self.load()
        for key, value in (("max_attempts", 50), ("retention_days", 31),
                           ("expires_at", (artifacts.timestamp(chain["expires_at"]) + dt.timedelta(days=1)).isoformat())):
            altered_plan, altered_chain = copy.deepcopy(planned), copy.deepcopy(chain)
            altered_plan["orchestration"]["chain"][key] = altered_chain[key] = value
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "original plan violates fixed campaign policy"):
                workflow.bind_chain_to_plan(altered_plan, altered_chain)

    def test_isolated_original_policy_guard_removal_fails_expiry_assertion(self):
        source = Path(workflow.__file__)
        original = source.read_bytes()
        text = original.decode().replace("\r\n", "\n")
        old = "    bind_chain_to_plan(planned, chain)\n"
        self.assertEqual(text.count(old), 1)
        with tempfile.TemporaryDirectory() as temporary:
            Path(temporary, source.name).write_text(text.replace(old, ""), encoding="utf-8")
            script = ("import sys,unittest;sys.path.insert(0," + repr(str(source.parent)) + ");"
                "sys.path.insert(0," + repr(temporary) + ");"
                "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName("
                "'test_mutation_workflow.OriginalPlanPolicyTests.test_authenticated_plan_rejects_extended_expiry_without_any_snapshot'));"
                "sys.exit(0 if len(r.failures)==1 and not r.errors else 1)")
            result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
