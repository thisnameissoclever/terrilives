"""Deterministic API and archive fixtures; no GitHub requests."""

import base64
import copy
import datetime as dt
import io
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile

import mutation_artifacts as artifacts
import mutation_campaign as model
from test_mutation_campaign import inventory, context, raw_report


def archive(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as zipped:
        for name, raw in files.items():
            zipped.writestr(name, raw)
    return stream.getvalue()


class FixtureAPI:
    def __init__(self):
        self.responses, self.blobs, self.calls = {}, {}, []

    def json(self, path):
        self.calls.append(path)
        return copy.deepcopy(self.responses[path])

    def bytes(self, path):
        self.calls.append(path)
        return self.blobs[path]

    def rate_status(self, required=0):
        self.calls.append("rate_limit")
        return {"resources": {"core": {"limit": 1000, "remaining": 1000, "reset": 2_000_000_000}}}


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 20, tzinfo=dt.timezone.utc)
        ctx = context()
        self.workflow = b"trusted workflow bytes"
        ctx["inputs"]["workflow_file_digest"] = artifacts.sha(self.workflow)
        self.items = inventory(17)
        self.manifest = model.build_manifest(self.items, ctx)
        self.entry = {"run_id": "100", "predecessor": None, "head_sha": "d" * 40,
                      "workflow_sha": "e" * 40, "commit": "b" * 40, "tree": "c" * 40,
                      "ref": "refs/heads/repair"}
        self.chain = {"version": 1, "max_attempts": 51, "retention_days": 30,
                      "started_at": "2026-10-19T00:00:00Z", "expires_at": "2026-11-10T00:00:00Z", "runs": [self.entry]}
        self.ids = model.slot_ids(self.manifest, 0)
        by_name = {item["name"]: item for item in self.items}
        selected = [by_name[item["name"]] for item in self.manifest["mutations"] if item["id"] in self.ids]
        raw = json.dumps(raw_report(selected)).encode()
        provenance = {"repository": "owner/repo", "workflow": ".github/workflows/ci.yml", "run_id": "100", "attempt": 1,
                      "batch_id": "batch", "execution_id": "execution", "checkout": ctx["checkout"],
                      "input_fingerprint": self.manifest["input_fingerprint"]}
        delta = model.validate_report(self.manifest, 0, self.ids, json.loads(raw), provenance=provenance,
            raw_report_ref={"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(json.loads(raw))},
            exit_kind="completed")
        self.receipt = {key: provenance[key] for key in ("repository", "workflow", "run_id", "attempt", "checkout", "input_fingerprint", "execution_id", "batch_id")}
        self.receipt.update(workflow_sha="e" * 40, job_id="901", slot=0, campaign_id=self.manifest["campaign_id"])
        self.bundle = {"version": 1, "receipt": self.receipt, "delta": delta, "manifest": self.manifest,
                       "status": {"state": "complete", "reason": "exact_coverage", "recorded_at": "2026-10-19T01:00:00Z"}}
        self.files = {"raw/outcomes.json": raw, "evidence/log/baseline.log": b"baseline", "evidence/log/mutant.log": b"mutant",
                      "evidence/diff/mutant.diff": b"diff"}
        self.metadata = {"id": 77, "name": artifacts.artifact_name(self.manifest["campaign_id"], "100", 1, 0),
                         "expired": False, "created_at": "2026-10-19T01:00:00Z", "expires_at": "2026-11-15T00:00:00Z",
                         "workflow_run": {"id": 100, "head_sha": "d" * 40}}
        self.api = FixtureAPI()
        p = "repos/owner/repo"
        self.run_path = p + "/actions/runs/100"
        self.api.responses[self.run_path] = {"id": 100, "repository": {"full_name": "owner/repo"},
            "head_repository": {"full_name": "owner/repo"}, "path": ".github/workflows/ci.yml", "head_sha": "d" * 40,
            "run_attempt": 2, "created_at": "2026-10-19T00:00:00Z"}
        self.api.responses[p + "/contents/.github/workflows/ci.yml?ref=" + "e" * 40] = {
            "encoding": "base64", "content": base64.b64encode(self.workflow).decode()}
        self.api.responses[p + "/git/commits/" + "b" * 40] = {"sha": "b" * 40, "tree": {"sha": "c" * 40}}
        self.api.responses[self.run_path + "/attempts/1"] = {"id": 100, "run_attempt": 1, "head_sha": "d" * 40}
        self.job = {"id": 901, "run_id": 100, "run_attempt": 1, "name": "mutation-slot-0",
                    "started_at": "2026-10-19T00:00:00Z", "completed_at": "2026-10-19T01:01:00Z"}
        self.api.responses[self.run_path + "/attempts/1/jobs?per_page=100&page=1"] = {"jobs": [self.job]}
        self.repack()

    def repack(self):
        self.files["bundle.json"] = json.dumps(self.bundle).encode()
        raw = archive(self.files)
        self.metadata["digest"] = "sha256:" + artifacts.sha(raw)
        self.api.blobs["repos/owner/repo/actions/artifacts/77/zip"] = raw
        self.api.responses[self.run_path + "/artifacts?per_page=100&page=1"] = {"artifacts": [self.metadata]}
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = (
            "2026-10-19T01:00:00Z MUTATION_PRODUCER " + json.dumps(self.receipt, sort_keys=True)
            + "\n2026-10-19T01:00:01Z MUTATION_ARTIFACT_ID=77\n").encode()

    def recover(self, **overrides):
        kwargs = {"current_run_id": "100", "current_attempt": 2, "now": self.now}
        kwargs.update(overrides)
        return artifacts.recover(self.api, self.manifest, self.chain, **kwargs)

    def test_valid_authenticated_recovery_and_all_api_pages(self):
        self.api.responses[self.run_path + "/artifacts?per_page=100&page=1"] = {"artifacts": [{"name": f"unrelated-{n}"} for n in range(100)]}
        self.api.responses[self.run_path + "/artifacts?per_page=100&page=2"] = {"artifacts": [self.metadata]}
        self.api.responses[self.run_path + "/attempts/1/jobs?per_page=100&page=1"] = {"jobs": [{"id": n} for n in range(100)]}
        self.api.responses[self.run_path + "/attempts/1/jobs?per_page=100&page=2"] = {"jobs": [self.job]}
        recovered = self.recover()
        self.assertEqual(len(recovered["records"]), len(self.ids))
        self.assertIn(self.run_path + "/artifacts?per_page=100&page=2", self.api.calls)
        self.assertIn(self.run_path + "/attempts/1/jobs?per_page=100&page=2", self.api.calls)

    def test_payload_cannot_replace_missing_producer_log(self):
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = b"MUTATION_ARTIFACT_ID=77\n"
        with self.assertRaisesRegex(ValueError, "receipt absent"):
            self.recover()

    def test_artifact_id_must_appear_in_same_producer_job(self):
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = ("MUTATION_PRODUCER " + json.dumps(self.receipt) + "\nMUTATION_ARTIFACT_ID=78\n").encode()
        with self.assertRaisesRegex(ValueError, "artifact ID absent"):
            self.recover()

    def test_producer_attempt_mismatch(self):
        self.job["run_attempt"] = 2
        with self.assertRaisesRegex(ValueError, "producer job mismatch"):
            self.recover()

    def test_api_attempt_mismatch(self):
        self.api.responses[self.run_path + "/attempts/1"]["run_attempt"] = 2
        with self.assertRaisesRegex(ValueError, "producer attempt mismatch"):
            self.recover()

    def test_wrong_producer_job_name(self):
        self.job["name"] = "mutation-fixture-slot-0"
        with self.assertRaisesRegex(ValueError, "producer job mismatch"):
            self.recover()

    def test_predecessor_cycle_is_rejected(self):
        self.entry["predecessor"] = "100"
        with self.assertRaisesRegex(ValueError, "cycle"):
            self.recover()

    def test_unrelated_predecessor_run_is_rejected(self):
        self.chain["runs"].append(dict(self.entry, run_id="99"))
        with self.assertRaisesRegex(ValueError, "unrelated"):
            self.recover()

    def test_missing_predecessor_is_rejected(self):
        self.entry["predecessor"] = "99"
        with self.assertRaisesRegex(ValueError, "missing predecessor"):
            self.recover()

    def test_expired_evidence_is_rejected(self):
        self.metadata["expired"] = True
        with self.assertRaisesRegex(ValueError, "expired artifact"):
            self.recover()

    def test_expired_campaign_is_rejected(self):
        self.chain["expires_at"] = "2026-10-19T23:59:00Z"
        with self.assertRaisesRegex(ValueError, "campaign lifetime"):
            self.recover()

    def test_byte_digest_corruption_is_rejected(self):
        self.metadata["digest"] = "sha256:" + "f" * 64
        with self.assertRaisesRegex(ValueError, "artifact byte digest"):
            self.recover()

    def test_raw_report_digest_corruption_is_rejected(self):
        self.files["raw/outcomes.json"] += b" "
        self.repack()
        with self.assertRaisesRegex(ValueError, "raw report digest"):
            self.recover()

    def test_wrong_artifact_name_is_rejected(self):
        self.metadata["name"] += "-wrong"
        with self.assertRaisesRegex(ValueError, "immutable artifact name"):
            self.recover()

    def test_foreign_fingerprint_is_rejected(self):
        self.receipt["input_fingerprint"] = "f" * 64
        self.repack()
        with self.assertRaisesRegex(ValueError, "foreign fingerprint"):
            self.recover()

    def test_wrong_checkout_tree_is_rejected(self):
        self.api.responses["repos/owner/repo/git/commits/" + "b" * 40]["tree"]["sha"] = "f" * 40
        with self.assertRaisesRegex(ValueError, "checkout commit/tree"):
            self.recover()

    def test_wrong_workflow_version_is_rejected(self):
        self.api.responses["repos/owner/repo/contents/.github/workflows/ci.yml?ref=" + "e" * 40]["content"] = base64.b64encode(b"different").decode()
        with self.assertRaisesRegex(ValueError, "workflow version"):
            self.recover()

    def test_current_attempt_is_excluded_from_resume(self):
        self.assertEqual(self.recover(current_attempt=1)["records"], [])
        self.assertEqual(len(self.recover(current_attempt=1, include_current=True)["records"]), len(self.ids))

    def test_future_attempt_is_rejected_with_other_fields_consistent(self):
        self.receipt["attempt"] = 2
        previous = self.bundle["delta"]
        self.bundle["delta"] = model.validate_report(self.manifest, 0, self.ids,
            json.loads(self.files["raw/outcomes.json"]), provenance=dict(previous["provenance"], attempt=2),
            raw_report_ref=previous["raw_report_ref"], exit_kind="completed")
        self.metadata["name"] = artifacts.artifact_name(self.manifest["campaign_id"], "100", 2, 0)
        self.job["run_attempt"] = 2
        self.api.responses[self.run_path + "/attempts/2"] = {"id": 100, "run_attempt": 2, "head_sha": "d" * 40}
        self.api.responses[self.run_path + "/attempts/2/jobs?per_page=100&page=1"] = {"jobs": [self.job]}
        self.repack()
        self.assertRaisesRegex(ValueError, "future artifact attempt", self.recover, current_attempt=1)

    def test_missing_predecessor_artifacts_are_rejected(self):
        previous = dict(self.entry, run_id="99")
        self.entry["predecessor"] = "99"
        self.chain["runs"].insert(0, previous)
        previous_path = "repos/owner/repo/actions/runs/99"
        self.api.responses[previous_path] = dict(self.api.responses[self.run_path], id=99)
        self.api.responses[previous_path + "/artifacts?per_page=100&page=1"] = {"artifacts": []}
        with self.assertRaisesRegex(ValueError, "missing predecessor evidence"):
            self.recover()

    def test_missing_referenced_evidence_is_rejected(self):
        del self.files["evidence/diff/mutant.diff"]
        self.repack()
        with self.assertRaisesRegex(ValueError, "missing referenced"):
            self.recover()

    def test_contradictory_payload_cannot_override_raw_report(self):
        self.bundle["delta"]["records"][0]["outcome"]["summary"] = "MissedMutant"
        self.repack()
        with self.assertRaisesRegex(ValueError, "authenticated raw report"):
            self.recover()

    def test_unsafe_archive_paths_links_duplicates_and_sizes(self):
        for path in ("../escape", "/absolute", "C:/absolute", "a/./b"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "unsafe archive path"):
                artifacts.unpack(archive({path: b"data"}))
        with self.assertRaisesRegex(ValueError, "unsafe archive path"):
            artifacts.unpack(archive({"a/b": b"data"}).replace(b"a/b", b"a\\b"))
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as zipped:
            info = zipfile.ZipInfo("link")
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
            zipped.writestr(info, "target")
        with self.assertRaisesRegex(ValueError, "nonregular"):
            artifacts.unpack(stream.getvalue())
        stream = io.BytesIO()
        with warnings.catch_warnings(), zipfile.ZipFile(stream, "w") as zipped:
            warnings.simplefilter("ignore", UserWarning)
            zipped.writestr("same", b"1")
            zipped.writestr("same", b"2")
        with self.assertRaisesRegex(ValueError, "duplicate archive"):
            artifacts.unpack(stream.getvalue())

    def test_duplicate_json_keys_and_nonfinite_numbers(self):
        for raw in ('{"key":1,"key":2}', '{"value":NaN}'):
            with self.assertRaises(ValueError):
                artifacts.strict_json(raw)

    def prepare_plan(self):
        calibration = {"measured": "fixture"}
        ctx = copy.deepcopy(self.manifest["context"])
        ctx["inputs"].update(computation_scope="production", calibration_digest=model.digest(calibration))
        manifest = model.build_manifest(self.items, ctx)
        producer = dict(self.receipt, scope="production", input_fingerprint=manifest["input_fingerprint"], campaign_id=manifest["campaign_id"])
        planned = {"version": 1, "manifest": manifest, "calibration": calibration, "capacity": {"admit": True}, "producer": producer}
        raw_plan = json.dumps(planned).encode()
        raw_archive = archive({"plan.json": raw_plan})
        self.metadata.update(name=artifacts.plan_artifact_name("production", "100", 1), digest="sha256:" + artifacts.sha(raw_archive))
        self.api.responses["repos/owner/repo/actions/artifacts/77"] = self.metadata
        self.api.blobs["repos/owner/repo/actions/artifacts/77/zip"] = raw_archive
        self.job["name"] = "mutation-plan"
        self.chain["plan"] = {"run_id": "100", "attempt": 1, "artifact_id": 77}
        receipt = dict(producer, plan_digest=artifacts.sha(raw_plan))
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = (
            "MUTATION_PLAN " + json.dumps(receipt) + "\nMUTATION_ARTIFACT_ID=77\n").encode()
        return planned

    def recover_plan(self):
        return artifacts.recover_plan(self.api, self.chain, current_run_id="100", current_attempt=2,
            repository="owner/repo", workflow=".github/workflows/ci.yml", workflow_digest=artifacts.sha(self.workflow),
            scope="production", now=self.now)

    def test_original_plan_bootstrap_authenticates_job_and_bytes(self):
        planned = self.prepare_plan()
        self.assertEqual(self.recover_plan(), planned)

    def test_plan_payload_cannot_self_attest(self):
        self.prepare_plan()
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = b"MUTATION_ARTIFACT_ID=77\n"
        with self.assertRaisesRegex(ValueError, "receipt absent"):
            self.recover_plan()

    def test_plan_digest_change_is_rejected_even_when_zip_digest_is_updated(self):
        planned = self.prepare_plan()
        planned["capacity"]["admit"] = False
        raw = archive({"plan.json": json.dumps(planned).encode()})
        self.metadata["digest"] = "sha256:" + artifacts.sha(raw)
        self.api.blobs["repos/owner/repo/actions/artifacts/77/zip"] = raw
        with self.assertRaisesRegex(ValueError, "receipt absent"):
            self.recover_plan()

    def test_selected_guards_detect_isolated_removals(self):
        source_dir = Path(__file__).parent
        before = {name: (source_dir / name).read_bytes() for name in
                  ("mutation_artifacts.py", "mutation_campaign.py", "test_mutation_artifacts.py", "test_mutation_campaign.py")}
        controls = [
            ('require(artifact.get("digest") == "sha256:" + sha(raw), "artifact byte digest mismatch")',
             'require(True, "artifact byte digest mismatch")', "test_byte_digest_corruption_is_rejected"),
            ('sha(raw) == reference["digest"]', 'True', "test_raw_report_digest_corruption_is_rejected"),
            ('receipt in receipts', 'True', "test_payload_cannot_replace_missing_producer_log"),
            ('            safe_path(member.orig_filename)\n            safe_path(member.filename)\n', '',
             "test_unsafe_archive_paths_links_duplicates_and_sizes"),
        ]
        for old, new, test in controls:
            with self.subTest(control=test), tempfile.TemporaryDirectory(prefix="artifact-guard-control-") as directory:
                directory = Path(directory)
                for name, raw in before.items():
                    (directory / name).write_bytes(raw)
                source = before["mutation_artifacts.py"].decode()
                self.assertEqual(source.count(old), 1)
                (directory / "mutation_artifacts.py").write_text(source.replace(old, new), encoding="utf-8")
                result = subprocess.run([sys.executable, "-B", "-m", "unittest", "test_mutation_artifacts.ArtifactTests." + test],
                                        cwd=directory, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("FAIL: " + test, result.stderr)
                self.assertNotIn("ERROR:", result.stderr)
        self.assertEqual(before, {name: (source_dir / name).read_bytes() for name in before})


if __name__ == "__main__":
    unittest.main()
