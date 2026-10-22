"""Publication package provenance and byte-integrity controls, without network access."""

import copy
import datetime as dt
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile

import mutation_artifacts as transport
import pages_artifact as package


SHA = "a" * 40
REPOSITORY = "owner/repo"
RUN = "123"
NOW = dt.datetime(2026, 10, 22, tzinfo=dt.timezone.utc)
FILES = {"package.json": b'{"name":"terri-wasm"}', "terri_wasm.js": b"export default function init() {}",
         "terri_wasm_bg.wasm": b"\x00asm\x01\x00\x00\x00", "terri_wasm.d.ts": b"export {};",
         "terri_wasm_bg.wasm.d.ts": b"export {};", "snippets/example.js": b"export const example = 1;"}


def archive(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as zipped:
        for name, raw in files.items():
            zipped.writestr(name, raw)
    return stream.getvalue()


class API:
    def __init__(self, receipt):
        run = {"id": 123, "repository": {"full_name": REPOSITORY},
               "head_repository": {"full_name": REPOSITORY}, "path": ".github/workflows/ci.yml",
               "head_sha": SHA, "head_branch": "main", "event": "push", "status": "completed",
               "conclusion": "success", "run_attempt": 2}
        self.artifact = {"id": 901, "name": f"tested-wasm-{SHA}-attempt-2", "expired": False,
                         "created_at": "2026-10-21T12:05:00Z", "expires_at": "2026-10-28T12:05:00Z",
                         "workflow_run": {"id": 123, "head_sha": SHA, "head_branch": "main"}}
        self.responses = {f"repos/{REPOSITORY}/actions/runs/{RUN}": run,
                          f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2": copy.deepcopy(run),
                          f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2/jobs?per_page=100&page=1": {
                              "jobs": [{"id": 77, "run_id": 123, "run_attempt": 2, "head_sha": SHA,
                                        "name": "web", "status": "completed", "conclusion": "success",
                                        "created_at": "2026-10-21T11:59:00Z",
                                        "started_at": "2026-10-21T12:00:00Z", "completed_at": "2026-10-21T12:10:00Z",
                                        "steps": [{"number": 1, "name": "Test", "status": "completed", "conclusion": "success",
                                                   "started_at": "2026-10-21T12:01:00Z", "completed_at": "2026-10-21T12:04:00Z"},
                                                  {"number": 2, "name": "Upload the tested WASM package", "status": "completed", "conclusion": "success",
                                                   "started_at": "2026-10-21T12:05:00Z", "completed_at": "2026-10-21T12:06:00Z"}]}]},
                          f"repos/{REPOSITORY}/actions/runs/{RUN}/artifacts?per_page=100&page=1": {"artifacts": [self.artifact]},
                          f"repos/{REPOSITORY}/actions/artifacts/901": self.artifact}
        self.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/jobs?per_page=100&page=1"] = self.responses[
            f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2/jobs?per_page=100&page=1"]
        self.calls = []
        self.set_files(dict(FILES, **{"build-receipt.json": json.dumps(receipt).encode()}))

    def set_files(self, files):
        self.raw = archive(files)
        self.artifact["digest"] = "sha256:" + transport.sha(self.raw)

    def json(self, path):
        self.calls.append(path)
        return copy.deepcopy(self.responses[path])

    def bytes(self, path):
        self.calls.append(path)
        if path != f"repos/{REPOSITORY}/actions/artifacts/901/zip":
            raise AssertionError(path)
        return self.raw


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source, self.target = self.root / "source", self.root / "target"
        self.source.mkdir()
        for name, raw in FILES.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        (self.source / ".gitignore").write_text("*\n", encoding="utf-8")
        self.receipt = package.record(self.source, SHA, REPOSITORY, RUN, 2)
        self.api = API(self.receipt)

    def restore(self):
        return package.restore(self.api, self.target, SHA, REPOSITORY, RUN, now=NOW)

    def reject(self):
        with self.assertRaises((ValueError, KeyError, TypeError, zipfile.BadZipFile)):
            self.restore()
        self.assertFalse(self.target.exists(), "invalid input wrote package files")

    def test_record_covers_every_nonhidden_package_file_and_is_repeatable(self):
        self.assertEqual(set(self.receipt), {"version", "workflow", "repository", "sha", "run_id", "attempt", "files"})
        self.assertEqual(self.receipt["files"], [{"path": name, "size": len(raw), "sha256": transport.sha(raw)}
                                               for name, raw in sorted(FILES.items())])
        self.assertEqual(self.receipt, package.record(self.source, SHA, REPOSITORY, RUN, 2))
        self.assertEqual(json.loads((self.source / "build-receipt.json").read_bytes()), self.receipt)

    def test_empty_optional_package_file_is_retained(self):
        (self.source / "LICENSE").write_bytes(b"")
        receipt = package.record(self.source, SHA, REPOSITORY, RUN, 2)
        self.assertIn({"path": "LICENSE", "size": 0, "sha256": transport.sha(b"")}, receipt["files"])
        self.api.set_files(dict(FILES, LICENSE=b"", **{"build-receipt.json": json.dumps(receipt).encode()}))
        self.assertEqual(self.restore(), receipt)

    def test_restore_authenticates_package_and_writes_complete_exact_inventory(self):
        self.assertEqual(self.restore(), self.receipt)
        self.assertEqual({p.relative_to(self.target).as_posix(): p.read_bytes()
                          for p in self.target.rglob("*") if p.is_file()},
                         dict(FILES, **{"build-receipt.json": json.dumps(self.receipt).encode()}))
        self.assertIn(f"repos/{REPOSITORY}/actions/artifacts/901", self.api.calls)

    def test_wrong_repository_run_sha_workflow_event_branch_or_unsuccessful_run_rejected(self):
        run = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}"]
        for field, value in (("id", 456), ("repository", {"full_name": "foreign/repo"}),
                             ("head_repository", {"full_name": "foreign/repo"}), ("head_sha", "b" * 40),
                             ("path", ".github/workflows/untrusted.yml"), ("event", "pull_request"),
                             ("head_branch", "feature"), ("status", "in_progress"), ("conclusion", "failure")):
            with self.subTest(field=field):
                old = run[field]
                run[field] = value
                self.reject()
                run[field] = old

    def test_producer_attempt_and_successful_web_job_are_required(self):
        attempt = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2"]
        jobs = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2/jobs?per_page=100&page=1"]["jobs"]
        for field, value in (("run_attempt", 3), ("head_sha", "b" * 40), ("status", "in_progress")):
            with self.subTest(attempt=field):
                old = attempt[field]
                attempt[field] = value
                self.reject()
                attempt[field] = old
        for field, value in (("name", "changelog"), ("run_id", 456), ("run_attempt", 1),
                             ("head_sha", "b" * 40), ("conclusion", "skipped"), ("status", "in_progress"),
                             ("completed_at", "2026-10-21T12:04:00Z")):
            with self.subTest(job=field):
                old = jobs[0][field]
                jobs[0][field] = value
                self.reject()
                jobs[0][field] = old
        jobs.append(copy.deepcopy(jobs[0]))
        self.reject()

    def cloned_web_attempt(self):
        receipt = dict(self.receipt, attempt=1)
        self.api.artifact["name"] = f"tested-wasm-{SHA}-attempt-1"
        self.api.set_files(dict(FILES, **{"build-receipt.json": json.dumps(receipt).encode()}))
        prefix = f"repos/{REPOSITORY}/actions/runs/{RUN}"
        self.api.responses[prefix]["run_attempt"] = 4
        attempt = self.api.responses.pop(prefix + "/attempts/2")
        attempt.update(run_attempt=1, conclusion="failure")
        self.api.responses[prefix + "/attempts/1"] = attempt
        jobs = self.api.responses.pop(prefix + "/attempts/2/jobs?per_page=100&page=1")
        jobs["jobs"][0]["run_attempt"] = 1
        jobs["jobs"][0]["id"] = 119852835665
        self.api.responses[prefix + "/attempts/1/jobs?per_page=100&page=1"] = jobs
        cloned = copy.deepcopy(jobs)
        cloned["jobs"][0].update(id=119900920118, run_attempt=4, created_at="2026-10-21T15:01:25Z")
        self.api.responses[prefix + "/jobs?per_page=100&page=1"] = cloned
        return receipt

    def test_successful_web_clone_from_failed_earlier_attempt_survives_other_job_rerun(self):
        receipt = self.cloned_web_attempt()
        self.assertEqual(self.restore(), receipt)
        self.assertIn(f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/1/jobs?per_page=100&page=1", self.api.calls)

    def test_cloned_success_requires_original_authenticated_execution_and_steps(self):
        self.cloned_web_attempt()
        prefix = f"repos/{REPOSITORY}/actions/runs/{RUN}"
        original = self.api.responses[prefix + "/attempts/1/jobs?per_page=100&page=1"]["jobs"][0]
        for field, value in (("run_attempt", 2), ("head_sha", "b" * 40), ("conclusion", "failure"),
                             ("started_at", "2026-10-21T12:00:01Z"), ("completed_at", "2026-10-21T12:09:59Z"),
                             ("steps", []), ("steps", [dict(original["steps"][0], conclusion="failure"), original["steps"][1]])):
            with self.subTest(field=field):
                old = original[field]
                original[field] = value
                self.reject()
                original[field] = old
        step = original["steps"][0]
        for field, value in (("number", 3), ("name", "Other work"), ("status", "in_progress"),
                             ("conclusion", "skipped"), ("started_at", "2026-10-21T12:01:01Z"),
                             ("completed_at", "2026-10-21T12:04:01Z")):
            with self.subTest(step_field=field):
                old = step[field]
                step[field] = value
                self.reject()
                step[field] = old

    def test_two_attempt_artifacts_in_same_execution_interval_are_ambiguous(self):
        self.cloned_web_attempt()
        rows = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/artifacts?per_page=100&page=1"]["artifacts"]
        rows.append(dict(self.api.artifact, id=902, name=f"tested-wasm-{SHA}-attempt-2"))
        self.reject()

    def test_success_steps_require_valid_timezone_ordered_timestamps(self):
        key = f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2/jobs?per_page=100&page=1"
        steps = self.api.responses[key]["jobs"][0]["steps"]
        original = copy.deepcopy(steps[0])
        cases = [("started_at", None), ("started_at", {}), ("started_at", "invalid"),
                 ("started_at", "2026-10-21T12:01:00"), ("completed_at", None),
                 ("completed_at", 123), ("completed_at", "2026-10-21T12:00:00Z")]
        for index, (field, value) in enumerate(cases):
            with self.subTest(field=field, value=value):
                self.target = self.root / f"invalid-step-{index}"
                steps[0] = dict(original, **{field: value})
                with self.assertRaises(ValueError):
                    self.restore()
                self.assertFalse(self.target.exists())
        steps[0] = {field: value for field, value in original.items() if field != "started_at"}
        self.target = self.root / "missing-success-start"
        with self.assertRaises(ValueError):
            self.restore()
        self.assertFalse(self.target.exists())

    def test_skipped_step_timestamps_may_be_missing_null_or_valid(self):
        key = f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2/jobs?per_page=100&page=1"
        steps = self.api.responses[key]["jobs"][0]["steps"]
        skipped = {"number": 3, "name": "Skipped operation", "status": "completed", "conclusion": "skipped"}
        cases = [{}, {"started_at": None, "completed_at": None},
                 {"started_at": "2026-10-21T12:06:00Z"}, {"completed_at": "2026-10-21T12:07:00Z"},
                 {"started_at": "2026-10-21T12:06:00Z", "completed_at": "2026-10-21T12:07:00Z"}]
        steps.append(skipped)
        for index, dates in enumerate(cases):
            with self.subTest(dates=dates):
                self.target = self.root / f"valid-skipped-{index}"
                steps[-1] = dict(skipped, **dates)
                self.assertEqual(self.restore(), self.receipt)

    def test_provided_skipped_step_dates_must_parse_and_be_ordered(self):
        key = f"repos/{REPOSITORY}/actions/runs/{RUN}/attempts/2/jobs?per_page=100&page=1"
        steps = self.api.responses[key]["jobs"][0]["steps"]
        skipped = {"number": 3, "name": "Skipped operation", "status": "completed", "conclusion": "skipped"}
        cases = [{"started_at": {}}, {"completed_at": 123}, {"started_at": "invalid"},
                 {"completed_at": "2026-10-21T12:07:00"},
                 {"started_at": "2026-10-21T12:07:00Z", "completed_at": "2026-10-21T12:06:00Z"}]
        steps.append(skipped)
        for index, dates in enumerate(cases):
            with self.subTest(dates=dates):
                self.target = self.root / f"invalid-skipped-{index}"
                steps[-1] = dict(skipped, **dates)
                with self.assertRaises(ValueError):
                    self.restore()
                self.assertFalse(self.target.exists())

    def test_full_web_rerun_selects_latest_attempt_and_preserves_earlier_artifact(self):
        old = dict(self.api.artifact, id=900, name=f"tested-wasm-{SHA}-attempt-1", created_at="2026-10-21T10:05:00Z")
        rows = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/artifacts?per_page=100&page=1"]["artifacts"]
        rows.insert(0, old)
        self.assertEqual(self.restore(), self.receipt)
        self.assertNotIn(f"repos/{REPOSITORY}/actions/artifacts/900/zip", self.api.calls)
        self.assertEqual(rows, [old, self.api.artifact])

    def test_latest_web_attempt_requires_its_own_artifact_and_receipt(self):
        rows = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/artifacts?per_page=100&page=1"]["artifacts"]
        rows[:] = [dict(self.api.artifact, id=900, name=f"tested-wasm-{SHA}-attempt-1", created_at="2026-10-21T10:05:00Z")]
        with self.assertRaisesRegex(ValueError, "missing or duplicate expected tested package artifact"):
            self.restore()
        self.assertFalse(self.target.exists())
        self.assertFalse(any("/actions/artifacts/" in path for path in self.api.calls),
                         "an earlier execution's artifact was inspected as a fallback")
        rows[:] = [self.api.artifact]
        self.api.set_files(dict(FILES, **{"build-receipt.json": json.dumps(dict(self.receipt, attempt=1)).encode()}))
        self.reject()

    def test_latest_web_job_must_match_the_authenticated_attempt_job(self):
        key = f"repos/{REPOSITORY}/actions/runs/{RUN}/jobs?per_page=100&page=1"
        self.api.responses[key] = copy.deepcopy(self.api.responses[key])
        latest = self.api.responses[key]["jobs"][0]
        for field, value in (("id", 78), ("run_attempt", 1), ("run_id", 456),
                             ("head_sha", "b" * 40), ("conclusion", "failure"), ("status", "in_progress")):
            with self.subTest(field=field):
                old = latest[field]
                latest[field] = value
                self.reject()
                latest[field] = old
        self.api.responses[key]["jobs"].append(copy.deepcopy(latest))
        self.reject()

    def test_missing_duplicate_expired_foreign_or_changed_artifact_rejected(self):
        rows = self.api.responses[f"repos/{REPOSITORY}/actions/runs/{RUN}/artifacts?per_page=100&page=1"]["artifacts"]
        rows.clear()
        self.reject()
        rows.extend([self.api.artifact, self.api.artifact])
        self.reject()
        rows.pop()
        for field, value in (("expired", True), ("expires_at", "2026-10-21T12:05:00Z"),
                             ("workflow_run", {"id": 456, "head_sha": SHA, "head_branch": "main"}),
                             ("workflow_run", {"id": 123, "head_sha": "b" * 40, "head_branch": "main"}),
                             ("id", 0), ("digest", "sha256:" + "0" * 64),
                             ("created_at", "2026-10-21T11:59:00Z")):
            with self.subTest(field=field, value=value):
                old = self.api.artifact[field]
                self.api.artifact[field] = value
                self.reject()
                self.api.artifact[field] = old
        self.api.responses[f"repos/{REPOSITORY}/actions/artifacts/901"] = dict(self.api.artifact, name="other")
        self.reject()

    def test_strict_receipt_identity_schema_and_inventory(self):
        for field, value in (("version", 2), ("repository", "foreign/repo"), ("sha", "b" * 40),
                             ("run_id", "456"), ("attempt", True), ("attempt", 3),
                             ("workflow", "other.yml"), ("unexpected", "field"),
                             ("files", self.receipt["files"][:-1]), ("files", self.receipt["files"] * 2)):
            with self.subTest(field=field, value=value):
                receipt = dict(self.receipt, **{field: value})
                self.api.set_files(dict(FILES, **{"build-receipt.json": json.dumps(receipt).encode()}))
                self.reject()

    def test_altered_missing_extra_hidden_and_unsafe_archive_members_rejected(self):
        files = dict(FILES, **{"build-receipt.json": json.dumps(self.receipt).encode()})
        for name, raw in (("terri_wasm.js", b"changed"), ("undeclared.js", b"extra"),
                          (".hidden", b"hidden"), ("../outside", b"unsafe"), ("/absolute", b"unsafe"),
                          ("snippets\\escape", b"unsafe"), ("snippets/../escape", b"unsafe")):
            with self.subTest(name=name):
                self.api.set_files(dict(files, **{name: raw}))
                self.reject()
        for name in ("build-receipt.json", "terri_wasm_bg.wasm"):
            with self.subTest(missing=name):
                self.api.set_files({key: raw for key, raw in files.items() if key != name})
                self.reject()

    def test_archive_duplicate_symlink_and_duplicate_json_keys_rejected(self):
        for symlink in (False, True):
            stream = io.BytesIO()
            with warnings.catch_warnings(), zipfile.ZipFile(stream, "w") as zipped:
                warnings.simplefilter("ignore", UserWarning)
                for name, raw in FILES.items():
                    zipped.writestr(name, raw)
                member = zipfile.ZipInfo("linked.js" if symlink else "terri_wasm.js")
                member.external_attr = (stat.S_IFLNK | 0o777) << 16 if symlink else 0
                zipped.writestr(member, b"outside")
                zipped.writestr("build-receipt.json", json.dumps(self.receipt).encode())
            self.api.raw = stream.getvalue()
            self.api.artifact["digest"] = "sha256:" + transport.sha(self.api.raw)
            self.reject()
        raw_receipt = json.dumps(self.receipt).replace('"version": 1', '"version": 1, "version": 1')
        self.api.set_files(dict(FILES, **{"build-receipt.json": raw_receipt.encode()}))
        self.reject()

    def test_receipt_path_cannot_be_used_as_a_directory(self):
        extra = "build-receipt.json/nested.js"
        receipt = dict(self.receipt, files=sorted(self.receipt["files"] +
                       [{"path": extra, "size": 1, "sha256": transport.sha(b"x")}], key=lambda row: row["path"]))
        self.api.set_files(dict(FILES, **{extra: b"x", "build-receipt.json": json.dumps(receipt).encode()}))
        self.reject()

    def test_required_package_files_cannot_be_omitted_even_with_matching_inventory(self):
        for name in ("package.json", "terri_wasm.js", "terri_wasm_bg.wasm"):
            with self.subTest(name=name):
                receipt = dict(self.receipt, files=[row for row in self.receipt["files"] if row["path"] != name])
                files = {key: raw for key, raw in FILES.items() if key != name}
                self.api.set_files(dict(files, **{"build-receipt.json": json.dumps(receipt).encode()}))
                self.reject()

    def test_invalid_record_identity_or_missing_runtime_is_rejected(self):
        for arguments in (("short", REPOSITORY, RUN, 2), (SHA, "../repo", RUN, 2),
                          (SHA, REPOSITORY, "0", 2), (SHA, REPOSITORY, RUN, True)):
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                package.record(self.source, *arguments)
        (self.source / "terri_wasm.js").unlink()
        with self.assertRaises(ValueError):
            package.record(self.source, SHA, REPOSITORY, RUN, 2)

    def test_destination_cannot_hide_existing_or_linked_files(self):
        self.target.mkdir()
        old = self.target / "old.js"
        old.write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            self.restore()
        self.assertEqual(old.read_bytes(), b"preserve")
        self.assertEqual(list(self.target.iterdir()), [old])


if __name__ == "__main__":
    unittest.main()
