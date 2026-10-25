"""Preserve local verification coverage and truthful execution receipts."""

import importlib.util
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[2] / "scripts/check-local-ci.py"
spec = importlib.util.spec_from_file_location("local_ci", SOURCE)
local = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = local
spec.loader.exec_module(local)


class LocalVerification(unittest.TestCase):
    def test_npm_batch_wrapper_uses_real_node_with_literal_paths_and_arguments(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node is required for the local runner's npm execution contract")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "node tools & literal (paths)"
            root.mkdir()
            wrapper = root / "npm.cmd"
            wrapper.write_text("This batch file must never execute.")
            cli = root / "node_modules/npm/bin/npm-cli.js"
            cli.parent.mkdir(parents=True)
            cli.write_text("process.stdout.write(JSON.stringify(process.argv.slice(2)));", encoding="utf-8")
            arguments = ('literal spaces', '& echo injected', '$(echo injected)', 'quoted "value"', '%COMSPEC%')
            with mock.patch.object(local.shutil, "which", side_effect=lambda name: str(wrapper) if name == "npm" else node):
                status = local.execute_command(("npm", *arguments), root, root / "output.log")
            self.assertEqual(status, 0, (root / "output.log").read_text())
            self.assertEqual(json.loads((root / "output.log").read_text()), list(arguments))

    def test_batch_commands_without_the_supported_npm_cli_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ("unsupported.cmd", "npm.cmd"):
                wrapper = root / name
                wrapper.write_text("echo must never execute")
                with self.subTest(name=name), mock.patch.object(local.shutil, "which", return_value=str(wrapper)):
                    with self.assertRaises(OSError):
                        local.execute_command((name, "argument"), root, root / "output.log")

    def test_catalog_retains_all_removed_checks_in_their_required_directories(self):
        rows = local.commands(local.GROUPS, install_dependencies=True)
        rendered = [" ".join(row.argv) for row in rows]
        for command in ("cargo fmt --all -- --check", "cargo clippy --workspace --all-targets -- -D warnings",
                        "cargo test --workspace", "wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm",
                        "npm ci", "npm run typecheck", "npm test -- --maxWorkers=1", "npm run build",
                        "node scripts/check-player-reference.mjs --verify-export",
                        "node scripts/check-player-reference.mjs --check", "node scripts/build-changelog.mjs",
                        "node scripts/build-player-guide.mjs"):
            self.assertIn(command, rendered)
        self.assertTrue(any(row.cwd == ".github/scripts" and row.argv[1:] == ("-B", "-m", "unittest", "discover", "-p", "test_*.py") for row in rows))
        self.assertTrue(any(row.argv[-1] == "check-doc-ids.py" for row in rows))
        for directory in ("assets/sprites/gen", "assets/models/sims/sim-01", "assets/models/furniture",
                          "assets/models/kitchen", "assets/models/bathroom", "assets/models/kitchen/actions",
                          "assets/models/bathroom/actions", "assets/models/bedroom", "assets/models/office", "assets/models/outdoor"):
            self.assertTrue(any(row.argv[1:] == ("-B", "-m", "unittest", "discover", "-s", directory, "-p", "test_*.py") for row in rows), directory)
        for row in rows:
            if row.argv[0] == "npm":
                self.assertEqual(row.cwd, "web")
        names = [row.name for row in rows]
        self.assertLess(names.index("Build WASM package"), names.index("Test web"))
        self.assertLess(names.index("Test web"), names.index("Build web"))
        self.assertTrue(any(row.name == "Verify sim core has no web dependencies" for row in rows))
        self.assertTrue(any(row.argv[-2:] == ("assets/sprites/gen/build.py", "--check") for row in rows))
        self.assertTrue(any(row.argv[-2:] == ("scripts/build-runtime-atlas.py", "--check") for row in rows))
        self.assertTrue(any(row.argv[1:] == ("-B", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_runtime_atlas.py") for row in rows))
        self.assertTrue(any(row.argv == ("node", "--test", "scripts/build-changelog.test.mjs", "scripts/build-player-guide.test.mjs",
                                        "scripts/player-activity-filters.test.mjs", "scripts/player-coverage.test.mjs",
                                        "scripts/check-player-reference.test.mjs", "scripts/branding.test.mjs") for row in rows))
        setup = local.commands(("art",), install_dependencies=True)
        self.assertTrue(any(row.argv[1:] == ("-m", "pip", "install", "--quiet", "--disable-pip-version-check", "Pillow", "numpy") for row in setup))

    def test_default_run_installs_nothing_and_resource_bounds_preserve_stricter_limits(self):
        for row in local.commands(local.GROUPS):
            self.assertNotEqual(row.argv, ("npm", "ci"))
            self.assertNotIn("pip", row.argv)
        values = local.bounded_environment({"NODE_OPTIONS": "--no-warnings --max-old-space-size=512", "CARGO_BUILD_JOBS": "1"})
        self.assertIn("--no-warnings", values["NODE_OPTIONS"])
        self.assertIn("--max-old-space-size=512", values["NODE_OPTIONS"])
        self.assertEqual(values["CARGO_BUILD_JOBS"], "1")
        values = local.bounded_environment({"NODE_OPTIONS": "--max-old-space-size=8192", "CARGO_BUILD_JOBS": "12"})
        self.assertIn("--max-old-space-size=2048", values["NODE_OPTIONS"])
        self.assertEqual(values["CARGO_BUILD_JOBS"], "2")

    def test_owner_authorization_refuses_substitutions_and_unreviewable_references(self):
        values = dict(sha="a" * 40, head="a" * 40, actor="owner", owner="owner", reference="sha256:" + "b" * 64)
        self.assertEqual(local.authorize(**values)["validated_sha"], values["sha"])
        for changed in (dict(sha="c" * 40), dict(sha="main"), dict(actor="someone"),
                        dict(reference=""), dict(reference="sha256:" + "0" * 64), dict(reference="line\nbreak")):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                local.authorize(**dict(values, **changed))

    def fixture(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(["git", "-C", str(root), "-c", "user.name=Local test", "-c", "user.email=local@example.invalid", "commit", "--allow-empty", "-qm", "fixture"], check=True)
        return root

    def test_failed_check_is_retained_and_stops_later_work(self):
        root = self.fixture()
        calls = []
        def execute(command, cwd, log):
            calls.append(command)
            return 7
        report = root / "ignored-report.json"
        result = local.run_checks(root, report, ("docs",), execute=execute)
        self.assertFalse(result["complete"])
        self.assertEqual(result["results"][0]["returncode"], 7)
        self.assertEqual(len(calls), 1)
        self.assertEqual(json.loads(report.read_text()), result)
        self.assertTrue(result["platform_limits"])

    def test_partial_run_records_revision_without_claiming_complete_verification(self):
        root = self.fixture()
        report = root / "report.json"
        result = local.run_checks(root, report, ("docs",), execute=lambda *unused: 0)
        self.assertRegex(result["checked_revision"], r"^[0-9a-f]{40}$")
        self.assertEqual(result["groups"], ["docs"])
        self.assertFalse(result["complete"])
        self.assertEqual(result["state"], "passed")

    def test_source_change_during_checks_invalidates_the_receipt(self):
        root = self.fixture()
        report = root / "report.json"
        def execute(*unused):
            (root / "changed.py").write_text("changed source")
            return 0
        result = local.run_checks(root, report, ("docs",), execute=execute)
        self.assertEqual(result["state"], "source_changed")
        self.assertFalse(result["complete"])

    def test_complete_run_retains_every_command_result_and_stable_source(self):
        root = self.fixture()
        result = local.run_checks(root, root / "report.json", local.GROUPS, execute=lambda *unused: 0)
        self.assertTrue(result["complete"])
        self.assertEqual(len(result["results"]), len(local.commands(local.GROUPS)))
        self.assertEqual(result["source_before"], result["source_after"])

    def test_interruption_remains_an_incomplete_durable_report(self):
        root = self.fixture()
        def execute(*unused):
            raise KeyboardInterrupt()
        report = root / "report.json"
        result = local.run_checks(root, report, ("docs",), execute=execute)
        self.assertEqual(result["state"], "interrupted")
        self.assertFalse(result["complete"])
        self.assertEqual(json.loads(report.read_text())["results"][0]["returncode"], 130)

    def test_purity_failure_cannot_be_hidden_by_empty_output(self):
        with mock.patch.object(local.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["cargo", "tree"])):
            with self.assertRaises(subprocess.CalledProcessError):
                local.verify_purity(Path.cwd())
        with mock.patch.object(local.subprocess, "run", return_value=mock.Mock(stdout="terri-core -> wasm-bindgen")):
            with self.assertRaises(ValueError):
                local.verify_purity(Path.cwd())


if __name__ == "__main__":
    unittest.main()
