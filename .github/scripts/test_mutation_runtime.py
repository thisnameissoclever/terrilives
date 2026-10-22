"""Container identity tests use real inventory bytes and explicit fake installations."""

import contextlib
import datetime as dt
import json
import os
import re
import shlex
import shutil
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import mutation_artifacts as artifacts
import mutation_campaign as model
import mutation_runtime as runtime
import mutation_runner as runner
import mutation_native as native
import mutation_tool as tool
from test_mutation_artifacts import FixtureAPI, archive


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


class RuntimeFixture:
    def __init__(self, case):
        self.temp = tempfile.TemporaryDirectory(prefix="mutation-runtime-test-")
        case.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.files = {}
        self.tools = {}
        for name in runtime.REQUIRED_TOOLS:
            path = self.bin / name
            path.write_bytes(("fixed " + name).encode())
            self.files[str(path.resolve())] = artifacts.sha(path.read_bytes())
            self.tools[name] = str(path.resolve())
        self.library = self.bin / "libc.so"
        self.library.write_bytes(b"fixed loader library")
        self.files[str(self.library.resolve())] = artifacts.sha(self.library.read_bytes())
        self.recipe = ".github/runtime/Dockerfile"
        recipe = self.root / self.recipe
        recipe.parent.mkdir(parents=True)
        recipe.write_bytes(b"FROM reviewed@sha256:base\n")
        self.recipe_files = {self.recipe: artifacts.sha(recipe.read_bytes())}
        for name in runtime.RECIPE_PATHS:
            if name != self.recipe:
                path = self.root / name
                path.write_bytes(("fixture " + name).encode())
                self.recipe_files[name] = artifacts.sha(path.read_bytes())
        self.inventory = {"version": 1, "architecture": "x86_64", "files": self.files,
            "tools": self.tools, "symlinks": {},
            "tool_versions": {**{name: "pinned " + name for name in self.tools}, "packages": "fixed package inventory"},
            "compiler": {"sysroot": str(self.bin.resolve()), "target": "x86_64-unknown-linux-gnu", "verbose": "rustc 1.94.1"},
            "recipe_inputs": self.recipe_files}
        self.installed = self.root / "inventory.json"
        self.marker = self.root / ".dockerenv"
        self.marker.write_bytes(b"")
        self.cgroup = self.root / "cgroup"
        self.cgroup.write_text("0::/\n")
        self.image = "ghcr.io/thisnameissoclever/terrilives-mutation-runtime@sha256:" + "a" * 64
        self.pin = {"version": 1, "image": self.image, "inventory_sha256": "", "recipe_files": self.recipe_files}
        self.environment = {"MUTATION_RUNTIME_IMAGE": self.image, "PATH": str(self.bin), "HOME": str(self.root), "USERPROFILE": str(self.root), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8"}
        self.refresh()

    def refresh(self):
        self.pin["image"] = self.image
        self.installed.write_bytes(canonical(self.inventory))
        self.pin["inventory_sha256"] = artifacts.sha(self.installed.read_bytes())
        (self.root / runtime.PIN).write_bytes(canonical(self.pin))
        workflow = self.root / runtime.WORKFLOW
        workflow.parent.mkdir(parents=True, exist_ok=True)
        workflow.write_text("env:\n  MUTATION_RUNTIME_IMAGE: &mutation-runtime-image " + self.image + "\n")

    @contextlib.contextmanager
    def activate(self):
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(runtime, "INVENTORY", self.installed))
            stack.enter_context(mock.patch.object(runtime, "CONTAINER_MARKER", self.marker))
            stack.enter_context(mock.patch.object(runtime, "CGROUP", self.cgroup))
            stack.enter_context(mock.patch.object(runtime.platform, "system", return_value="Linux"))
            stack.enter_context(mock.patch.object(runtime.platform, "machine", return_value="x86_64"))
            stack.enter_context(mock.patch.object(runtime.shutil, "which", side_effect=lambda name, **unused: self.tools.get(name)))
            stack.enter_context(mock.patch.dict(os.environ, self.environment, clear=True))
            yield


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.f = RuntimeFixture(self)

    def test_actual_image_env_normalizes_only_declared_cargo_worker_count(self):
        f = self.f
        dockerfile = Path(__file__).resolve().parents[1] / "runtime/Dockerfile"
        source = dockerfile.read_text().replace("\\\n", " ")
        declaration = re.search(r"^ENV (.+)$", source, re.MULTILINE)
        self.assertIsNotNone(declaration)
        image_env = dict(token.split("=", 1) for token in shlex.split(declaration.group(1)))
        self.assertEqual(image_env["CARGO_BUILD_JOBS"], "2")
        with f.activate(), mock.patch.dict(os.environ, image_env):
            settings = {"opt_level": 2, "cargo_jobs": 2, "runtime": runtime.identity(f.root)}
            environment, contract = runner.execution_environment(settings, root=f.root)
            self.assertEqual(environment["CARGO_BUILD_JOBS"], "2")
            self.assertEqual(contract["variables"]["CARGO_BUILD_JOBS"], "2")
            without_redundant_default = dict(os.environ)
            without_redundant_default.pop("CARGO_BUILD_JOBS")
            self.assertEqual(contract, runner.execution_environment(settings, without_redundant_default, root=f.root)[1])
            for override in ({"CARGO_BUILD_JOBS": "3"}, {"CARGO_BUILD_JOBS": "02"}, {"CARGO_TARGET_DIR": "elsewhere"}):
                with self.subTest(override=override), mock.patch.dict(os.environ, override):
                    with self.assertRaisesRegex(ValueError, "Cargo override"):
                        runner.execution_environment(settings, root=f.root)
            with self.assertRaisesRegex(ValueError, "Cargo override"):
                runner.execution_environment(dict(settings, cargo_jobs=1), root=f.root)

    def test_inventory_cannot_omit_shell_or_native_build_helpers(self):
        f = self.f
        for name in ("sh", "as", "gcc", "g++", "cpp", "dash", "env", "sleep", "mkdir", "rm"):
            with self.subTest(name=name):
                original = dict(f.tools)
                f.tools.pop(name, None)
                f.refresh()
                with f.activate(), self.assertRaisesRegex(ValueError, "incomplete mutation runtime executable inventory"):
                    runtime.identity(f.root)
                f.tools.update(original)
        f.refresh()

    def test_shell_alias_redirect_refuses_with_dash_and_bash_bytes_unchanged(self):
        f = self.f
        alias = Path(f.tools["sh"])
        f.files.pop(str(alias))
        alias.unlink()
        dash, bash = Path(f.tools["dash"]), Path(f.tools["bash"])
        try:
            alias.symlink_to(dash)
        except OSError as error:
            self.skipTest("host cannot create symlink fixture: " + str(error))
        f.tools["sh"] = str(dash.resolve())
        f.inventory["symlinks"][str(alias)] = str(dash.resolve())
        f.refresh()
        original = {str(path): path.read_bytes() for path in (dash, bash)}
        with f.activate():
            runtime.identity(f.root)
            alias.unlink()
            alias.symlink_to(bash)
            self.assertEqual({str(path): path.read_bytes() for path in (dash, bash)}, original)
            with self.assertRaisesRegex(ValueError, "symlink changed"):
                runtime.identity(f.root)

    def test_native_assembler_path_shadow_refuses_without_changing_original(self):
        f = self.f
        original = Path(f.tools["as"]).read_bytes()
        shadow = f.bin / "shadow-as"
        shadow.write_bytes(b"different assembler")
        with f.activate():
            runtime.identity(f.root)
            def resolve(name, **unused):
                return str(shadow) if name == "as" else f.tools.get(name)
            with mock.patch.object(runtime.shutil, "which", side_effect=resolve):
                with self.assertRaisesRegex(ValueError, "tool resolution changed: as"):
                    runtime.identity(f.root)
            self.assertEqual(Path(f.tools["as"]).read_bytes(), original)

    def test_host_rollout_changes_only_provenance_and_not_execution_contract(self):
        f = self.f
        with f.activate():
            identity = runtime.identity(f.root)
            settings = {"opt_level": 2, "cargo_jobs": 2, "runtime": identity}
            first = runner.execution_environment(settings, root=f.root)[1]
            with mock.patch.dict(os.environ, {"ImageOS": "ubuntu24", "ImageVersion": "next-rollout", "RUNNER_OS": "Linux"}):
                self.assertEqual(first, runner.execution_environment(settings, root=f.root)[1])
                self.assertEqual(runtime.host_provenance()["ImageVersion"], "next-rollout")
            self.assertNotIn("runner_image", first)

    def test_environment_assertion_does_not_establish_container_identity(self):
        f = self.f
        with f.activate():
            f.marker.unlink()
            with self.assertRaisesRegex(ValueError, "container marker"):
                runtime.identity(f.root)

    def test_pin_inventory_recipe_tool_library_and_architecture_changes_refuse(self):
        f = self.f
        with f.activate():
            identity = runtime.identity(f.root)
            settings = {"opt_level": 2, "cargo_jobs": 2, "runtime": identity}
            for name in ("rustc", "cargo"):
                path = Path(f.tools[name])
                old = path.read_bytes()
                path.write_bytes(b"changed compiler")
                with self.subTest(name=name), self.assertRaisesRegex(ValueError, "runtime file changed"):
                    runner.execution_environment(settings, root=f.root)
                path.write_bytes(old)
            f.library.write_bytes(b"changed library")
            with self.assertRaisesRegex(ValueError, "runtime file changed"):
                runner.execution_environment(settings, root=f.root)
            f.library.write_bytes(b"fixed loader library")
            f.installed.write_bytes(f.installed.read_bytes() + b" ")
            with self.assertRaisesRegex(ValueError, "inventory hash"):
                runner.execution_environment(settings, root=f.root)
            f.refresh()
            with mock.patch.dict(os.environ, {"MUTATION_RUNTIME_IMAGE": f.image[:-1] + "b"}):
                with self.assertRaisesRegex(ValueError, "image differs"):
                    runtime.identity(f.root)
            with mock.patch.object(runtime.platform, "machine", return_value="aarch64"):
                with self.assertRaisesRegex(ValueError, "architecture"):
                    runtime.identity(f.root)
            (f.root / f.recipe).write_bytes(b"changed recipe")
            with self.assertRaisesRegex(ValueError, "recipe changed"):
                runtime.identity(f.root)

    def test_redirected_library_alias_refuses_while_original_bytes_are_unchanged(self):
        f = self.f
        alias = f.bin / "library-alias"
        try:
            alias.symlink_to(f.library)
        except OSError as error:
            self.skipTest("host cannot create symlink fixture: " + str(error))
        f.inventory["symlinks"][str(alias)] = str(f.library.resolve())
        f.refresh()
        with f.activate():
            runtime.identity(f.root)
            alias.unlink()
            alias.symlink_to(Path(f.tools["cc"]))
            self.assertEqual(f.library.read_bytes(), b"fixed loader library")
            with self.assertRaisesRegex(ValueError, "symlink changed"):
                runtime.identity(f.root)

    def test_workflow_literal_and_tool_resolution_are_independent_guards(self):
        f = self.f
        with f.activate():
            workflow = f.root / runtime.WORKFLOW
            original = workflow.read_bytes()
            workflow.write_text("env:\n  MUTATION_RUNTIME_IMAGE: " + f.image[:-1] + "b\n")
            with self.assertRaisesRegex(ValueError, "committed workflow literal"):
                runtime.identity(f.root)
            workflow.write_bytes(original)
            with mock.patch.object(runtime.shutil, "which", return_value=str(f.library)):
                with self.assertRaisesRegex(ValueError, "tool resolution changed"):
                    runtime.identity(f.root)
            with mock.patch.dict(os.environ, {"LD_PRELOAD": str(f.library)}):
                with self.assertRaisesRegex(ValueError, "loader override"):
                    runtime.identity(f.root)

    def test_changed_committed_image_and_inventory_do_not_match_prior_execution(self):
        f = self.f
        with f.activate():
            settings = {"opt_level": 2, "cargo_jobs": 2, "runtime": runtime.identity(f.root)}
            f.image = f.image[:-1] + "b"
            f.environment["MUTATION_RUNTIME_IMAGE"] = f.image
            f.refresh()
            with mock.patch.dict(os.environ, f.environment):
                with self.assertRaisesRegex(ValueError, "runtime changed"):
                    runner.execution_environment(settings, root=f.root)


    def test_calibration_worker_and_native_recheck_actual_runtime(self):
        f = self.f
        class ReachedComputation(Exception):
            pass
        with f.activate(), mock.patch.object(runner, "bound_setup"), \
                mock.patch.object(runner, "checkout_inventory", return_value=({}, {})):
            settings = {"opt_level": 2, "cargo_jobs": 2, "runtime": runtime.identity(f.root), "repository": "owner/repo",
                        "slot": 0, "scope": "fixture", "build_cap_seconds": 600}
            environment = runner.execution_environment(settings, root=f.root)[1]
            executable = {"version": "fixture", "binary_sha256": "b" * 64}
            calibration = {"inventory_digest": model.digest({}), "environment": environment,
                           "cargo_mutants_identity": executable, "toolchain": {"rustc": "fixed rustc", "cargo": "fixed cargo"}}
            planned = {"calibration": calibration, "manifest": {"context": {"inputs": {"timeout_policy": {"build_seconds": 600}}}}}
            with mock.patch.object(runner, "installed_tool", return_value=executable), \
                    mock.patch.object(runner, "command", side_effect=lambda argv, *unused: "fixed " + argv[0]):
                with mock.patch.dict(os.environ, {"ImageVersion": "another-host"}):
                    self.assertEqual(native.current_binding(f.root, settings, planned), {})
                settings["cargo_jobs"] = 1
                with self.assertRaisesRegex(ValueError, "current source or runtime changed"):
                    native.current_binding(f.root, settings, planned)
                settings["cargo_jobs"] = 2
            with mock.patch.object(runner, "installed_tool", side_effect=ReachedComputation):
                with self.assertRaises(ReachedComputation):
                    runner.calibrate(f.root, settings, f.root / "calibration.json")
                with self.assertRaises(ReachedComputation):
                    runner.execute_slot(f.root, settings, planned, {}, f.root / "output")
                f.library.write_bytes(b"changed actual library")
                for operation in (lambda: runner.calibrate(f.root, settings, f.root / "calibration.json"),
                                  lambda: runner.execute_slot(f.root, settings, planned, {}, f.root / "output"),
                                  lambda: native.current_binding(f.root, settings, planned)):
                    with self.subTest(operation=operation), self.assertRaisesRegex(ValueError, "runtime file changed"):
                        operation()

    def test_prepared_tool_rechecks_inventory_and_actual_loaded_library(self):
        f = self.f
        executable_bytes = b"prepared executable"
        executable_sha = artifacts.sha(executable_bytes)
        contract = {"reviewed": "recipe"}
        required = dt.datetime.now(dt.timezone.utc)
        receipt = {"contract": contract, "upstream": tool.UPSTREAM, "patch_sha256": tool.PATCH_SHA,
                   "source_tree": tool.SOURCE_TREE, "lock_sha256": tool.LOCK_SHA, "run_id": "100", "attempt": 1,
                   "head_sha": "d" * 40, "executable_sha256": executable_sha, "executable_size": len(executable_bytes)}
        api = FixtureAPI()
        with f.activate():
            identity = runtime.identity(f.root)
            def command(argv, *unused):
                if argv[0] == "readelf":
                    return "Requesting program interpreter: /lib/libc.so]"
                if argv[0] == "ldd":
                    return "libc => /lib/libc.so (0x1)\nlibgcc => /lib/libgcc.so (0x2)"
                return "x86_64" if argv[0] == "uname" else "pinned " + argv[0]
            def linux_path(name):
                aliases = {"/lib/libc.so": f.library, "/lib/libgcc.so": Path(f.tools["cc"])}
                return aliases.get(str(name), Path(name))
            inspection = contextlib.ExitStack()
            self.addCleanup(inspection.close)
            inspection.enter_context(mock.patch.object(runner, "command", side_effect=command))
            inspection.enter_context(mock.patch.object(tool, "Path", side_effect=linux_path))
            receipt["runtime"] = tool.runtime_identity(None, f.root, identity)
            raw_receipt = canonical(receipt)
            raw = archive({"cargo-mutants": executable_bytes, "receipt.json": raw_receipt})
            reference = {"repository": "owner/repo", "artifact_id": 77, "archive_digest": "sha256:" + artifacts.sha(raw),
                         "receipt_sha256": artifacts.sha(raw_receipt), "executable_sha256": executable_sha}
            api.responses["repos/owner/repo/actions/artifacts/77"] = {"id": 77, "digest": reference["archive_digest"],
                "name": "mutation-tool-run-100-attempt-1", "workflow_run": {"id": 100, "head_sha": "d" * 40},
                "expired": False, "expires_at": (required + dt.timedelta(days=1)).isoformat()}
            api.blobs["repos/owner/repo/actions/artifacts/77/zip"] = raw
            destination = f.root.parent / (f.root.name + "-verified")
            self.addCleanup(lambda: shutil.rmtree(destination, ignore_errors=True))
            with mock.patch.dict(os.environ, {"ImageVersion": "next-host-rollout"}):
                executable, binding = tool.consume_prepared(api, reference, receipt, contract, destination, f.root, identity,
                                                           required)
                self.assertEqual(executable.read_bytes(), executable_bytes)
                self.assertEqual(binding["runtime"], receipt["runtime"])
            shutil.rmtree(destination)
            f.library.write_bytes(b"changed actual library")
            with self.assertRaisesRegex(ValueError, "runtime file changed"):
                tool.consume_prepared(api, reference, receipt, contract, destination, f.root, identity, required)


if __name__ == "__main__":
    unittest.main()
