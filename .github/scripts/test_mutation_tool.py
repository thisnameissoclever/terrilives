"""Tool provenance failures use real bounded archives and authenticated API fixtures."""

import base64
import copy
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import mutation_artifacts as artifacts
import mutation_tool as tool
import mutation_runner as runner
from test_mutation_artifacts import FixtureAPI, archive


class ToolAuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "source"
        self.root.mkdir()
        self.destination = Path(self.temp.name) / "tool"
        self.api = FixtureAPI()
        self.now = dt.datetime.now(dt.timezone.utc)
        self.required = self.now + dt.timedelta(days=9)
        self.image = {"ImageOS": "ubuntu24", "ImageVersion": "fixture-image"}
        self.runtime = {"image": self.image, "libraries": {"/lib/libc.so": "a" * 64}}
        self.contract = tool.committed_contract(Path(__file__).resolve().parents[2])
        self.receipt = {"version": 1, "repository": "owner/repo", "workflow": tool.WORKFLOW,
            "workflow_sha": "e" * 40, "head_sha": "d" * 40, "run_id": "100", "attempt": 1, "job_id": "901",
            "checkout": {"repository": "owner/repo", "commit": "b" * 40, "tree": "c" * 40, "ref": "HEAD", "clean": True},
            "contract": self.contract, "upstream": tool.UPSTREAM, "patch_sha256": tool.PATCH_SHA,
            "source_tree": tool.SOURCE_TREE, "lock_sha256": tool.LOCK_SHA,
            "executable_sha256": artifacts.sha(b"fixture executable"), "executable_size": len(b"fixture executable"),
            "runtime": self.runtime, "log_retention_days": 30}
        self.files = {"cargo-mutants": b"fixture executable"}
        self.artifact = {"id": 77, "name": "mutation-tool-run-100-attempt-1", "expired": False,
            "workflow_run": {"id": 100, "head_sha": "d" * 40}, "created_at": (self.now - dt.timedelta(minutes=20)).isoformat(),
            "expires_at": (self.now + dt.timedelta(days=29)).isoformat()}
        prefix = "repos/owner/repo"
        self.api.responses[prefix + "/actions/runs/100"] = {"id": 100, "repository": {"full_name": "owner/repo"},
            "head_repository": {"full_name": "owner/repo"}, "path": tool.WORKFLOW, "event": "workflow_dispatch",
            "head_sha": "d" * 40, "run_attempt": 1, "created_at": (self.now - dt.timedelta(hours=1)).isoformat()}
        source = Path(__file__).resolve().parents[2]
        for path in tool.CONTRACT_PATHS:
            for revision in ("e" * 40, "b" * 40):
                self.api.responses[prefix + f"/contents/{path}?ref={revision}"] = {
                    "encoding": "base64", "content": base64.b64encode((source / path).read_bytes()).decode()}
        self.api.responses[prefix + "/git/commits/" + "b" * 40] = {"sha": "b" * 40, "tree": {"sha": "c" * 40}}
        self.api.responses[prefix + "/git/commits/" + "e" * 40] = {"sha": "e" * 40, "tree": {"sha": "c" * 40}}
        self.api.responses[prefix + "/git/trees/" + "c" * 40 + "?recursive=1"] = {"truncated": False,
            "tree": [{"path": path, "type": "blob", "mode": "100644", "sha": sha}
                     for path, sha in self.contract["git_blobs"].items()]}
        self.api.responses[prefix + "/actions/runs/100/attempts/1"] = {"id": 100, "run_attempt": 1, "head_sha": "d" * 40}
        self.job = {"id": 901, "run_id": 100, "run_attempt": 1, "name": "mutation-fixture-tool", "status": "completed",
            "conclusion": "success", "started_at": (self.now - dt.timedelta(hours=1)).isoformat(),
            "completed_at": (self.now - dt.timedelta(minutes=10)).isoformat()}
        self.api.responses[prefix + "/actions/runs/100/attempts/1/jobs?per_page=100&page=1"] = {"jobs": [self.job]}
        self.environment = mock.patch.dict(os.environ, {"GITHUB_RETENTION_DAYS": "30"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.repack()

    def repack(self):
        self.files["receipt.json"] = json.dumps(self.receipt, sort_keys=True).encode()
        raw = archive(self.files)
        self.artifact["digest"] = "sha256:" + artifacts.sha(raw)
        self.api.responses["repos/owner/repo/actions/artifacts/77"] = self.artifact
        self.api.blobs["repos/owner/repo/actions/artifacts/77/zip"] = raw
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = (
            "MUTATION_TOOL " + json.dumps(self.receipt) + "\nMUTATION_ARTIFACT_ID=77\n").encode()
        self.reference = tool.reference_for(self.api, "owner/repo", 77)

    def authenticate(self, **overrides):
        arguments = {"runtime": lambda *args: self.runtime}
        arguments.update(overrides)
        return tool.authenticate(self.api, self.reference, self.contract, self.destination, self.root,
                                 self.image, self.required, **arguments)

    def test_authenticates_exact_bytes_and_restores_only_verified_executable(self):
        executable, contract = self.authenticate()
        self.assertEqual(executable.read_bytes(), b"fixture executable")
        self.assertEqual(contract["reference"], self.reference)
        self.assertEqual(list(self.destination.iterdir()), [executable])
        self.assertFalse(any("permissions" in call for call in self.api.calls))

    def test_modified_executable_cannot_self_attest_with_updated_archive_digest(self):
        self.files["cargo-mutants"] = b"changed executable"
        self.repack()
        with self.assertRaisesRegex(ValueError, "executable byte mismatch"):
            self.authenticate()
        self.assertFalse(self.destination.exists())

    def test_wrong_patch_source_lock_or_receipt_is_rejected(self):
        for key in ("patch_sha256", "source_tree", "lock_sha256"):
            with self.subTest(key=key):
                original = self.receipt[key]
                self.receipt[key] = "0" * len(original)
                self.repack()
                with self.assertRaisesRegex(ValueError, "recipe mismatch"):
                    self.authenticate()
                self.receipt[key] = original
        self.repack()
        self.reference["receipt_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "receipt digest"):
            self.authenticate()

    def test_archive_digest_and_producer_log_are_independent_guards(self):
        self.api.blobs["repos/owner/repo/actions/artifacts/77/zip"] += b"untrusted trailing bytes"
        with self.assertRaisesRegex(ValueError, "archive byte digest"):
            self.authenticate()
        self.repack()
        self.api.blobs["repos/owner/repo/actions/jobs/901/logs"] = b"MUTATION_ARTIFACT_ID=77\n"
        with self.assertRaisesRegex(ValueError, "receipt absent"):
            self.authenticate()

    def test_committed_helper_is_independently_fetched_not_trusted_from_receipt(self):
        tree = self.api.responses["repos/owner/repo/git/trees/" + "c" * 40 + "?recursive=1"]
        next(row for row in tree["tree"] if row["path"] == ".github/scripts/mutation_workflow.py")["sha"] = "f" * 40
        with self.assertRaisesRegex(ValueError, "committed recipe input mismatch"):
            self.authenticate()

    def test_wrong_producer_failed_job_and_event_are_rejected(self):
        for key, value, message in (("name", "unrelated-tool", "producer job mismatch"),
                                    ("conclusion", "failure", "producer did not succeed")):
            original = self.job[key]
            self.job[key] = value
            with self.assertRaisesRegex(ValueError, message):
                self.authenticate()
            self.job[key] = original
        self.api.responses["repos/owner/repo/actions/runs/100"]["event"] = "pull_request"
        with self.assertRaisesRegex(ValueError, "explicit fixture dispatch"):
            self.authenticate()

    def test_actual_artifact_and_log_lifetime_must_cover_future_campaign(self):
        self.artifact["expires_at"] = (self.now + dt.timedelta(days=8)).isoformat()
        with self.assertRaisesRegex(ValueError, "artifact retention"):
            self.authenticate()
        self.artifact["expires_at"] = (self.now + dt.timedelta(days=29)).isoformat()
        with mock.patch.dict(os.environ, {"GITHUB_RETENTION_DAYS": "8"}):
            with self.assertRaisesRegex(ValueError, "log retention"):
                self.authenticate()

    def test_runtime_change_is_rejected_before_execution(self):
        with self.assertRaisesRegex(ValueError, "runtime changed"):
            self.authenticate(runtime=lambda *args: {"image": "changed"})

    def test_tool_archive_uses_separate_bounds_and_rejects_extra_members(self):
        with mock.patch.object(artifacts, "MAX_MEMBER", 1):
            self.assertEqual(tool.unpack_tool(archive(self.files))["cargo-mutants"], b"fixture executable")
        with self.assertRaisesRegex(ValueError, "unexpected tool archive members"):
            tool.unpack_tool(archive(dict(self.files, extra=b"x")))
        with self.assertRaisesRegex(ValueError, "unsafe archive path"):
            tool.unpack_tool(archive({"../cargo-mutants": b"x", "receipt.json": b"{}"}))


class ExplicitExecutableTests(unittest.TestCase):
    def test_explicit_path_ignores_path_and_cargo_home_and_requires_expected_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "verified"
            path.write_bytes(b"verified tool")
            digest = artifacts.sha(path.read_bytes())
            settings = {"require_authenticated_tool": True, "tool_executable": str(path), "tool_sha256": digest,
                        "tool_contract": {"reference": {"executable_sha256": digest}, "runtime": {"image": "fixed"}}}
            with mock.patch.object(runner, "command", return_value="cargo-mutants 27.1.0") as command, \
                 mock.patch.object(runner.shutil, "which", side_effect=AssertionError("PATH must not be used")):
                selected = runner.installed_tool(temporary, {"PATH": "unrelated", "CARGO_HOME": "unrelated"}, settings)
                self.assertEqual(command.call_args.args[0], [str(path), "mutants", "--version"])
                self.assertEqual(runner.tool_identity(selected)["authenticated_contract"], settings["tool_contract"])
                path.write_bytes(b"changed tool")
                with self.assertRaisesRegex(ValueError, "explicit tool byte digest"):
                    runner.installed_tool(temporary, {}, settings)

    def test_fixture_copies_exact_pin_even_when_host_default_is_different(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            pin = b'[toolchain]\nchannel = "1.94.1"\n'
            (root / "rust-toolchain.toml").write_bytes(pin)
            with mock.patch.dict(os.environ, {"RUSTUP_TOOLCHAIN": "different-host-default"}):
                with runner.selected_workspace(root, "fixture") as fixture:
                    self.assertEqual((fixture / "rust-toolchain.toml").read_bytes(), pin)
                with self.assertRaisesRegex(ValueError, "undeclared compiler"):
                    runner.execution_environment({"opt_level": 2, "cargo_jobs": 2, "runner_image": {}})
            (root / "rust-toolchain.toml").unlink()
            with self.assertRaisesRegex(ValueError, "committed toolchain pin"):
                with runner.selected_workspace(root, "fixture"):
                    pass


class ToolFaultControls(unittest.TestCase):
    def test_isolated_guard_removals_fail_named_tests(self):
        source = Path(tool.__file__)
        original = source.read_bytes()
        controls = [
            ('artifacts.sha(files["cargo-mutants"]) == reference["executable_sha256"] == receipt["executable_sha256"]',
             'True', 'test_modified_executable_cannot_self_attest_with_updated_archive_digest'),
            ('current_runtime == receipt["runtime"]', 'True', 'test_runtime_change_is_rejected_before_execution'),
            ('rows[path]["sha"] == contract["git_blobs"][path]', 'True',
             'test_committed_helper_is_independently_fetched_not_trusted_from_receipt')]
        for old, new, test in controls:
            with self.subTest(test=test), tempfile.TemporaryDirectory() as temporary:
                changed = original.decode().replace(old, new)
                self.assertNotEqual(changed, original.decode())
                Path(temporary, "mutation_tool.py").write_text(changed, encoding="utf-8")
                script = ("import sys, unittest; sys.path.insert(0, " + repr(str(source.parent)) + "); "
                          "sys.path.insert(0, " + repr(temporary) + "); "
                          "suite=unittest.defaultTestLoader.loadTestsFromName(" + repr("test_mutation_tool.ToolAuthenticationTests." + test) + "); "
                          "result=unittest.TextTestRunner().run(suite); "
                          "sys.exit(0 if len(result.failures)==1 and not result.errors else 1)")
                result = subprocess.run([sys.executable, "-B", "-c", script], capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(source.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()
