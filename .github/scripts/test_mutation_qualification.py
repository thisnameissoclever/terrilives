"""End-to-end fixture proof authentication using committed bytes and raw deltas."""

import copy
import datetime as dt
import json
import unittest

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_qualification as qualification
import mutation_tool as tool
from test_mutation_artifacts import archive
from test_mutation_campaign import context, inventory, raw_report
import test_mutation_tool as tool_tests


class QualificationAuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tool_tests.ToolAuthenticationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.api = self.fixture.api
        self.now = self.fixture.now
        self.contract = self.fixture.contract
        self.api.responses["repos/owner/repo/actions/runs/100"]["run_attempt"] = 2
        ctx = context()
        ctx["checkout"] = copy.deepcopy(self.fixture.receipt["checkout"])
        ctx["inputs"].update(computation_scope="fixture", workflow_file_digest=self.contract["files"][tool.WORKFLOW],
            survivor_baseline_file_digest=artifacts.sha(b""),
            calibration_digest=model.digest({}), cargo_mutants_identity={"binary_sha256": self.fixture.reference["executable_sha256"],
                "authenticated_contract": {"recipe": self.contract}})
        items = inventory(24)
        self.manifest = model.build_manifest(items, ctx)
        self.artifacts = [self.fixture.artifact]
        self.jobs = {1: [self.fixture.job], 2: []}
        self.chain = {"version": 1, "max_attempts": 51, "retention_days": 30,
            "started_at": (self.now - dt.timedelta(hours=1)).isoformat(),
            "expires_at": (self.now - dt.timedelta(hours=1) + dt.timedelta(days=7)).isoformat(),
            "runs": [tool.entry_from_receipt(self.fixture.receipt)], "plan": {"run_id": "100", "attempt": 1, "artifact_id": 78}}
        producer = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "workflow_sha": "e" * 40,
            "run_id": "100", "attempt": 1, "job_id": "902", "slot": 0, "scope": "fixture", "checkout": ctx["checkout"],
            "input_fingerprint": self.manifest["input_fingerprint"], "campaign_id": self.manifest["campaign_id"], "log_retention_days": 30}
        plan = {"version": 1, "manifest": self.manifest, "calibration": {}, "producer": producer,
                "orchestration": {"tool": self.fixture.reference, "contract": self.contract, "log_retention_days": 30, "chain": self.chain}}
        raw = json.dumps(plan).encode()
        self.add_artifact(78, artifacts.plan_artifact_name("fixture", "100", 1), {"plan.json": raw},
            dict(producer, plan_digest=artifacts.sha(raw)), "MUTATION_PLAN", "mutation-fixture-plan")
        deltas = []
        by_name = {item["name"]: item for item in items}
        for slot in range(8):
            ids = model.slot_ids(self.manifest, slot)
            selected = [by_name[item["name"]] for item in self.manifest["mutations"] if item["id"] in ids]
            for attempt, batch, interrupted in ((1, selected[:1], True), (2, selected[1:], False)):
                report = raw_report(batch, interrupted=interrupted)
                raw = json.dumps(report).encode()
                provenance = {"repository": "owner/repo", "workflow": tool.WORKFLOW, "run_id": "100", "attempt": attempt,
                    "batch_id": f"batch-{slot}-{attempt}", "execution_id": f"exec-{slot}-{attempt}",
                    "checkout": ctx["checkout"], "input_fingerprint": self.manifest["input_fingerprint"]}
                delta = model.validate_report(self.manifest, slot, ids if interrupted else ids[1:], report,
                    provenance=provenance, raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw),
                    "content_digest": model.digest(report)}, exit_kind="interrupted" if interrupted else "completed")
                deltas.append(delta)
                artifact_id = 1000 + attempt * 10 + slot
                receipt = dict(provenance, workflow_sha="e" * 40, job_id=str(artifact_id), slot=slot,
                               campaign_id=self.manifest["campaign_id"], log_retention_days=30)
                bundle = {"version": 1, "manifest": self.manifest, "receipt": receipt, "delta": delta,
                    "status": {"state": "incomplete_with_progress" if interrupted else "complete",
                               "reason": "fixture_checkpoint" if interrupted else "exact_coverage",
                               "recorded_at": self.fixture.artifact["created_at"]}}
                files = {"bundle.json": json.dumps(bundle).encode(), "raw/outcomes.json": raw,
                    "evidence/log/baseline.log": b"baseline", "evidence/log/mutant.log": b"mutant", "evidence/diff/mutant.diff": b"diff"}
                self.add_artifact(artifact_id, artifacts.artifact_name(self.manifest["campaign_id"], "100", attempt, slot),
                                  files, receipt, "MUTATION_PRODUCER", "mutation-fixture-slot-" + str(slot))
        records = model.merge_deltas(self.manifest, deltas, allowed_run_ids={"100"}, current_run_id="100", current_attempt=2, include_current=True)
        summary = model.summarize(self.manifest, records, [])
        self.proof = {"version": 1, "repository": "owner/repo", "workflow": tool.WORKFLOW, "workflow_sha": "e" * 40,
            "head_sha": "d" * 40, "run_id": "100", "attempt": 2, "job_id": "999", "checkout": ctx["checkout"],
            "contract": self.contract, "chain": self.chain, "tool": self.fixture.reference, "log_retention_days": 30,
            "planned": summary["planned"], "completed": summary["completed"]}
        self.add_artifact(79, qualification.proof_name("100", 2), {"qualification.json": json.dumps(self.proof).encode()},
                          self.proof, "MUTATION_QUALIFICATION", "mutation-fixture-aggregate")
        for attempt, jobs in self.jobs.items():
            self.api.responses[f"repos/owner/repo/actions/runs/100/attempts/{attempt}"] = {
                "id": 100, "run_attempt": attempt, "head_sha": "d" * 40}
            self.api.responses[f"repos/owner/repo/actions/runs/100/attempts/{attempt}/jobs?per_page=100&page=1"] = {"jobs": jobs}
        self.api.responses["repos/owner/repo/actions/runs/100/artifacts?per_page=100&page=1"] = {"artifacts": self.artifacts}

    def add_artifact(self, artifact_id, name, files, receipt, marker, job_name):
        raw = archive(files)
        metadata = dict(self.fixture.artifact, id=artifact_id, name=name, digest="sha256:" + artifacts.sha(raw))
        self.artifacts.append(metadata)
        self.api.responses[f"repos/owner/repo/actions/artifacts/{artifact_id}"] = metadata
        self.api.blobs[f"repos/owner/repo/actions/artifacts/{artifact_id}/zip"] = raw
        self.api.blobs[f"repos/owner/repo/actions/jobs/{receipt['job_id']}/logs"] = (
            marker + " " + json.dumps(receipt) + f"\nMUTATION_ARTIFACT_ID={artifact_id}\n").encode()
        self.jobs[receipt["attempt"]].append(dict(self.fixture.job, id=int(receipt["job_id"]),
            run_attempt=receipt["attempt"], name=job_name,
            conclusion="failure" if marker == "MUTATION_PRODUCER" and receipt["attempt"] == 1 else "success"))

    def verify(self):
        return qualification.verify(self.api, "owner/repo", 79, self.contract, self.fixture.required)

    def test_authenticates_plan_raw_reports_all_slots_and_same_run_recovery(self):
        proof = self.verify()
        self.assertEqual(proof, self.proof)
        self.assertEqual(len(proof["completed"]), 24)
        self.assertIn("repos/owner/repo/actions/jobs/1010/logs", self.api.calls)
        self.assertIn("repos/owner/repo/actions/jobs/1027/logs", self.api.calls)

    def test_missing_prior_raw_evidence_cannot_be_replaced_by_proof_counters(self):
        raw = self.api.blobs["repos/owner/repo/actions/artifacts/1010/zip"]
        files = artifacts.unpack(raw)
        files["raw/outcomes.json"] = b"{}"
        raw = archive(files)
        metadata = self.api.responses["repos/owner/repo/actions/artifacts/1010"]
        metadata["digest"] = "sha256:" + artifacts.sha(raw)
        self.api.blobs["repos/owner/repo/actions/artifacts/1010/zip"] = raw
        with self.assertRaisesRegex(ValueError, "raw report digest"):
            self.verify()

    def test_wrong_event_repository_commit_helper_and_failed_producer_reject(self):
        cases = [("repos/owner/repo/actions/runs/100", "event", "pull_request", "manual fixture"),
                 ("repos/owner/repo/actions/runs/100", "repository", {"full_name": "foreign/repo"}, "foreign repository"),
                 ("repos/owner/repo/git/commits/" + "b" * 40, "sha", "f" * 40, "checkout commit/tree")]
        for path, key, changed, expected in cases:
            original = self.api.responses[path][key]
            self.api.responses[path][key] = changed
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, expected):
                self.verify()
            self.api.responses[path][key] = original
        self.jobs[2][-1]["conclusion"] = "failure"
        with self.assertRaisesRegex(ValueError, "producer did not pass"):
            self.verify()

    def test_retention_of_underlying_delta_matters_even_when_proof_is_fresh(self):
        self.api.responses["repos/owner/repo/actions/artifacts/1010"]["expires_at"] = (self.now + dt.timedelta(days=8)).isoformat()
        with self.assertRaisesRegex(ValueError, "artifact retention"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
