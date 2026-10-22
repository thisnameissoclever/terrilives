"""Small process fixtures for the runner's interruption and capacity boundary."""

import copy
import contextlib
import base64
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import mutation_campaign as model
import mutation_runner as runner
from test_mutation_campaign import inventory, context, raw_report


class FixtureClock:
    """Measure controller execution after the real fixture child is ready."""
    monotonic = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)

    def __init__(self):
        self.started = None

    def start(self):
        self.started = self.monotonic()

    def time(self):
        return 0 if self.started is None else self.monotonic() - self.started


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="mutation-runner-test-")
        self.root = Path(self.temp.name)
        self.items = inventory(17)
        self.manifest = model.build_manifest(self.items, context())
        self.ids = model.slot_ids(self.manifest, 0)
        by_name = {item["name"]: item for item in self.items}
        self.selected = [by_name[item["name"]] for item in self.manifest["mutations"] if item["id"] in self.ids]
        self.provenance = {"repository": "owner/repo", "workflow": ".github/workflows/ci.yml", "run_id": "100",
                           "attempt": 1, "batch_id": "batch", "execution_id": "execution",
                           "input_fingerprint": self.manifest["input_fingerprint"], "checkout": context()["checkout"]}

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, initial, final=None, *, mode="wait", code=0):
        (self.root / "outcomes.json").unlink(missing_ok=True)
        (self.root / "stop-request").unlink(missing_ok=True)
        (self.root / "ready").unlink(missing_ok=True)
        runner.write_json(self.root / "initial.json", initial)
        runner.write_json(self.root / "final.json", final or initial)
        script = self.root / "process.py"
        script.write_text('''import json, pathlib, signal, sys, time
p = pathlib.Path(__file__).parent
def stopped(*args):
    (p / "outcomes.json").write_bytes((p / "final.json").read_bytes())
    (p / "fake-written").write_text("yes")
    sys.exit(101)
signal.signal(signal.SIGBREAK if sys.platform == "win32" else signal.SIGTERM, stopped)
(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())
(p / "ready").write_text("yes")
if sys.argv[1] == "exit": sys.exit(int(sys.argv[2]))
if sys.argv[1] == "partial":
    time.sleep(.3)
    (p / "outcomes.json").write_text('{"outcomes":[')
while True:
    if (p / "stop-request").exists(): stopped()
    time.sleep(.01)
''', encoding="utf-8")
        return [sys.executable, "-B", str(script), mode, str(code)]

    def run_fixture(self, argv, seconds=0.8, factory=runner.OwnedProcess, slot=0, input_guard=None, cwd=None):
        clock = FixtureClock()
        def ready_process(*args, **kwargs):
            process = factory(*args, **kwargs)
            try:
                self.wait_fixture_file("ready")
            except Exception:
                process.stop(3)
                raise
            clock.start()
            return process
        with mock.patch.object(runner, "time", clock):
            return runner.run_controller(argv, cwd=cwd or self.root, env=dict(os.environ), report_path=self.root / "outcomes.json",
                manifest=self.manifest, slot=slot, batch_ids=self.ids, provenance=self.provenance,
                deadline=seconds, shutdown_seconds=3, log_path=self.root / "process.log",
                poll_seconds=.02, process_factory=ready_process, input_guard=input_guard)

    def wait_fixture_file(self, name):
        until = time.monotonic() + 3
        while not (self.root / name).exists():
            if time.monotonic() >= until:
                raise OSError("fixture handshake timed out: " + name)
            time.sleep(.005)

    def test_production_deadline_still_includes_child_startup(self):
        argv = self.fixture(raw_report(self.selected[:1], interrupted=True))
        script = Path(argv[2])
        script.write_text(script.read_text().replace(
            '(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())',
            'time.sleep(1)\n(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())'))
        deadline = time.time()
        result = runner.run_controller(argv, cwd=self.root, env=dict(os.environ),
            report_path=self.root / "outcomes.json", manifest=self.manifest, slot=0,
            batch_ids=self.ids, provenance=self.provenance, deadline=deadline,
            shutdown_seconds=3, log_path=self.root / "process.log", poll_seconds=.02)
        self.assertEqual(result["state"], "incomplete_without_progress")
        self.assertEqual(result["reason"], "controller_deadline")
        self.assertIsNone(result["snapshot"])
        self.assertFalse((self.root / "ready").exists())

    def native_repository(self):
        root = self.root / "protected"
        root.mkdir()
        files = {"Cargo.toml": "[workspace]\nmembers = []\n", "Cargo.lock": "version = 4\n",
                 "crates/native.rs": "pub fn original() {}\n", "docs/prose.md": "Original prose.\n",
                 "docs/mutants-baseline.txt": "", ".github/workflows/ci.yml": "name: fixture\n",
                 runner.FILES[-1]: "published fixture\n"}
        for name, contents in files.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents, encoding="utf-8")
        def git(*arguments):
            return subprocess.run(["git", "-c", "core.hooksPath=" + str(self.root / "no-hooks"),
                "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *arguments],
                cwd=root, check=True, capture_output=True)
        git("init", "-b", "fixture")
        git("add", ".")
        git("commit", "-m", "Fixture inputs")
        return root, git

    def owned_input_fixture(self):
        original = self.root / "original-inputs"
        original.mkdir()
        source = original / self.selected[0]["file"]
        source.parent.mkdir(parents=True)
        source.write_bytes(("        " + "x" * 40 + "\n").encode() * 60)
        (original / "Cargo.lock").write_bytes(b"version = 4\n")
        (original / "crates/other.rs").write_bytes(b"other original input\n")
        owned = self.root / "owned-inputs"
        shutil.copytree(original, owned)
        guard = runner.OwnedInputs(owned, "production")
        guard.configure(self.manifest, self.ids)
        return original, owned, guard

    def test_tool_resolution_hash_and_every_invocation_use_same_absolute_plugin(self):
        cargo_home = self.root / "cargo-home"
        home_bin = cargo_home / "bin"
        home_bin.mkdir(parents=True)
        path_bin = self.root / "path-bin"
        path_bin.mkdir()
        name = "cargo-mutants.exe" if os.name == "nt" else "cargo-mutants"
        intended, shadow = home_bin / name, path_bin / name
        intended.write_bytes(b"intended fixture executable")
        shadow.write_bytes(b"different fixture executable with same displayed version")
        intended.chmod(0o755)
        shadow.chmod(0o755)
        calls = []
        def version(argv, *args):
            calls.append(argv)
            return "cargo-mutants 27.1.0"
        with mock.patch.object(runner, "command", side_effect=version):
            tool = runner.installed_tool(self.root, {"PATH": str(path_bin), "CARGO_HOME": str(cargo_home)})
        self.assertEqual(tool["binary_sha256"], runner.artifacts.sha(intended.read_bytes()))
        self.assertEqual(calls, [[str(intended.resolve()), "mutants", "--version"]])
        for argv in (runner.generation_argv("production", tool), runner.generation_argv("fixture", tool),
                     runner.execution_argv({"scope": "production", "build_cap_seconds": 600},
                                           {"test_cap_seconds": 120}, tool, "batch.toml", "attempt")):
            self.assertEqual(argv[:2], [str(intended.resolve()), "mutants"])
        argv = runner.execution_argv({"scope": "production", "build_cap_seconds": 600},
                                     {"test_cap_seconds": 120}, tool, "batch.toml", "attempt")
        self.assertEqual(argv.count("--cargo-arg=--locked"), 1)
        self.assertEqual(argv.count("--cargo-arg=--workspace"), 1)
        intended.write_bytes(shadow.read_bytes())
        with self.assertRaisesRegex(ValueError, "executable changed"):
            runner.generation_argv("production", tool)

    def test_calibration_rejects_owned_lock_and_native_drift_after_each_phase(self):
        protected, _ = self.native_repository()
        initial = runner.checkout_inventory(protected, "owner/repo")
        real_process, real_command = runner.OwnedProcess, runner.command
        settings = {"slot": 0, "scope": "production", "repository": "owner/repo", "run_id": "100",
                    "job_started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "shutdown_seconds": 3, "upload_seconds": 20, "validation_seconds": 5}
        for changed in ("Cargo.lock", "crates/native.rs"):
            phases = []
            def process(argv, **kwargs):
                if argv[:2] == ["cargo", "test"]:
                    phases.append(argv)
                    self.assertIn("--locked", argv)
                    argv = [sys.executable, "-B", "-c", "from pathlib import Path; Path(" + repr(changed) + ").write_text('changed input')"]
                return real_process(argv, **kwargs)
            def command(argv, *args, **kwargs):
                if argv[0] in ("cargo", "rustc") and "--version" in argv:
                    return argv[0] + " fixture-version"
                return real_command(argv, *args, **kwargs)
            output = self.root / (changed.replace("/", "-") + ".json")
            with self.subTest(changed=changed), \
                 mock.patch.object(runner, "execution_environment", return_value=(dict(os.environ), {})), \
                 mock.patch.object(runner, "installed_tool", return_value={"version": "27.1.0", "binary_sha256": "a" * 64}), \
                 mock.patch.object(runner, "OwnedProcess", side_effect=process), \
                 mock.patch.object(runner, "command", side_effect=command):
                with self.assertRaisesRegex(ValueError, "owned input bytes changed"):
                    runner.calibrate(protected, settings, output)
                self.assertEqual(len(phases), 1, "the changed build input must be rejected before testing")
                self.assertFalse(output.exists())
            self.assertEqual(runner.checkout_inventory(protected, "owner/repo"), initial)

    def test_controller_rejects_owned_lock_or_other_input_drift_with_valid_report(self):
        original, owned, guard = self.owned_input_fixture()
        for changed in ("Cargo.lock", "crates/other.rs"):
            with self.subTest(changed=changed):
                argv = self.fixture(raw_report(self.selected), mode="exit")
                script = Path(argv[2])
                script.write_text(script.read_text().replace('(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())',
                    'pathlib.Path.cwd().joinpath(' + repr(changed) + ').write_bytes(b"changed")\n'
                    + '(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())'))
                result = self.run_fixture(argv, input_guard=guard, cwd=owned)
                self.assertEqual(result["state"], "infrastructure_failure")
                self.assertIsNone(result["snapshot"])
                self.assertNotEqual((owned / changed).read_bytes(), (original / changed).read_bytes())
                shutil.copyfile(original / changed, owned / changed)

    def test_controller_permits_only_exact_pending_mutation_after_interruption(self):
        original, owned, guard = self.owned_input_fixture()
        mutation = next(item for item in self.manifest["mutations"] if item["id"] == self.ids[1])
        active = runner.mutation_bytes((original / mutation["file"]).read_bytes(), mutation)
        argv = self.fixture(raw_report(self.selected[:1], interrupted=True))
        script = Path(argv[2])
        script.write_text(script.read_text().replace('(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())',
            'pathlib.Path.cwd().joinpath(' + repr(mutation["file"]) + ').write_bytes(' + repr(active) + ')\n'
            + '(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())'))
        result = self.run_fixture(argv, input_guard=guard, cwd=owned)
        self.assertEqual(result["state"], "incomplete_with_progress")
        self.assertEqual(len(result["snapshot"][1]["records"]), 1)
        self.assertEqual((owned / mutation["file"]).read_bytes(), active)
        with self.assertRaisesRegex(ValueError, "owned input bytes changed"):
            guard.verify(0, active=True)
        with self.assertRaisesRegex(ValueError, "owned input bytes changed"):
            guard.verify(1, active=False)

    def test_mutation_byte_construction_preserves_pinned_crlf_and_unicode_rules(self):
        mutation = {"span": {"start": {"line": 1, "column": 3}, "end": {"line": 1, "column": 4}}, "replacement": "0"}
        self.assertEqual(runner.mutation_bytes("é +\r\n".encode(), mutation), "é 0 /* ~ changed by cargo-mutants ~ */\n".encode())

    def active_source_write_fixture(self, *, transition="apply", permanent=False, unrelated=None, stop_during_write=False):
        original, owned, guard = self.owned_input_fixture()
        pending = next(item for item in self.manifest["mutations"] if item["id"] == self.ids[1])
        base = (original / pending["file"]).read_bytes()
        mutated = runner.mutation_bytes(base, pending)
        target = mutated if transition == "apply" else base
        (owned / pending["file"]).write_bytes(base if transition == "apply" else mutated)
        (self.root / "target.bin").write_bytes(target)
        report = raw_report(self.selected[:1], interrupted=True)
        runner.write_json(self.root / "initial.json", report)
        script = self.root / "active-write.py"
        script.write_text('''import pathlib, sys, time
p = pathlib.Path(__file__).parent
source = pathlib.Path.cwd() / sys.argv[1]
target = (p / "target.bin").read_bytes()
if sys.argv[3] != "none":
    pathlib.Path.cwd().joinpath(sys.argv[3]).write_bytes(b"unexpected unrelated change")
(p / "outcomes.json").write_bytes((p / "initial.json").read_bytes())
with source.open("wb") as stream:
    stream.write(target[:int(sys.argv[4])])
    stream.flush()
    (p / "partial-ready").touch()
    while not (p / "release-write").exists(): time.sleep(.005)
    if sys.argv[2] != "permanent":
        stream.seek(0)
        stream.write(target)
        stream.truncate()
        stream.flush()
(p / "write-finished").touch()
while True: time.sleep(.01)
''', encoding="utf-8")
        raw_before = (self.root / "initial.json").read_bytes()
        original_read, original_verify = guard.read_state, guard.verify
        events, observations, stops = [], [], []
        clock = FixtureClock()
        def read_state():
            state = original_read()
            partial = state[pending["file"]]["digest"] not in {runner.artifacts.sha(base), runner.artifacts.sha(mutated)}
            observations.append(partial)
            if partial:
                if stop_during_write:
                    while clock.time() < deadline:
                        time.sleep(.005)
                (self.root / "release-write").touch()
            return state
        def verify(*args, **kwargs):
            before = len(observations)
            try:
                result = original_verify(*args, **kwargs)
            except ValueError as error:
                events.append({"partial": any(observations[before:]), "accepted": False,
                               "exception": type(error).__name__, "kwargs": dict(kwargs)})
                raise
            events.append({"partial": any(observations[before:]), "accepted": True, "kwargs": dict(kwargs)})
            return result
        guard.read_state, guard.verify = read_state, verify
        owner = self
        class PausedWriteProcess(runner.OwnedProcess):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                try:
                    owner.wait_fixture_file("partial-ready")
                except Exception:
                    super().stop(3)
                    raise
                clock.start()
            def stop(self, seconds):
                stops.append(clock.time())
                (owner.root / "release-write").touch()
                try:
                    owner.wait_fixture_file("write-finished")
                finally:
                    super().stop(seconds)
        deadline = 1
        with mock.patch.object(runner, "time", clock):
            result = runner.run_controller([sys.executable, "-B", str(script), pending["file"],
                "permanent" if permanent else "finish", unrelated or "none", "0" if transition == "apply" else "11"],
                cwd=owned, env=dict(os.environ), report_path=self.root / "outcomes.json", manifest=self.manifest,
                slot=0, batch_ids=self.ids, provenance=self.provenance, deadline=deadline, shutdown_seconds=3,
                log_path=self.root / "active-write.log", poll_seconds=.01, process_factory=PausedWriteProcess, input_guard=guard)
        return {"result": result, "events": events, "report_unchanged": (self.root / "outcomes.json").read_bytes() == raw_before,
                "final_exact": (owned / pending["file"]).read_bytes() == target,
                "stopped_before_deadline": stops[0] < deadline, "original": original, "owned": owned}

    def test_partial_active_apply_write_is_deferred_until_exact_bytes(self):
        observed = self.active_source_write_fixture()
        self.assertTrue(observed["report_unchanged"] and observed["final_exact"])
        self.assertTrue(any(event["partial"] for event in observed["events"]))
        self.assertFalse(any(event["partial"] and event["accepted"] for event in observed["events"]))
        self.assertEqual(observed["result"]["state"], "incomplete_with_progress")
        self.assertEqual([record["mutation_id"] for record in observed["result"]["snapshot"][1]["records"]], self.ids[:1])

    def test_partial_active_revert_write_is_deferred_until_exact_bytes(self):
        observed = self.active_source_write_fixture(transition="revert")
        self.assertTrue(observed["report_unchanged"] and observed["final_exact"])
        self.assertFalse(any(event["partial"] and event["accepted"] for event in observed["events"]))
        self.assertEqual(observed["result"]["state"], "incomplete_with_progress")

    def test_permanent_corrupt_active_file_is_rejected_after_stop(self):
        observed = self.active_source_write_fixture(permanent=True)
        self.assertTrue(observed["report_unchanged"])
        self.assertFalse(observed["final_exact"])
        self.assertFalse(any(event["partial"] and event["accepted"] for event in observed["events"]))
        self.assertEqual(observed["result"]["state"], "infrastructure_failure")
        self.assertEqual(observed["result"]["reason"], "owned_inputs_changed")
        self.assertIsNone(observed["result"]["snapshot"])
        self.assertFalse(observed["stopped_before_deadline"])

    def test_shutdown_after_deferred_read_does_not_import_unaccepted_terminal_records(self):
        observed = self.active_source_write_fixture(stop_during_write=True)
        self.assertTrue(observed["report_unchanged"] and observed["final_exact"])
        self.assertFalse(any(event["partial"] and event["accepted"] for event in observed["events"]))
        self.assertEqual(observed["result"]["state"], "incomplete_without_progress")
        self.assertIsNone(observed["result"]["snapshot"])

    def test_partial_active_file_does_not_defer_unrelated_lock_or_source_drift(self):
        for unrelated in ("Cargo.lock", "crates/other.rs"):
            with self.subTest(unrelated=unrelated):
                observed = self.active_source_write_fixture(unrelated=unrelated)
                self.assertTrue(observed["stopped_before_deadline"])
                self.assertEqual(observed["events"][0]["exception"], "ValueError")
                self.assertEqual(observed["result"]["state"], "infrastructure_failure")
                self.assertIsNone(observed["result"]["snapshot"])
                self.assertNotEqual((observed["original"] / unrelated).read_bytes(), (observed["owned"] / unrelated).read_bytes())
            # Each case owns a separate fixture tree and handshake files.
            for name in ("original-inputs", "owned-inputs"):
                shutil.rmtree(self.root / name)
            for name in ("outcomes.json", "partial-ready", "release-write", "write-finished"):
                (self.root / name).unlink(missing_ok=True)

    @contextlib.contextmanager
    def aggregate_case(self, *, changed="docs/prose.md", current_slots=(0,), failed=False, failed_after_upload=False):
        from test_mutation_artifacts import FixtureAPI, archive
        protected, git = self.native_repository()
        tool_file = self.root / "fake-tool"
        tool_file.write_bytes(b"stable tool identity")
        tool = {"version": "27.1.0", "executable": str(tool_file), "binary_sha256": runner.artifacts.sha(tool_file.read_bytes())}
        settings = {"scope": "production", "repository": "owner/repo", "workflow": ".github/workflows/ci.yml",
                    "run_id": "100", "attempt": 1, "slot": 0, "opt_level": 2, "cargo_jobs": 2,
                    "build_cap_seconds": 600, "survivor_baseline": str(protected / "docs/mutants-baseline.txt")}
        checkout, inventory_state = runner.checkout_inventory(protected, "owner/repo")
        calibration = {"scope": "production", "slot": 0, "build_status": 0, "test_status": 0, "build_seconds": 1,
                       "test_seconds": 1, "test_cap_seconds": 120, "inventory_digest": model.digest(inventory_state),
                       "environment": {}, "toolchain": {"rustc": "rustc fixture", "cargo": "cargo fixture"},
                       "cargo_mutants_identity": runner.tool_identity(tool)}
        original_command = runner.command
        def command(argv, *args, **kwargs):
            if argv[0] == str(tool_file) and "--list" in argv:
                return json.dumps(self.items)
            if argv[0] in ("rustc", "cargo") and "--version" in argv:
                return argv[0] + " fixture"
            return original_command(argv, *args, **kwargs)
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(runner, "execution_environment", return_value=(dict(os.environ), {})))
            stack.enter_context(mock.patch.object(runner, "installed_tool", return_value=tool))
            stack.enter_context(mock.patch.object(runner, "command", side_effect=command))
            context_value, _, _ = runner.collect_context(protected, settings, calibration)
            manifest = model.build_manifest(self.items, context_value)
            (protected / changed).write_text("Changed tracked input.\n")
            git("add", ".")
            git("commit", "-m", "Fixture continuation")
            current_checkout, _ = runner.checkout_inventory(protected, "owner/repo")
            settings["run_id"] = "200"
            api = FixtureAPI()
            now = dt.datetime.now(dt.timezone.utc)
            started = (now - dt.timedelta(hours=1)).isoformat()
            created = (now - dt.timedelta(minutes=45)).isoformat()
            completed = (now - dt.timedelta(minutes=30)).isoformat()
            expires = (now + dt.timedelta(days=5)).isoformat()
            entries = []
            for run_id, actual, slots in (("100", checkout, range(8)), ("200", current_checkout, current_slots)):
                entry = {"run_id": run_id, "predecessor": None if run_id == "100" else "100",
                         "head_sha": actual["commit"], "workflow_sha": actual["commit"],
                         **{key: actual[key] for key in ("commit", "tree", "ref")}}
                entries.append(entry)
                prefix = f"repos/owner/repo/actions/runs/{run_id}"
                api.responses[prefix] = {"id": int(run_id), "repository": {"full_name": "owner/repo"},
                    "head_repository": {"full_name": "owner/repo"}, "path": settings["workflow"],
                    "head_sha": actual["commit"], "run_attempt": 1, "created_at": started}
                api.responses[f"repos/owner/repo/contents/{settings['workflow']}?ref={actual['commit']}"] = {
                    "encoding": "base64", "content": base64.b64encode((protected / settings["workflow"]).read_bytes()).decode()}
                api.responses[f"repos/owner/repo/git/commits/{actual['commit']}"] = {"sha": actual["commit"], "tree": {"sha": actual["tree"]}}
                api.responses[prefix + "/attempts/1"] = {"id": int(run_id), "run_attempt": 1, "head_sha": actual["commit"]}
                jobs, metadata = [], []
                for slot in slots:
                    identifier = int(run_id) * 100 + slot
                    job = {"id": identifier, "run_id": int(run_id), "run_attempt": 1, "name": f"mutation-slot-{slot}",
                           "status": "completed", "conclusion": "failure" if run_id == "200" and (failed or failed_after_upload) else "success",
                           "started_at": started, "completed_at": completed}
                    jobs.append(job)
                    if run_id == "200" and failed:
                        continue
                    receipt = {"repository": "owner/repo", "workflow": settings["workflow"], "run_id": run_id,
                               "attempt": 1, "job_id": str(identifier), "slot": slot, "checkout": actual,
                               "workflow_sha": actual["commit"], "campaign_id": manifest["campaign_id"],
                               "input_fingerprint": manifest["input_fingerprint"]}
                    delta, files = None, {}
                    if run_id == "100":
                        ids = model.slot_ids(manifest, slot)
                        by_name = {item["name"]: item for item in self.items}
                        selected = [by_name[item["name"]] for item in manifest["mutations"] if item["id"] in ids]
                        report = raw_report(selected)
                        for result in report["outcomes"]:
                            for phase in result["phase_results"]:
                                phase["argv"].append("--locked")
                        raw = json.dumps(report).encode()
                        receipt.update(batch_id=model.digest(ids), execution_id=f"slot-{slot}")
                        provenance = {key: receipt[key] for key in ("repository", "workflow", "run_id", "attempt", "checkout",
                            "input_fingerprint", "batch_id", "execution_id")}
                        delta = model.validate_report(manifest, slot, ids, report, provenance=provenance,
                            raw_report_ref={"path": "raw/outcomes.json", "digest": runner.artifacts.sha(raw),
                                            "content_digest": model.digest(report)}, exit_kind="completed")
                        files.update({"raw/outcomes.json": raw, "evidence/log/baseline.log": b"baseline", "evidence/log/mutant.log": b"mutant",
                                      "evidence/diff/mutant.diff": b"diff"})
                    bundle = {"version": 1, "manifest": manifest, "receipt": receipt, "delta": delta,
                              "status": {"state": "complete", "reason": "exact_coverage", "recorded_at": created}}
                    files["bundle.json"] = json.dumps(bundle).encode()
                    zipped = archive(files)
                    artifact = {"id": identifier, "name": runner.artifacts.artifact_name(manifest["campaign_id"], run_id, 1, slot),
                                "expired": False, "created_at": created, "expires_at": expires,
                                "workflow_run": {"id": int(run_id), "head_sha": actual["commit"]},
                                "digest": "sha256:" + runner.artifacts.sha(zipped)}
                    metadata.append(artifact)
                    api.blobs[f"repos/owner/repo/actions/artifacts/{identifier}/zip"] = zipped
                    api.blobs[f"repos/owner/repo/actions/jobs/{identifier}/logs"] = (
                        "MUTATION_PRODUCER " + json.dumps(receipt) + f"\nMUTATION_ARTIFACT_ID={identifier}\n").encode()
                api.responses[prefix + "/artifacts?per_page=100&page=1"] = {"artifacts": metadata}
                api.responses[prefix + "/attempts/1/jobs?per_page=100&page=1"] = {"jobs": jobs}
            chain = {"version": 1, "max_attempts": 51, "retention_days": 30, "started_at": started,
                     "expires_at": expires, "runs": entries}
            yield protected, {"manifest": manifest, "calibration": calibration}, chain, settings, api

    def test_aggregate_rejects_changed_native_inputs_despite_complete_authenticated_history(self):
        with self.aggregate_case(changed="crates/native.rs") as (root, planned, chain, settings, api):
            with self.assertRaisesRegex(ValueError, "calibration does not match|current source or execution contract changed"):
                runner.aggregate(root, planned, chain, settings, self.root / "aggregate.json", api)

    def test_aggregate_rejects_changed_execution_settings_despite_complete_history(self):
        with self.aggregate_case() as (root, planned, chain, settings, api):
            settings["opt_level"] = 3
            with self.assertRaisesRegex(ValueError, "current source or execution contract changed"):
                runner.aggregate(root, planned, chain, settings, self.root / "aggregate.json", api)

    def test_aggregate_accepts_documentation_only_continuation_with_omitted_successful_slots(self):
        with self.aggregate_case(current_slots=(0,)) as (root, planned, chain, settings, api):
            result = runner.aggregate(root, planned, chain, settings, self.root / "aggregate.json", api)
            self.assertEqual(result["state"], "complete")
            self.assertEqual(result["completed"], 17)
            detail = runner.read_json(self.root / "aggregate.json")
            self.assertNotEqual(detail["current_checkout"]["commit"], detail["original_tested_checkout"]["commit"])

    def test_aggregate_only_rerun_can_use_complete_history_after_current_validation(self):
        with self.aggregate_case(current_slots=()) as (root, planned, chain, settings, api):
            self.assertEqual(runner.aggregate(root, planned, chain, settings, self.root / "aggregate.json", api)["state"], "complete")

    def test_aggregate_rejects_failed_current_validation_even_with_complete_history(self):
        with self.aggregate_case(current_slots=(0,), failed=True) as (root, planned, chain, settings, api):
            result = runner.aggregate(root, planned, chain, settings, self.root / "aggregate.json", api)
            self.assertEqual(result["state"], "infrastructure_failure")
            self.assertEqual(result["completed"], 17)
            self.assertIn("repos/owner/repo/actions/runs/200/attempts/1/jobs?per_page=100&page=1", api.calls)

    def test_aggregate_rejects_failed_current_job_after_complete_bundle(self):
        with self.aggregate_case(current_slots=(0,), failed_after_upload=True) as (root, planned, chain, settings, api):
            result = runner.aggregate(root, planned, chain, settings, self.root / "aggregate.json", api)
            self.assertEqual(result["state"], "infrastructure_failure")
            self.assertEqual(result["reason"], "current_worker_validation_failed")

    def test_interrupt_freezes_prior_result_excludes_signal_fake_and_resumes_pending_first(self):
        first = raw_report(self.selected[:1], interrupted=True)
        fake = raw_report(self.selected, interrupted=True)
        argv = self.fixture(first, fake)
        root = self.root
        class CooperatingFixture(runner.OwnedProcess):
            def stop(self, seconds):
                # This fixture signal makes the child emit the same failure-shaped
                # result as a killed cargo test. The controller must already freeze.
                (root / "stop-request").touch()
                self.process.wait(timeout=1)
                super().stop(seconds)
        result = self.run_fixture(argv, factory=CooperatingFixture)
        self.assertTrue((self.root / "fake-written").exists())
        self.assertEqual(result["state"], "incomplete_with_progress")
        raw, delta = result["snapshot"]
        self.assertEqual(json.loads(raw), first)
        self.assertEqual([record["mutation_id"] for record in delta["records"]], self.ids[:1])
        remaining = runner.ordered_remaining(self.manifest, delta["records"], 0)
        self.assertEqual(remaining, self.ids[1:])
        resumed = raw_report(self.selected[1:])
        self.provenance = dict(self.provenance, attempt=2, execution_id="resumed")
        self.ids = remaining
        second_result = self.run_fixture(self.fixture(resumed, mode="exit"))
        self.assertEqual(second_result["state"], "complete")
        second = second_result["snapshot"][1]
        records = model.merge_deltas(self.manifest, [delta, second], allowed_run_ids={"100"},
                                     current_run_id="100", current_attempt=2, include_current=True)
        self.assertTrue(model.summarize(self.manifest, records, slot=0)["complete"])
        deltas = [delta, second]
        by_name = {item["name"]: item for item in self.items}
        for slot in range(1, 8):
            self.ids = model.slot_ids(self.manifest, slot)
            selected = [by_name[item["name"]] for item in self.manifest["mutations"] if item["id"] in self.ids]
            self.provenance = dict(self.provenance, execution_id=f"slot-{slot}")
            completed = self.run_fixture(self.fixture(raw_report(selected), mode="exit"), slot=slot)
            self.assertEqual(completed["state"], "complete")
            deltas.append(completed["snapshot"][1])
        records = model.merge_deltas(self.manifest, deltas, allowed_run_ids={"100"},
                                    current_run_id="100", current_attempt=2, include_current=True)
        summary = model.summarize(self.manifest, records)
        self.assertTrue(summary["complete"] and summary["policy_passed"])
        self.assertEqual(set(summary["completed"]), set(summary["planned"]))

    def test_partial_json_retains_last_valid_snapshot(self):
        first = raw_report(self.selected[:1], interrupted=True)
        result = self.run_fixture(self.fixture(first, mode="partial"))
        self.assertEqual(result["state"], "incomplete_with_progress")
        self.assertEqual(json.loads(result["snapshot"][0]), first)

    def test_initial_empty_report_does_not_kill_baseline(self):
        report = raw_report([], interrupted=True)
        report["outcomes"] = []
        result = self.run_fixture(self.fixture(report))
        self.assertEqual(result["state"], "incomplete_without_progress")
        self.assertIsNone(result["snapshot"])

    def test_real_timeout_is_preserved_for_policy(self):
        report = raw_report(self.selected, ["Timeout"] + ["CaughtMutant"] * (len(self.selected) - 1))
        result = self.run_fixture(self.fixture(report, mode="exit", code=3))
        self.assertEqual(result["state"], "complete")
        summary = model.summarize(self.manifest, result["snapshot"][1]["records"], slot=0)
        self.assertFalse(summary["policy_passed"])
        self.assertEqual(summary["failing"], self.ids[:1])

    def test_failed_baseline_is_not_progress(self):
        report = raw_report([], interrupted=True)
        report["outcomes"][0]["summary"] = "Failure"
        report["outcomes"][0]["phase_results"][1]["process_status"] = {"Failure": 101}
        result = self.run_fixture(self.fixture(report))
        self.assertEqual(result["state"], "baseline_failure")
        self.assertIsNone(result["snapshot"])

    def test_exit_two_requires_complete_report(self):
        report = raw_report(self.selected[:1])
        result = self.run_fixture(self.fixture(report, mode="exit", code=2))
        self.assertEqual(result["state"], "infrastructure_failure")
        self.assertIsNone(result["snapshot"])

    def test_usage_failure_cannot_supply_terminal_evidence(self):
        result = self.run_fixture(self.fixture(raw_report(self.selected), mode="exit", code=1))
        self.assertEqual(result["state"], "infrastructure_failure")
        self.assertIsNone(result["snapshot"])

    def test_cleanup_failure_discards_checkpoint(self):
        class FailingCleanup(runner.OwnedProcess):
            def stop(self, seconds):
                super().stop(seconds)
                raise OSError("fixture cleanup failure")
        result = self.run_fixture(self.fixture(raw_report(self.selected[:1], interrupted=True)), factory=FailingCleanup)
        self.assertEqual(result["reason"], "cleanup_failed")
        self.assertIsNone(result["snapshot"])

    def test_shutdown_reaps_owned_descendant_and_leaves_separate_process(self):
        argv = self.fixture(raw_report(self.selected[:1], interrupted=True))
        script = Path(argv[2])
        source = script.read_text()
        child = self.root / "child.py"
        child.write_text('''import pathlib, time
p = pathlib.Path(__file__).parent / "heartbeat"
for n in range(1000):
    p.write_text(str(n))
    time.sleep(.02)
''')
        source = source.replace('import json, pathlib, signal, sys, time', 'import json, pathlib, signal, sys, time, subprocess')
        source = source.replace('(p / "ready").write_text("yes")',
            '(p / "ready").write_text("yes")\nsubprocess.Popen([sys.executable, "-B", str(p / "child.py")])')
        script.write_text(source)
        separate = subprocess.Popen([sys.executable, "-B", "-c", "import time; time.sleep(10)"],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            result = self.run_fixture(argv)
            self.assertNotEqual(result["reason"], "cleanup_failed")
            heartbeat = (self.root / "heartbeat").read_bytes()
            time.sleep(.1)
            self.assertEqual((self.root / "heartbeat").read_bytes(), heartbeat)
            self.assertIsNone(separate.poll())
        finally:
            separate.terminate()
            separate.wait(timeout=3)

    def test_reordered_tool_results_are_rejected(self):
        result = self.run_fixture(self.fixture(raw_report(list(reversed(self.selected))), mode="exit"))
        self.assertEqual(result["state"], "infrastructure_failure")
        self.assertIn("reordered", result["reason"])

    def test_invalid_selection_diff_is_rejected(self):
        selected = copy.deepcopy(self.selected)
        selected[0]["diff"] += "wrong"
        with self.assertRaisesRegex(ValueError, "selection differs"):
            model.validate_selection(self.manifest, 0, selected, self.ids)

    def test_invalid_selection_never_launches_mutation_process(self):
        (self.root / "rust-toolchain.toml").write_text('[toolchain]\nchannel = "1.94.1"\n', encoding="utf-8")
        ctx = context()
        ctx["inputs"]["input_inventory"] = {"entries": []}
        manifest = model.build_manifest(self.items, ctx)
        settings = {"scope": "fixture", "repository": "owner/repo", "workflow": ".github/workflows/ci.yml",
                    "workflow_sha": "e" * 40, "run_id": "100", "attempt": 1, "job_id": "901", "slot": 0,
                    "job_started_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "shutdown_seconds": 3, "upload_seconds": 20, "validation_seconds": 5}
        selected = copy.deepcopy(self.selected)
        selected[0]["diff"] += "wrong"
        binary = self.root / "fixture-tool"
        binary.write_bytes(b"fixture tool bytes")
        tool = {"version": "27.1.0", "executable": str(binary), "binary_sha256": runner.artifacts.sha(binary.read_bytes())}
        def fake_command(argv, *args):
            return json.dumps(selected) if "--list" in argv else ""
        with mock.patch.object(runner, "collect_context", return_value=(ctx, {}, self.items)), \
             mock.patch.object(runner, "execution_environment", return_value=({}, {})), \
             mock.patch.object(runner, "installed_tool", return_value=tool), \
             mock.patch.object(runner.artifacts, "recover", return_value={"records": [], "bundles": []}), \
             mock.patch.object(runner, "capacity", return_value={"admit": True}), \
             mock.patch.object(runner, "command", side_effect=fake_command), \
             mock.patch.object(runner, "checkout_inventory", return_value=(ctx["checkout"], ctx["inputs"]["input_inventory"])), \
             mock.patch.object(runner, "run_controller") as controller:
            with self.assertRaisesRegex(ValueError, "selection differs"):
                runner.execute_slot(self.root, settings, {"manifest": manifest, "calibration": {}},
                                    {"max_attempts": 51}, self.root / "output", api=object())
            controller.assert_not_called()

    def test_capacity_uses_initial_job_timestamp_and_full_caps(self):
        settings = {"job_started_at": "2026-10-19T00:00:00Z", "build_cap_seconds": 600,
                    "shutdown_seconds": 30, "upload_seconds": 120, "validation_seconds": 30}
        calibration = {"build_seconds": 300, "test_seconds": 600, "test_cap_seconds": 2400}
        now = dt.datetime(2026, 10, 19, 1, 0, tzinfo=dt.timezone.utc).timestamp()
        self.assertFalse(runner.capacity(settings, calibration, now=now)["admit"])
        self.assertTrue(runner.capacity(settings, calibration, now=now - 3600)["admit"])

    def test_environment_strips_tokens_and_rejects_overrides(self):
        settings = {"opt_level": 2, "cargo_jobs": 2, "runtime": "fixture"}
        with mock.patch.object(Path, "exists", return_value=False):
            env, contract = runner.execution_environment(settings, {"PATH": "path", "GH_TOKEN": "secret", "GITHUB_TOKEN": "secret"})
            self.assertNotIn("GH_TOKEN", env)
            self.assertNotIn("secret", json.dumps(contract))
            self.assertEqual(env["CARGO_PROFILE_TEST_DEBUG_ASSERTIONS"], "true")
            self.assertEqual(env["CARGO_PROFILE_TEST_OVERFLOW_CHECKS"], "true")
            for key in ("CARGO_PROFILE_TEST_OPT_LEVEL", "RUSTFLAGS", "TERRI_WRITE_RUNTIME_FIXTURE"):
                with self.subTest(key=key), self.assertRaisesRegex(ValueError, "override"):
                    runner.execution_environment(settings, {key: "1"})

    def test_scope_binds_documented_save_and_all_native_roots(self):
        self.assertTrue(runner.scoped(runner.FILES[-1]))
        self.assertTrue(runner.scoped("tools/added/anything.md"))
        self.assertTrue(runner.scoped(".cargo/config.toml"))
        self.assertFalse(runner.scoped("docs/evidence/review.png"))
        self.assertEqual(sum(arg == "-p" for arg in runner.generation_argv("production")), 4)
        self.assertNotEqual(runner.generation_argv("production"), runner.generation_argv("fixture"))

    def test_clean_git_inventory_separates_docs_and_rejects_hidden_inputs(self):
        def git(*args):
            return subprocess.run(["git", "-c", "core.hooksPath=" + str(self.root / "no-hooks"),
                "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", *args],
                cwd=self.root, check=True, capture_output=True)
        git("init", "-b", "fixture")
        (self.root / "crates").mkdir()
        (self.root / "docs").mkdir()
        (self.root / "crates/input.rs").write_text("original\n")
        (self.root / "docs/prose.md").write_text("Original prose.\n")
        (self.root / ".gitignore").write_text("*.tmp\n")
        git("add", ".")
        git("commit", "-m", "Fixture input")
        checkout, before = runner.checkout_inventory(self.root, "owner/repo")
        (self.root / "docs/prose.md").write_text("Changed prose.\n")
        git("add", ".")
        git("commit", "-m", "Fixture prose")
        later, after = runner.checkout_inventory(self.root, "owner/repo")
        self.assertNotEqual(checkout["commit"], later["commit"])
        self.assertEqual(before, after)
        (self.root / "crates/input.tmp").write_text("ignored input")
        with self.assertRaisesRegex(ValueError, "ignored native input"):
            runner.checkout_inventory(self.root, "owner/repo")
        (self.root / "crates/input.tmp").unlink()
        git("update-index", "--assume-unchanged", "crates/input.rs")
        with self.assertRaisesRegex(ValueError, "hidden Git input"):
            runner.checkout_inventory(self.root, "owner/repo")

    def test_owned_paths_reject_ancestry_and_resolved_aliases(self):
        protected = self.root / "protected"
        protected.mkdir()
        owned = self.root / "owned"
        owned.mkdir()
        paths = [owned / name for name in ("source", "tmp", "target", "report")]
        runner.guard_owned_paths(protected, paths)
        with self.assertRaisesRegex(ValueError, "siblings"):
            runner.guard_owned_paths(protected, [paths[0], paths[0] / "tmp", *paths[2:]])
        with self.assertRaisesRegex(ValueError, "overlaps protected"):
            runner.guard_owned_paths(protected, [protected / path.name for path in paths])
        with self.assertRaisesRegex(ValueError, "siblings"):
            runner.guard_owned_paths(protected, [paths[0], owned / "tmp/../source", *paths[2:]])

    def test_regex_config_roundtrips_special_names(self):
        import tomllib
        path = self.root / "batch.toml"
        runner.batch_config(self.manifest, self.ids, path)
        expressions = tomllib.loads(path.read_text())["examine_re"]
        import re
        self.assertTrue(all(re.fullmatch(pattern, item["name"]) for pattern, item in zip(expressions, self.selected)))

    def test_three_identical_no_progress_attempts_stop(self):
        summary = model.summarize(self.manifest, [])
        bundles = [{"receipt": {"slot": 0}, "status": {"state": "incomplete_without_progress", "reason": "controller_deadline",
                    "recorded_at": str(attempt), "remaining": summary["remaining"]}} for attempt in range(3)]
        self.assertEqual(runner.continuation_status(summary, bundles)[1], "three_identical_no_progress_attempts")
        self.assertEqual(runner.continuation_status(summary, [], attempt=51)[1], "attempt_budget_exhausted")

    def test_snapshot_guard_detects_isolated_post_signal_read(self):
        source_dir = Path(__file__).parent
        names = ("mutation_runner.py", "mutation_runtime.py", "mutation_artifacts.py", "mutation_campaign.py", "test_mutation_runner.py", "test_mutation_campaign.py")
        before = {name: (source_dir / name).read_bytes() for name in names}
        with tempfile.TemporaryDirectory(prefix="snapshot-guard-control-") as directory:
            directory = Path(directory)
            for name, raw in before.items():
                (directory / name).write_bytes(raw)
            source = before["mutation_runner.py"].decode()
            old = "                    process.stop(shutdown_seconds)\n"
            new = old + '''                    raw = Path(report_path).read_bytes()
                    parsed = artifacts.strict_json(raw)
                    reference = {"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(parsed)}
                    snapshot = (raw, model.validate_report(manifest, slot, batch_ids, parsed, provenance=provenance,
                        raw_report_ref=reference, exit_kind="interrupted"))
'''
            self.assertEqual(source.count(old), 1)
            (directory / "mutation_runner.py").write_text(source.replace(old, new), encoding="utf-8")
            test = "test_interrupt_freezes_prior_result_excludes_signal_fake_and_resumes_pending_first"
            result = subprocess.run([sys.executable, "-B", "-m", "unittest", "test_mutation_runner.RunnerTests." + test],
                                    cwd=directory, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("FAIL: " + test, result.stderr)
            self.assertNotIn("ERROR:", result.stderr)
        self.assertEqual(before, {name: (source_dir / name).read_bytes() for name in names})

    def test_review_fix_guards_detect_isolated_removals(self):
        source_dir = Path(__file__).parent
        names = ("mutation_runner.py", "mutation_runtime.py", "mutation_artifacts.py", "mutation_campaign.py", "test_mutation_runner.py",
                 "test_mutation_artifacts.py", "test_mutation_campaign.py")
        before = {name: (source_dir / name).read_bytes() for name in names}
        current_context = '    context, _, _ = collect_context(root, settings, planned["calibration"])'
        unsafe_context = ('    context = dict(planned["manifest"]["context"], '
                          'checkout=checkout_inventory(root, settings["repository"])[0])')
        job_guard = '''    if (not workers and not summary["complete"]) or any(str(job["id"]) not in evidenced for job in workers):
        state, reason = "infrastructure_failure", "missing_worker_artifact"
    elif any(job["status"] != "completed" or (job["conclusion"] != "success"
             and evidenced[str(job["id"])]["status"]["state"] == "complete") for job in workers):
        state, reason = "infrastructure_failure", "current_worker_validation_failed"
'''
        controls = [
            ("direct-executable", "mutation_runner.py", '    return [str(executable), "mutants"]',
             '    return ["cargo", "mutants"]', "test_mutation_runner.RunnerTests.test_tool_resolution_hash_and_every_invocation_use_same_absolute_plugin"),
            ("executable-byte-binding", "mutation_runner.py", 'artifacts.sha(executable.read_bytes()) == tool["binary_sha256"]',
             'True', "test_mutation_runner.RunnerTests.test_tool_resolution_hash_and_every_invocation_use_same_absolute_plugin"),
            ("calibration-phase-boundary", "mutation_runner.py", '            input_guard.verify()\n            values[phase + "_seconds"]',
             '            values[phase + "_seconds"]', "test_mutation_runner.RunnerTests.test_calibration_rejects_owned_lock_and_native_drift_after_each_phase"),
            ("owned-result-bytes", "mutation_runner.py", 'require(current[name]["digest"] in allowed, "owned input bytes changed: " + name)',
             'require(True, "owned input bytes changed: " + name)', "test_mutation_runner.RunnerTests.test_controller_rejects_owned_lock_or_other_input_drift_with_valid_report"),
            ("current-source-binding", "mutation_runner.py", current_context, unsafe_context,
             "test_mutation_runner.RunnerTests.test_aggregate_rejects_changed_native_inputs_despite_complete_authenticated_history"),
            ("current-job-failure", "mutation_runner.py", job_guard, "",
             "test_mutation_runner.RunnerTests.test_aggregate_rejects_failed_current_validation_even_with_complete_history"),
            ("locked-duplicate", "mutation_campaign.py", '"--all-features", "--no-default-features", "--locked"):',
             '"--all-features", "--no-default-features"):',
             "test_mutation_campaign.CampaignTest.test_locked_option_is_preserved_and_duplicate_missing_or_extra_is_rejected"),
        ]
        results = []
        for label, filename, old, new, test in controls:
            with self.subTest(control=label), tempfile.TemporaryDirectory(prefix="mutation-review-fix-control-") as directory:
                directory = Path(directory)
                for name, raw in before.items():
                    (directory / name).write_bytes(raw)
                source = before[filename].decode()
                self.assertEqual(source.count(old), 1)
                (directory / filename).write_text(source.replace(old, new), encoding="utf-8")
                result = subprocess.run([sys.executable, "-B", "-m", "unittest", test], cwd=directory,
                                        capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("FAIL: " + test.rsplit(".", 1)[1], result.stderr)
                self.assertNotIn("ERROR:", result.stderr)
                results.append({"control": label, "test": test, "returncode": result.returncode,
                                "stdout": result.stdout, "stderr": result.stderr})
        self.assertEqual(before, {name: (source_dir / name).read_bytes() for name in names})
        if os.environ.get("MUTATION_CONTROL_LOG_DIR"):
            runner.write_json(Path(os.environ["MUTATION_CONTROL_LOG_DIR"]) / "fix-controls.json",
                {"results": results, "source_unchanged": True,
                 "source_hashes": {name: runner.artifacts.sha(raw) for name, raw in before.items()}})

    def test_active_write_observation_controls_detect_removed_guards(self):
        source_dir = Path(__file__).parent
        names = ("mutation_runner.py", "mutation_runtime.py", "mutation_artifacts.py", "mutation_campaign.py", "test_mutation_runner.py",
                 "test_mutation_artifacts.py", "test_mutation_campaign.py")
        before = {name: (source_dir / name).read_bytes() for name in names}
        controls = [
            ("reject-transient-write", 'if defer_active_write and current[name]["digest"] not in allowed:',
             'if False and current[name]["digest"] not in allowed:',
             "test_partial_active_apply_write_is_deferred_until_exact_bytes"),
            ("accept-partial-bytes", '            raise ActiveInputTransition(transition)', '            return',
             "test_shutdown_after_deferred_read_does_not_import_unaccepted_terminal_records"),
            ("omit-final-source-check", '            input_guard.verify(completed, active=interrupted)', '            pass',
             "test_permanent_corrupt_active_file_is_rejected_after_stop"),
        ]
        results = []
        for label, old, new, test in controls:
            with self.subTest(control=label), tempfile.TemporaryDirectory(prefix="mutation-active-write-control-") as directory:
                directory = Path(directory)
                for name, raw in before.items():
                    (directory / name).write_bytes(raw)
                source = before["mutation_runner.py"].decode()
                self.assertEqual(source.count(old), 1)
                (directory / "mutation_runner.py").write_text(source.replace(old, new), encoding="utf-8")
                result = subprocess.run([sys.executable, "-B", "-m", "unittest", "test_mutation_runner.RunnerTests." + test],
                                        cwd=directory, capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn("FAIL: " + test, result.stderr)
                self.assertNotIn("ERROR:", result.stderr)
                results.append({"control": label, "test": test, "returncode": result.returncode,
                                "stdout": result.stdout, "stderr": result.stderr})
        self.assertEqual(before, {name: (source_dir / name).read_bytes() for name in names})
        if os.environ.get("MUTATION_FIX2_CONTROL_LOG_DIR"):
            runner.write_json(Path(os.environ["MUTATION_FIX2_CONTROL_LOG_DIR"]) / "active-write-controls.json",
                {"results": results, "source_unchanged": True,
                 "source_hashes": {name: runner.artifacts.sha(raw) for name, raw in before.items()}})


if __name__ == "__main__":
    unittest.main()
