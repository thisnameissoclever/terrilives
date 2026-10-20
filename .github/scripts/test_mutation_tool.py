"""Tool provenance failures use real bounded archives and authenticated API fixtures."""

import base64
import copy
import datetime as dt
import io
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


def recipe_revision(api, contract, revision, tree_ids=None):
    tree_ids = tree_ids or ("c" * 40, "1" * 40, "2" * 40, "3" * 40)
    parents = dict(zip(("", ".github", ".github/scripts", ".github/workflows"), tree_ids))
    trees = {path: {"sha": sha, "truncated": False, "tree": []} for path, sha in parents.items()}
    for path, sha in parents.items():
        if path:
            parent, _, name = path.rpartition("/")
            trees[parent]["tree"].append({"path": name, "sha": sha, "mode": "040000", "type": "tree"})
    for path, sha in contract["git_blobs"].items():
        parent, _, name = path.rpartition("/")
        trees[parent]["tree"].append({"path": name, "sha": sha, "mode": "100644", "type": "blob"})
    prefix = "repos/owner/repo/git/"
    api.responses[prefix + "commits/" + revision] = {"sha": revision, "tree": {"sha": parents[""]}}
    for tree in trees.values():
        api.responses[prefix + "trees/" + tree["sha"]] = tree
    return trees


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
        for revision in ("b" * 40, "e" * 40):
            self.trees = recipe_revision(self.api, self.contract, revision)
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
        tree = self.trees[".github/scripts"]
        next(row for row in tree["tree"] if row["path"] == "mutation_workflow.py")["sha"] = "f" * 40
        with self.assertRaisesRegex(ValueError, "committed recipe input mismatch"):
            self.authenticate()

    def verify_recipe(self, api=None):
        tool.verify_committed_contract(api or self.api, "owner/repo", "b" * 40, self.contract)

    def test_recipe_visits_only_four_complete_immediate_trees(self):
        self.trees[""]["tree"].append({"path": "assets", "mode": "040000", "type": "tree", "sha": "a" * 40})
        next(row for row in self.trees[""]["tree"] if row["path"] == "rust-toolchain.toml")["mode"] = "100755"
        self.api.responses["repos/owner/repo/git/trees/" + "c" * 40 + "?recursive=1"] = {"truncated": True, "tree": []}
        self.api.calls.clear()
        self.verify_recipe()
        self.assertEqual(self.api.calls, ["repos/owner/repo/git/commits/" + "b" * 40,
            *("repos/owner/repo/git/trees/" + self.trees[parent]["sha"]
              for parent in ("", ".github", ".github/workflows", ".github/scripts"))])

    def test_subtree_header_must_match_selected_parent_sha(self):
        self.trees[".github/scripts"]["sha"] = "f" * 40
        with self.assertRaisesRegex(ValueError, "recipe tree identity mismatch"):
            self.verify_recipe()

    def test_selected_subtree_sha_cannot_be_replaced_by_an_unbound_response(self):
        row = next(row for row in self.trees[".github"]["tree"] if row["path"] == "scripts")
        row["sha"] = "f" * 40
        self.api.responses["repos/owner/repo/git/trees/" + "f" * 40] = self.trees[".github/scripts"]
        with self.assertRaisesRegex(ValueError, "recipe tree identity mismatch"):
            self.verify_recipe()

    def test_duplicate_immediate_names_are_rejected(self):
        tree = self.trees[".github/scripts"]["tree"]
        tree.append(copy.deepcopy(tree[0]))
        with self.assertRaisesRegex(ValueError, "duplicate recipe tree entry"):
            self.verify_recipe()

    def test_selected_directory_requires_tree_type_and_mode(self):
        row = next(row for row in self.trees[""]["tree"] if row["path"] == ".github")
        row.update(type="blob", mode="100644")
        with self.assertRaisesRegex(ValueError, "recipe directory mismatch"):
            self.verify_recipe()

    def test_recipe_rejects_bad_commit_root_parent_and_leaf(self):
        cases = [
            (self.api.responses["repos/owner/repo/git/commits/" + "b" * 40], "sha", "f" * 40, "commit mismatch"),
            (self.api.responses["repos/owner/repo/git/commits/" + "b" * 40]["tree"], "sha", "../bad", "recipe tree SHA"),
            (self.trees[""], "sha", "f" * 40, "tree identity mismatch"),
        ]
        for parent in ("", ".github"):
            for row in self.trees[parent]["tree"]:
                if row["type"] == "tree":
                    cases.extend((row, key, value, message) for key, value, message in (
                        ("type", "blob", "directory mismatch"), ("mode", "100644", "directory mismatch"),
                        ("sha", "bad", "recipe tree SHA")))
        for tree in self.trees.values():
            for row in tree["tree"]:
                if row["type"] == "blob":
                    cases.extend((row, key, value, "committed recipe input mismatch") for key, value in (
                        ("type", "tree"), ("mode", "120000"), ("mode", "160000"), ("sha", "f" * 40)))
        for row, key, value, message in cases:
            original = row[key]
            with self.subTest(key=key, value=value, path=row.get("path")):
                row[key] = value
                with self.assertRaisesRegex(ValueError, message):
                    self.verify_recipe()
                row[key] = original

    def test_all_required_trees_must_be_explicitly_complete(self):
        for parent, tree in self.trees.items():
            for truncated in (True, None, 0):
                with self.subTest(parent=parent, truncated=truncated):
                    if truncated is None:
                        tree.pop("truncated")
                    else:
                        tree["truncated"] = truncated
                    with self.assertRaisesRegex(ValueError, "tree is truncated"):
                        self.verify_recipe()
                    tree["truncated"] = False

    def test_malformed_tree_entry_lists_are_rejected(self):
        for parent, tree in self.trees.items():
            original = tree["tree"]
            for changed, message in ((None, "invalid recipe tree entries"), ([None], "unsafe recipe tree entry")):
                with self.subTest(parent=parent, changed=changed):
                    tree["tree"] = changed
                    with self.assertRaisesRegex(ValueError, message):
                        self.verify_recipe()
                    tree["tree"] = original

    def test_unsafe_immediate_names_and_missing_inputs_are_rejected(self):
        for parent, tree in self.trees.items():
            for name in ("", ".", "..", "a/b", "a\\b", "a:b", "a\x00b"):
                with self.subTest(parent=parent, name=name):
                    tree["tree"].append({"path": name})
                    with self.assertRaisesRegex(ValueError, "unsafe recipe tree entry"):
                        self.verify_recipe()
                    tree["tree"].pop()
            for index in range(len(tree["tree"])):
                row = tree["tree"].pop(index)
                with self.subTest(parent=parent, missing=row["path"]), self.assertRaises(ValueError):
                    self.verify_recipe()
                tree["tree"].insert(index, row)

    def test_contract_map_and_hash_guards_precede_requests(self):
        for field in ("files", "git_blobs"):
            for alteration in ("missing", "extra", "hash"):
                original = self.contract[field].copy()
                if alteration == "missing":
                    self.contract[field].pop(tool.WORKFLOW)
                elif alteration == "extra":
                    self.contract[field]["unrequested"] = "a" * 40
                else:
                    self.contract[field][tool.WORKFLOW] = "bad"
                self.api.calls.clear()
                with self.subTest(field=field, alteration=alteration), self.assertRaises(ValueError):
                    self.verify_recipe()
                self.assertEqual(self.api.calls, [])
                self.contract[field] = original

    def test_tree_request_failure_propagates_without_fallback(self):
        error = subprocess.CalledProcessError(1, ["gh", "api"])
        with mock.patch.object(self.api, "json", side_effect=[
                self.api.responses["repos/owner/repo/git/commits/" + "b" * 40], error]) as fetch:
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                self.verify_recipe()
            self.assertIs(caught.exception, error)
            self.assertEqual(fetch.call_args_list, [mock.call("repos/owner/repo/git/commits/" + "b" * 40),
                mock.call("repos/owner/repo/git/trees/" + "c" * 40)])

    def test_workflow_cache_authenticates_distinct_roots_and_reuses_shared_parents(self):
        import mutation_recovery as recovery

        recipe_revision(self.api, self.contract, "e" * 40, ("4" * 40, "5" * 40, "6" * 40, "7" * 40))
        api = recovery.WorkflowAPI(self.api)
        self.verify_recipe(api)
        tool.verify_committed_contract(api, "owner/repo", "e" * 40, self.contract)
        self.assertEqual(api.requests, 10)
        self.verify_recipe(api)
        self.assertEqual(api.requests, 10)
        recipe_revision(self.api, self.contract, "8" * 40, ("9" * 40, "a" * 40, "6" * 40, "7" * 40))
        tool.verify_committed_contract(api, "owner/repo", "8" * 40, self.contract)
        self.assertEqual(api.requests, 13)

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
            ('row.get("sha") == contract["git_blobs"][path]', 'True',
             'test_committed_helper_is_independently_fetched_not_trusted_from_receipt'),
            ('isinstance(tree, dict) and tree.get("sha") == sha', 'isinstance(tree, dict)',
             'test_subtree_header_must_match_selected_parent_sha'),
            ('name not in rows', 'True', 'test_duplicate_immediate_names_are_rejected'),
            ('row.get("type") == "tree" and row.get("mode") == "040000"', 'True',
             'test_selected_directory_requires_tree_type_and_mode')]
        positive = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(
            "test_mutation_tool.ToolAuthenticationTests." + test) for _, _, test in controls)
        self.assertTrue(unittest.TextTestRunner(stream=io.StringIO()).run(positive).wasSuccessful())
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
