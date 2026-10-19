"""Bounded whole-workspace mutation execution and immutable attempt bundles."""

import argparse
import contextlib
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
import mutation_campaign as model
import mutation_artifacts as artifacts

ROOTS = ("crates/", "content/", "assets/", "web/", "scripts/", "tools/", ".github/", ".cargo/")
FILES = ("Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "rust-toolchain", ".gitignore",
         ".gitattributes", "docs/mutants-baseline.txt",
         "docs/evidence/2026-10-17-room-identities/published-v15-producer/published-v15-golden-public-100.sav")
PACKAGES = ("terri-core", "terri-sim", "terri-data", "terri-wasm")
STATES = {"complete": 0, "incomplete_with_progress": 10, "incomplete_without_progress": 11,
          "baseline_failure": 20, "policy_failure": 21, "infrastructure_failure": 22, "capacity_failure": 23}
require = artifacts.require
COMMAND_DEADLINE = math.inf
FIXTURE_CARGO = '[package]\nname = "mutation-fixture"\nversion = "0.1.0"\nedition = "2021"\n[workspace]\n'
FIXTURE_LOCK = 'version = 4\n\n[[package]]\nname = "mutation-fixture"\nversion = "0.1.0"\n'
FIXTURE_SOURCE = "\n".join(f"pub fn value_{i}() -> u32 {{ {i + 10} }}" for i in range(12)) + "\n" + (
    "#[cfg(test)] mod tests { use super::*; #[test] fn all_values() {\n" +
    "\n".join(f"assert_eq!(value_{i}(), {i + 10}); std::thread::sleep(std::time::Duration::from_millis(50));" for i in range(12))
    + "\n} }\n")


@contextlib.contextmanager
def selected_workspace(root, scope):
    if scope == "production":
        yield Path(root)
    else:
        require(scope == "fixture", "invalid computation scope")
        require(not Path(tempfile.gettempdir()).resolve().is_relative_to(Path(root).resolve()),
                "fixture temporary directory is inside protected checkout")
        with tempfile.TemporaryDirectory(prefix="mutation-small-fixture-") as directory:
            path = Path(directory)
            (path / "src").mkdir()
            (path / "Cargo.toml").write_text(FIXTURE_CARGO, encoding="utf-8")
            (path / "Cargo.lock").write_text(FIXTURE_LOCK, encoding="utf-8")
            (path / "src/lib.rs").write_text(FIXTURE_SOURCE, encoding="utf-8")
            yield path


def guard_owned_paths(root, paths):
    protected = Path(root).resolve()
    resolved = [Path(path).resolve() for path in paths]
    require(len(set(resolved)) == len(resolved) and len({path.parent for path in resolved}) == 1,
            "owned source, temporary, target and report paths must be disjoint siblings")
    require(all(not path.is_relative_to(protected) and not protected.is_relative_to(path) for path in resolved),
            "owned path overlaps protected checkout")


def owned_environment(env, scratch):
    scratch = Path(scratch)
    for name in ("tmp", "target", "attempt"):
        (scratch / name).mkdir(exist_ok=True)
    return dict(env, CARGO_TARGET_DIR=str(scratch / "target"), TMPDIR=str(scratch / "tmp"),
                TMP=str(scratch / "tmp"), TEMP=str(scratch / "tmp"))


class CapacityFailure(ValueError):
    pass


def bound_setup(settings):
    global COMMAND_DEADLINE
    COMMAND_DEADLINE = artifacts.timestamp(settings["job_started_at"]).timestamp() + 7200 - (
        settings["shutdown_seconds"] + settings["validation_seconds"] + settings["upload_seconds"])


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temp.replace(path)


def read_json(path):
    return artifacts.strict_json(Path(path).read_bytes())


def command(argv, cwd, env=None):
    remaining = min(300, COMMAND_DEADLINE - time.time())
    if remaining <= 3:
        raise CapacityFailure("setup consumed the safe job window")
    with tempfile.TemporaryFile() as log:
        process = OwnedProcess(argv, cwd=cwd, env=env, log=log)
        try:
            code = process.process.wait(timeout=remaining - 3)
        finally:
            process.stop(3)
        log.seek(0)
        raw = log.read()
    if code != 0:
        raise subprocess.CalledProcessError(code, argv, output=raw)
    return raw.decode("utf-8").strip()


def scoped(path):
    return path in FILES or path.startswith(ROOTS)


def checkout_inventory(root, repository):
    root = Path(root).resolve()
    require(not command(["git", "status", "--porcelain", "--untracked-files=normal"], root),
            "source checkout is dirty")
    require(not any(line[:1].islower() or line.startswith("S ") for line in
                    command(["git", "ls-files", "-v"], root).splitlines()), "hidden Git input changes")
    extras = command(["git", "ls-files", "--others", "--ignored", "--exclude-standard"], root).splitlines()
    # Generated wasm bindings are documented build output, not authored inputs.
    generated = ("web/src/wasm/", ".github/scripts/__pycache__/")
    require(not any(scoped(path) and not path.startswith(generated) for path in extras),
            "ignored native input exists")
    rows = []
    raw = subprocess.run(["git", "ls-files", "--stage", "-z"], cwd=root, check=True,
                         stdout=subprocess.PIPE).stdout
    for record in raw.split(b"\0"):
        if not record:
            continue
        metadata, path_bytes = record.split(b"\t", 1)
        mode, blob, stage = metadata.decode().split()
        path = path_bytes.decode("utf-8")
        if scoped(path):
            require(mode in ("100644", "100755") and stage == "0", "nonregular tracked input")
            require(not (root / path).is_symlink(), "input symlink")
            rows.append({"path": path, "mode": mode, "git_blob": blob})
    rows.sort(key=lambda row: row["path"])
    inventory = {"version": 1, "representation": "clean-git-blob-sha1", "roots": list(ROOTS),
                 "files_including_absent": list(FILES), "excluded_generated": list(generated), "entries": rows}
    checkout = {"repository": repository, "commit": command(["git", "rev-parse", "HEAD"], root),
                "tree": command(["git", "rev-parse", "HEAD^{tree}"], root),
                "ref": command(["git", "rev-parse", "--symbolic-full-name", "HEAD"], root),
                "clean": True}
    return checkout, inventory


def execution_environment(settings, environ=None):
    inherited = dict(os.environ if environ is None else environ)
    forbidden = {"TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR",
                 "TERRI_PRIVATE_PREVIEW_SAVE", "RUSTFLAGS", "RUSTDOCFLAGS", "RUSTC", "RUSTDOC",
                 "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "CARGO_ENCODED_RUSTFLAGS", "RUSTUP_TOOLCHAIN"}
    require(not (forbidden & inherited.keys()), "undeclared compiler or fixture override")
    require(not any(key.startswith("CARGO_") and key not in {"CARGO_HOME", "CARGO_TERM_COLOR"}
                    for key in inherited), "undeclared Cargo override")
    opt = settings["opt_level"]
    require(type(opt) is int and 0 <= opt <= 3, "optimization level must be explicit")
    require(type(settings["cargo_jobs"]) is int and 1 <= settings["cargo_jobs"] <= 2, "invalid Cargo worker count")
    explicit = {"CARGO_PROFILE_TEST_OPT_LEVEL": str(opt), "CARGO_PROFILE_DEV_OPT_LEVEL": str(opt),
                "CARGO_PROFILE_TEST_DEBUG_ASSERTIONS": "true", "CARGO_PROFILE_DEV_DEBUG_ASSERTIONS": "true",
                "CARGO_PROFILE_TEST_OVERFLOW_CHECKS": "true", "CARGO_PROFILE_DEV_OVERFLOW_CHECKS": "true",
                "CARGO_BUILD_JOBS": str(settings["cargo_jobs"]), "CARGO_TERM_COLOR": "never"}
    keep = {"PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR",
            "CARGO_HOME", "RUSTUP_HOME", "PATHEXT", "COMSPEC", "LANG", "LC_ALL"}
    environment = {key: value for key, value in inherited.items() if key in keep}
    environment.update(explicit)
    configs = {}
    homes = {Path(inherited.get("CARGO_HOME", str(Path.home() / ".cargo"))), Path.home() / ".cargo"}
    for home in homes:
        for name in ("config", "config.toml"):
            path = home / name
            if path.exists():
                # External Cargo config can redirect rustc and inject arbitrary settings.
                raise ValueError("external Cargo config is not permitted; use tracked .cargo configuration")
    return environment, {"variables": explicit, "external_cargo_config": configs,
                         "platform": sys.platform, "locale": {key: environment.get(key) for key in ("LANG", "LC_ALL")},
                         "runner_image": settings["runner_image"], "tool_added_rustflags": "--cap-lints=warn",
                         "owned_path_layout": {"version": 1, "CARGO_TARGET_DIR": "target", "TMPDIR": "tmp", "TMP": "tmp", "TEMP": "tmp"}}


def generation_argv(scope, tool=None):
    require(scope in {"production", "fixture"}, "invalid computation scope")
    packages = PACKAGES if scope == "production" else ("mutation-fixture",)
    prefix = tool_argv(tool) if tool else ["cargo-mutants", "mutants"]
    return prefix + ["--list", "--json", "--no-config"] + [arg for package in packages for arg in ("-p", package)]


def tool_identity(tool):
    return {key: tool[key] for key in ("version", "binary_sha256")}


def tool_argv(tool):
    executable = Path(tool["executable"])
    require(executable.is_absolute() and artifacts.sha(executable.read_bytes()) == tool["binary_sha256"],
            "resolved cargo-mutants executable changed")
    # cargo-mutants is a Cargo plugin: its parser still requires the mutants argument.
    return [str(executable), "mutants"]


def execution_argv(settings, calibration, tool, config, output_parent):
    packages = PACKAGES if settings["scope"] == "production" else ("mutation-fixture",)
    selectors = [argument for package in packages for argument in ("-p", package)]
    return [*tool_argv(tool), *selectors, "--config", str(config), "--test-workspace", "false", "--cap-lints", "true",
            "--cargo-arg=--workspace", "--cargo-arg=--locked", "--timeout", str(calibration["test_cap_seconds"]),
            "--build-timeout", str(settings["build_cap_seconds"]), "--jobs", "1", "--no-shuffle",
            "--in-place", "--output", str(output_parent)]


def installed_tool(root, env):
    paths = env.get("PATH", "").split(os.pathsep)
    cargo_bin = Path(env.get("CARGO_HOME", str(Path.home() / ".cargo"))).resolve() / "bin"
    if cargo_bin not in {Path(path).resolve() for path in paths if path}:
        paths.insert(0, str(cargo_bin))
    binary = shutil.which("cargo-mutants", path=os.pathsep.join(paths))
    require(binary is not None, "cargo-mutants executable was not resolved")
    binary = Path(binary).resolve(strict=True)
    tool = {"version": model.TOOL_VERSION, "binary_sha256": artifacts.sha(binary.read_bytes()), "executable": str(binary)}
    version = command(tool_argv(tool) + ["--version"], root, env)
    require(version == "cargo-mutants 27.1.0", "wrong cargo-mutants version")
    tool_argv(tool)
    return tool


def mutation_bytes(original, mutation):
    """Pinned 27.1.0 SourceFile normalization and Span.replace character semantics."""
    source = original.decode("utf-8").replace("\r\n", "\n")
    start, end = mutation["span"]["start"], mutation["span"]["end"]
    start, end = (start["line"], start["column"]), (end["line"], end["column"])
    replacement = mutation["replacement"] + " /* ~ changed by cargo-mutants ~ */"
    line, column, result = 1, 1, []
    for character in source:
        if (line, column) == start:
            result.append(replacement)
        if (line, column) < start or (line, column) >= end:
            result.append(character)
        if character == "\n":
            line, column = line + 1, 1
        elif character != "\r":
            column += 1
    if (line, column) == start:
        result.append(replacement)
    return "".join(result).encode("utf-8")


class ActiveInputTransition(ValueError):
    """The running tool's pending file was observed between permitted byte states."""


class OwnedInputs:
    """Validate actual compiled bytes, permitting only the next explicit mutation."""
    def __init__(self, root, scope):
        self.root, self.scope = Path(root).resolve(), scope
        self.baseline = self.read_state()
        self.mutations, self.sources, self.batch = {}, {}, []

    def read_state(self):
        paths = set()
        if self.scope == "fixture":
            paths.update(path for path in self.root.rglob("*") if path.is_file() or path.is_symlink())
        else:
            for prefix in ROOTS:
                directory = self.root / prefix
                require(not directory.is_symlink(), "owned input directory became a symlink")
                if directory.exists():
                    paths.update(path for path in directory.rglob("*") if path.is_file() or path.is_symlink())
            paths.update(self.root / name for name in FILES if (self.root / name).exists() or (self.root / name).is_symlink())
        result = {}
        for path in sorted(paths):
            name = path.relative_to(self.root).as_posix()
            if name.startswith(("web/src/wasm/", ".github/scripts/__pycache__/")):
                continue
            require(not path.is_symlink() and path.resolve().is_relative_to(self.root)
                    and stat.S_ISREG(path.stat().st_mode), "owned input is not a bounded regular file")
            result[name] = {"digest": artifacts.sha(path.read_bytes()), "mode": stat.S_IMODE(path.stat().st_mode)}
        return result

    def configure(self, manifest, batch):
        self.batch = list(batch)
        self.mutations = {item["id"]: item for item in manifest["mutations"] if item["id"] in batch}
        for item in self.mutations.values():
            require(item["file"] in self.baseline, "mutation file is outside frozen owned inputs")
            self.sources[item["file"]] = (self.root / item["file"]).read_bytes()
            require(artifacts.sha(self.sources[item["file"]]) == self.baseline[item["file"]]["digest"],
                    "owned source changed while preparing mutation expectations")

    def verify(self, completed=0, *, active=False, defer_active_write=False):
        current = self.read_state()
        require(set(current) == set(self.baseline), "owned input paths changed")
        pending = self.mutations[self.batch[completed]] if active and completed < len(self.batch) else None
        transition = None
        for name, expected in self.baseline.items():
            require(current[name]["mode"] == expected["mode"], "owned input mode changed: " + name)
            allowed = {expected["digest"]}
            if name in self.sources:
                allowed.add(artifacts.sha(self.sources[name].replace(b"\r\n", b"\n")))
            if pending is not None and pending["file"] == name:
                allowed.add(artifacts.sha(mutation_bytes(self.sources[name], pending)))
                if defer_active_write and current[name]["digest"] not in allowed:
                    transition = name
                    continue
            require(current[name]["digest"] in allowed, "owned input bytes changed: " + name)
        if transition is not None:
            raise ActiveInputTransition(transition)


class ChangingSnapshot(Exception):
    pass


def collect_context(root, settings, calibration, *, tool=None):
    checkout, inventory = checkout_inventory(root, settings["repository"])
    require(FILES[-1] in {row["path"] for row in inventory["entries"]}, "published V15 fixture is not tracked")
    env, contract_env = execution_environment(settings)
    tool = tool or installed_tool(root, env)
    toolchain = {tool: command([tool, "--version", "--verbose"], root, env) for tool in ("rustc", "cargo")}
    require(calibration["scope"] == settings["scope"] and calibration["inventory_digest"] == model.digest(inventory)
            and calibration["environment"] == contract_env and calibration["toolchain"] == toolchain
            and calibration["cargo_mutants_identity"] == tool_identity(tool),
            "calibration does not match complete execution inputs")
    require(calibration["slot"] == 0 and calibration["build_status"] == 0 and calibration["test_status"] == 0,
            "calibration requires a passing slotted workspace build/test")
    require(all(type(calibration[key]) in (int, float) and math.isfinite(calibration[key]) and calibration[key] > 0
                for key in ("build_seconds", "test_seconds")), "invalid calibration timings")
    require(calibration["test_cap_seconds"] == max(120, math.ceil(calibration["test_seconds"] * 4)),
            "absolute test cap differs from fixed calibration policy")
    workflow = settings["workflow"]
    with selected_workspace(root, settings["scope"]) as workspace:
        listing = artifacts.strict_json(command(generation_argv(settings["scope"], tool), workspace, env))
    def subset(prefixes):
        return model.digest([row for row in inventory["entries"] if row["path"].startswith(prefixes)])
    inputs = {"source_digest": model.digest(inventory), "test_digest": subset(("crates/", "web/", "docs/evidence/")),
              "config_digest": subset((".cargo/", "Cargo.toml", "rust-toolchain")), "lock_digest": subset(("Cargo.lock",)),
              "workflow_digest": subset((".github/workflows/",)), "runner_digest": subset((".github/scripts/",)),
              "survivor_baseline_digest": subset(("docs/mutants-baseline.txt",)),
              "survivor_baseline_file_digest": artifacts.sha((Path(root) / "docs/mutants-baseline.txt").read_bytes()),
              "workflow_file_digest": artifacts.sha((Path(root) / workflow).read_bytes()),
              "toolchain": toolchain, "cargo_mutants_version": "27.1.0", "generation_argv": generation_argv(settings["scope"]),
              "cargo_mutants_identity": tool_identity(tool),
              "build_argv": ["cargo", "test", "--no-run", "--verbose", "--workspace", "--locked"],
              "test_argv": ["cargo", "test", "--verbose", "--workspace", "--locked"], "profile": "test", "target": None,
              "features": [], "environment": contract_env, "scope_version": 1, "computation_scope": settings["scope"],
              "timeout_policy": {"build_seconds": settings["build_cap_seconds"], "test_seconds": calibration["test_cap_seconds"]},
              "calibration_digest": model.digest(calibration), "input_inventory": inventory,
              "generation_order": [item["name"] for item in listing],
              "execution_settings": {key: settings[key] for key in ("opt_level", "cargo_jobs", "scope")}}
    inputs["cargo_mutants_settings"] = {"cap_lints": True, "shuffle": False, "test_workspace": False,
                                       "cargo_args": ["--workspace", "--locked"], "jobs": 1, "baseline": "run"}
    if settings["scope"] == "fixture":
        inputs["fixture_digest"] = model.digest({"Cargo.toml": FIXTURE_CARGO, "Cargo.lock": FIXTURE_LOCK, "src/lib.rs": FIXTURE_SOURCE})
    return {"inputs": inputs, "checkout": checkout,
            "run": {"run_id": settings["run_id"], "workflow": workflow}}, env, listing


def capacity(settings, calibration, *, now=None):
    now = time.time() if now is None else now
    started = artifacts.timestamp(settings["job_started_at"]).timestamp()
    require(started <= now, "job start is in the future")
    return model.admit_work(7200, elapsed_seconds=now - started,
        baseline_seconds=max(calibration["build_seconds"] + calibration["test_seconds"],
                             settings["build_cap_seconds"] + calibration["test_cap_seconds"]),
        build_cap_seconds=settings["build_cap_seconds"], test_cap_seconds=calibration["test_cap_seconds"],
        shutdown_seconds=settings["shutdown_seconds"], upload_seconds=settings["upload_seconds"] + settings["validation_seconds"])


class OwnedProcess:
    """Own an OS process group; Windows also uses a kill-on-close Job Object."""
    def __init__(self, argv, *, cwd, env, log):
        self.job = None
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x00000004 if os.name == "nt" else 0
        self.process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=os.name != "nt", creationflags=flags)
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.CreateJobObjectW.restype = wintypes.HANDLE
            kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            kernel.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
            kernel.QueryInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p,
                                                         wintypes.DWORD, ctypes.c_void_p]
            class BasicLimits(ctypes.Structure):
                _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                            ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
                            ("max_working_set", ctypes.c_size_t), ("active_limit", wintypes.DWORD),
                            ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]
            class Limits(ctypes.Structure):
                _fields_ = [("basic", BasicLimits), ("io_counters", ctypes.c_ulonglong * 6),
                            ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                            ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]
            limits = Limits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            self.kernel = kernel
            self.job = kernel.CreateJobObjectW(None, None)
            if (not self.job or not kernel.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits))
                    or not kernel.AssignProcessToJobObject(self.job, int(self.process._handle))):
                self.process.kill()
                self.process.wait()
                if self.job:
                    kernel.CloseHandle(self.job)
                raise OSError("cannot establish owned Windows process job")
            status = ctypes.WinDLL("ntdll").NtResumeProcess(wintypes.HANDLE(int(self.process._handle)))
            if status != 0:
                kernel.TerminateJobObject(self.job, 1)
                self.process.wait()
                kernel.CloseHandle(self.job)
                raise OSError("cannot resume owned process")

    def poll(self):
        return self.process.poll()

    def stop(self, seconds):
        require(seconds > 0, "shutdown budget must be positive")
        until = time.monotonic() + seconds
        if os.name == "nt":
            import ctypes
            if self.poll() is None:
                try:
                    self.process.send_signal(signal.CTRL_BREAK_EVENT)
                    self.process.wait(timeout=min(seconds / 2, 2))
                except (OSError, subprocess.TimeoutExpired):
                    pass
            require(bool(self.kernel.TerminateJobObject(self.job, 1)), "owned process job termination failed")
            self.process.wait(timeout=max(.001, until - time.monotonic()))
            accounting = ctypes.create_string_buffer(48)
            while True:
                require(bool(self.kernel.QueryInformationJobObject(self.job, 1, accounting, 48, None)),
                        "cannot verify owned job cleanup")
                active = int.from_bytes(accounting.raw[40:44], "little")
                if active == 0:
                    break
                require(time.monotonic() < until, "owned child remains alive")
                time.sleep(.01)
            self.kernel.CloseHandle(self.job)
            self.job = None
        else:
            group = self.process.pid
            try:
                os.killpg(group, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.process.wait(timeout=min(seconds / 2, 2))
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.process.wait(timeout=max(.001, until - time.monotonic()))
            # A live descendant keeps its process group alive. Zombies cannot write.
            if Path("/proc").exists():
                for path in Path("/proc").glob("[0-9]*/stat"):
                    try:
                        fields = path.read_text().rsplit(")", 1)[1].split()
                        require(not (int(fields[2]) == group and fields[0] != "Z"), "owned child remains alive")
                    except (FileNotFoundError, ProcessLookupError):
                        pass


def run_controller(argv, *, cwd, env, report_path, manifest, slot, batch_ids, provenance,
                   deadline, shutdown_seconds, log_path, poll_seconds=0.1, process_factory=OwnedProcess,
                   stop_after_records=None, input_guard=None):
    """Freeze the last validated bytes before signaling. Never read after signaling."""
    require(stop_after_records is None or (manifest["context"]["inputs"].get("computation_scope") == "fixture"
            and type(stop_after_records) is int and stop_after_records > 0), "invalid fixture interruption request")
    require(not Path(report_path).exists(), "attempt report path must be fresh")
    snapshot = None
    invalid = None
    baseline_failed = False
    process = None
    interrupted = False
    status = None
    cleanup_error = None
    stop_reason = "controller_deadline"
    source_completed = 0
    with Path(log_path).open("wb") as log:
        try:
            process = process_factory(argv, cwd=cwd, env=env, log=log)
            while True:
                status = process.poll()
                try:
                    raw = Path(report_path).read_bytes()
                    if status is None and snapshot is not None and raw == snapshot[0]:
                        raise ChangingSnapshot()
                    parsed = artifacts.strict_json(raw)
                    if parsed.get("outcomes") and parsed["outcomes"][0].get("scenario") == "Baseline":
                        baseline_failed = parsed["outcomes"][0].get("summary") != "Success"
                    ref = {"path": "raw/outcomes.json", "digest": artifacts.sha(raw), "content_digest": model.digest(parsed)}
                    if parsed.get("outcomes") == [] and parsed.get("cargo_mutants_version") == model.TOOL_VERSION:
                        require(all(parsed.get(key) == 0 for key in ("total_mutants", "caught", "missed", "timeout", "unviable", "success")),
                                "empty report has nonzero counters")
                    else:
                        delta = model.validate_report(manifest, slot, batch_ids, parsed, provenance=provenance,
                            raw_report_ref=ref, exit_kind="completed" if status in (0, 2, 3) else "interrupted")
                        observed = [record["mutation_id"] for record in delta["records"]]
                        require(observed == batch_ids[:len(observed)], "tool reordered the explicit batch")
                        if input_guard is not None:
                            try:
                                input_guard.verify(len(observed), active=status is None, defer_active_write=status is None)
                            except ActiveInputTransition:
                                source_completed = len(observed)
                                raise ChangingSnapshot()
                            except ValueError:
                                if Path(report_path).read_bytes() != raw:
                                    raise ChangingSnapshot()
                                raise
                            source_completed = len(observed)
                            if Path(report_path).read_bytes() != raw:
                                raise ChangingSnapshot()
                        snapshot, invalid = (raw, delta), None
                except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError, ChangingSnapshot):
                    pass
                except ValueError as error:
                    invalid = str(error)
                if status is not None:
                    break
                if (time.time() >= deadline or invalid or baseline_failed or
                        (stop_after_records is not None and snapshot and len(snapshot[1]["records"]) >= stop_after_records)):
                    interrupted = True
                    if stop_after_records is not None and snapshot and len(snapshot[1]["records"]) >= stop_after_records:
                        stop_reason = "fixture_checkpoint"
                    break
                time.sleep(poll_seconds)
        finally:
            if process is not None:
                # snapshot is frozen at this boundary, before the first signal.
                try:
                    process.stop(shutdown_seconds)
                except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                    cleanup_error = str(error)
    if cleanup_error is not None:
        return {"state": "infrastructure_failure", "reason": "cleanup_failed", "detail": cleanup_error,
                "returncode": status, "snapshot": None}
    if input_guard is not None:
        try:
            # A deferred pre-signal report can locate the pending source file without
            # contributing any terminal records to the frozen accepted snapshot.
            completed = source_completed if interrupted else (len(snapshot[1]["records"]) if snapshot else 0)
            input_guard.verify(completed, active=interrupted)
        except ValueError as error:
            return {"state": "infrastructure_failure", "reason": "owned_inputs_changed", "detail": str(error),
                    "returncode": status, "snapshot": None}
    if baseline_failed or status == 4:
        state, reason = "baseline_failure", "baseline_failed"
        snapshot = None
    elif invalid:
        state, reason = "infrastructure_failure", "invalid_report: " + invalid
        snapshot = None
    elif not interrupted and status not in (0, 2, 3):
        state, reason = "infrastructure_failure", "tool_exit"
        snapshot = None
    elif not interrupted and (snapshot is None or snapshot[1]["exit_kind"] != "completed"):
        state, reason = "infrastructure_failure", "missing_completed_report"
        snapshot = None
    elif interrupted:
        state = "incomplete_with_progress" if snapshot and snapshot[1]["records"] else "incomplete_without_progress"
        reason = stop_reason
    else:
        state, reason = "complete", "tool_completed"
    return {"state": state, "reason": reason, "returncode": status, "snapshot": snapshot}


def batch_config(manifest, ids, path):
    names = {item["id"]: item["name"] for item in manifest["mutations"]}
    # JSON strings are valid TOML basic strings. Escape only Rust regex metacharacters.
    expressions = ["^" + re.sub(r"([\\.^$|?*+()\[\]{}])", r"\\\1", names[mid]) + "$" for mid in ids]
    Path(path).write_text("examine_re = " + json.dumps(expressions, ensure_ascii=False) + "\n", encoding="utf-8")


def ordered_remaining(manifest, records, slot):
    completed = {record["mutation_id"] for record in records}
    assigned = set(model.slot_ids(manifest, slot))
    by_name = {item["name"]: item["id"] for item in manifest["mutations"]}
    order = manifest["context"]["inputs"].get("generation_order", list(by_name))
    require(len(order) == len(by_name) and set(order) == set(by_name), "invalid generation order")
    return [by_name[name] for name in order if by_name[name] in assigned and by_name[name] not in completed]


def continuation_status(summary, bundles, *, slot=None, max_attempts=51, attempt=1):
    relevant = [bundle for bundle in bundles if slot is None or bundle["receipt"]["slot"] == slot]
    for bundle in relevant:
        if bundle["status"]["state"] in {"baseline_failure", "policy_failure", "infrastructure_failure", "capacity_failure"}:
            return bundle["status"]["state"], "prior_attempt_failure"
    if summary["failing"]:
        return "policy_failure", "timeout_or_unaccepted_survivor"
    if summary["complete"]:
        return "complete", "exact_coverage"
    if attempt >= max_attempts:
        return "capacity_failure", "attempt_budget_exhausted"
    for slot_id in ([slot] if slot is not None else range(8)):
        history = sorted((bundle for bundle in relevant if bundle["receipt"]["slot"] == slot_id),
                         key=lambda bundle: bundle["status"]["recorded_at"])
        tail = history[-3:]
        if len(tail) == 3 and all(bundle["status"]["state"] == "incomplete_without_progress" for bundle in tail):
            keys = {(bundle["status"]["reason"], tuple(bundle["status"].get("remaining", []))) for bundle in tail}
            if len(keys) == 1:
                return "capacity_failure", "three_identical_no_progress_attempts"
    progressed = any(bundle["status"]["state"] == "incomplete_with_progress" for bundle in relevant)
    return ("incomplete_with_progress" if progressed else "incomplete_without_progress"), "remaining_work"


def retain_bundle(output, manifest, receipt, result, *, report_parent=None, summary=None):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    snapshot = result.pop("snapshot", None)
    delta = snapshot[1] if snapshot else None
    if snapshot:
        raw_path = output / "raw/outcomes.json"
        raw_path.parent.mkdir()
        raw_path.write_bytes(snapshot[0])
        outcomes = [delta["baseline"]["outcome"]] + [record["outcome"] for record in delta["records"]]
        for outcome in outcomes:
            for key in ("log_path", "diff_path"):
                if outcome[key] is None:
                    continue
                relative = artifacts.safe_path(outcome[key])
                source = Path(report_parent) / relative
                require(source.is_file() and not source.is_symlink(), "missing or unsafe referenced evidence")
                require(source.resolve().is_relative_to(Path(report_parent).resolve()), "evidence escapes report root")
                target = output / "evidence" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
    result["recorded_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    if summary is not None:
        result["remaining"] = summary["remaining"]
    bundle = {"version": 1, "manifest": manifest, "receipt": receipt, "delta": delta, "status": result}
    write_json(output / "bundle.json", bundle)
    print("MUTATION_PRODUCER " + json.dumps(receipt, sort_keys=True, separators=(",", ":")), flush=True)
    return bundle


def calibrate(root, settings, output):
    bound_setup(settings)
    require(settings["slot"] == 0, "calibration must own shared slot zero")
    checkout, inventory = checkout_inventory(root, settings["repository"])
    env, contract_env = execution_environment(settings)
    env["CARGO_ENCODED_RUSTFLAGS"] = "--cap-lints=warn"
    tool = installed_tool(root, env)
    started = artifacts.timestamp(settings["job_started_at"]).timestamp()
    reserve = settings["shutdown_seconds"] + settings["upload_seconds"] + settings["validation_seconds"]
    deadline = started + 7200 - reserve
    values = {}
    require(not Path(tempfile.gettempdir()).resolve().is_relative_to(Path(root).resolve()),
            "temporary root overlaps protected checkout")
    with tempfile.TemporaryDirectory(prefix="mutation-calibration-") as scratch, selected_workspace(root, settings["scope"]) as fixture:
        scratch = Path(scratch)
        copy = scratch / "source"
        guard_owned_paths(root, [copy, scratch / "tmp", scratch / "target", scratch / "attempt"])
        command(["git", "clone", "--quiet", "--no-hardlinks", "--no-checkout", str(Path(root).resolve()), str(copy)], root)
        command(["git", "checkout", "--quiet", "--detach", checkout["commit"]], copy)
        require(checkout_inventory(copy, settings["repository"])[1] == inventory, "calibration source copy differs")
        env = owned_environment(env, scratch)
        workspace = copy
        if settings["scope"] == "fixture":
            workspace = scratch / "fixture"
            shutil.copytree(fixture, workspace)
        guard_owned_paths(root, [workspace, scratch / "tmp", scratch / "target", scratch / "attempt"])
        input_guard = OwnedInputs(workspace, settings["scope"])
        for phase, args in (("build", ["--no-run"]), ("test", [])):
            require(time.time() < deadline, "calibration capacity exhausted")
            before = time.monotonic()
            with Path(str(output) + f".{phase}.log").open("wb") as log:
                process = OwnedProcess(["cargo", "test", *args, "--verbose", "--workspace", "--locked"], cwd=workspace, env=env, log=log)
                try:
                    while process.poll() is None and time.time() < deadline:
                        time.sleep(0.2)
                    code = process.poll()
                finally:
                    process.stop(settings["shutdown_seconds"])
            require(code == 0, "calibration workspace phase failed or exceeded deadline")
            input_guard.verify()
            values[phase + "_seconds"] = time.monotonic() - before
            values[phase + "_status"] = code
        input_guard.verify()
    require(checkout_inventory(root, settings["repository"]) == (checkout, inventory), "source changed during calibration")
    values.update(scope=settings["scope"], slot=0, inventory_digest=model.digest(inventory), environment=contract_env,
                  cargo_mutants_identity=tool_identity(tool),
                  toolchain={tool: command([tool, "--version", "--verbose"], root, env) for tool in ("rustc", "cargo")},
                  test_cap_seconds=max(120, math.ceil(values["test_seconds"] * 4)),
                  checkout=checkout, run_id=settings["run_id"], measured_at=dt.datetime.now(dt.timezone.utc).isoformat())
    write_json(output, values)
    return values


def plan(root, settings, calibration, output):
    bound_setup(settings)
    require(settings["slot"] == 0, "planning must own shared slot zero")
    context, env, listing = collect_context(root, settings, calibration)
    decision = capacity(settings, calibration)
    if not decision["admit"]:
        raise CapacityFailure("fresh baseline and one full mutation cannot fit")
    manifest = model.build_manifest(listing, context)
    require(checkout_inventory(root, settings["repository"]) == (context["checkout"], context["inputs"]["input_inventory"]),
            "source changed during planning")
    require(Path(output).name == "plan.json", "plan artifact member must be plan.json")
    producer = {"repository": settings["repository"], "workflow": settings["workflow"], "workflow_sha": settings["workflow_sha"],
                "run_id": settings["run_id"], "attempt": settings["attempt"], "job_id": settings["job_id"], "slot": 0,
                "scope": settings["scope"], "checkout": context["checkout"], "input_fingerprint": manifest["input_fingerprint"],
                "campaign_id": manifest["campaign_id"]}
    write_json(output, {"version": 1, "manifest": manifest, "calibration": calibration, "capacity": decision, "producer": producer})
    print("MUTATION_PLAN " + json.dumps(dict(producer, plan_digest=artifacts.sha(Path(output).read_bytes())),
                                       sort_keys=True, separators=(",", ":")), flush=True)
    return manifest


def execute_slot(root, settings, planned, chain, output, api=None):
    bound_setup(settings)
    manifest, calibration = planned["manifest"], planned["calibration"]
    require(settings.get("fixture_stop_after_records") is None or settings["scope"] == "fixture",
            "deliberate fixture interruption is forbidden in production")
    tool = installed_tool(root, execution_environment(settings)[0])
    context, env, _ = collect_context(root, settings, calibration, tool=tool)
    require(model.digest({"schema_version": model.SCHEMA_VERSION, "inputs": context["inputs"]}) == manifest["input_fingerprint"],
            "source or execution contract changed")
    slot = settings["slot"]
    recovered = artifacts.recover(api or artifacts.GitHub(), manifest, chain, current_run_id=settings["run_id"],
                                  current_attempt=settings["attempt"])
    records = recovered["records"]
    baseline = (Path(root) / "docs/mutants-baseline.txt").read_text(encoding="utf-8").splitlines() if settings["scope"] == "production" else []
    summary = model.summarize(manifest, records, baseline, slot=slot)
    state, reason = continuation_status(summary, recovered["bundles"], slot=slot,
        max_attempts=chain["max_attempts"], attempt=settings["attempt"] - 1)
    if model.summarize(manifest, records, baseline)["failing"]:
        state, reason = "policy_failure", "timeout_or_unaccepted_survivor"
    receipt = {"repository": settings["repository"], "workflow": settings["workflow"],
               "workflow_sha": settings["workflow_sha"], "run_id": settings["run_id"], "attempt": settings["attempt"],
               "job_id": settings["job_id"], "slot": slot, "checkout": context["checkout"],
               "input_fingerprint": manifest["input_fingerprint"], "campaign_id": manifest["campaign_id"]}
    if state in {"complete", "policy_failure", "baseline_failure", "infrastructure_failure", "capacity_failure"}:
        return retain_bundle(output, manifest, receipt, {"state": state, "reason": reason}, summary=summary)
    decision = capacity(settings, calibration)
    if not decision["admit"]:
        return retain_bundle(output, manifest, receipt, {"state": "capacity_failure", "reason": "fresh_attempt_cannot_fit",
                             "capacity": decision}, summary=summary)
    ids = ordered_remaining(manifest, records, slot)
    execution_id = uuid.uuid4().hex
    provenance = {key: receipt[key] for key in ("repository", "workflow", "run_id", "attempt", "checkout", "input_fingerprint")}
    provenance.update(batch_id=model.digest(ids), execution_id=execution_id)
    receipt.update(batch_id=provenance["batch_id"], execution_id=execution_id)
    require(not Path(tempfile.gettempdir()).resolve().is_relative_to(Path(root).resolve()),
            "temporary root overlaps protected checkout")
    with tempfile.TemporaryDirectory(prefix="mutation-owned-") as scratch, selected_workspace(root, settings["scope"]) as fixture:
        scratch = Path(scratch)
        copy = scratch / "source"
        guard_owned_paths(root, [copy, scratch / "tmp", scratch / "target", scratch / "attempt"])
        command(["git", "clone", "--quiet", "--no-hardlinks", "--no-checkout", str(Path(root).resolve()), str(copy)], root)
        command(["git", "checkout", "--quiet", "--detach", context["checkout"]["commit"]], copy)
        _, copied_inventory = checkout_inventory(copy, settings["repository"])
        require(copied_inventory == context["inputs"]["input_inventory"], "isolated source copy differs")
        env = owned_environment(env, scratch)
        workspace = copy
        if settings["scope"] == "fixture":
            workspace = scratch / "fixture"
            shutil.copytree(fixture, workspace)
        guard_owned_paths(root, [workspace, scratch / "tmp", scratch / "target", scratch / "attempt"])
        input_guard = OwnedInputs(workspace, settings["scope"])
        config = scratch / "batch.toml"
        batch_config(manifest, ids, config)
        selection = artifacts.strict_json(command([arg for arg in generation_argv(settings["scope"], tool) if arg != "--no-config"]
                                                  + ["--config", str(config)], workspace, env))
        input_guard.verify()
        model.validate_selection(manifest, slot, selection, ids)
        input_guard.configure(manifest, ids)
        by_name = {item["name"]: item["id"] for item in manifest["mutations"]}
        require([by_name[item["name"]] for item in selection] == ids, "tool selection order differs from requested batch")
        # Clone, listing and setup consumed the same job window. Recheck immediately before launch.
        decision = capacity(settings, calibration)
        if not decision["admit"]:
            return retain_bundle(output, manifest, receipt, {"state": "capacity_failure", "reason": "setup_consumed_capacity",
                                 "capacity": decision}, summary=summary)
        report_parent = scratch / "attempt" / "mutants.out"
        argv = execution_argv(settings, calibration, tool, config, report_parent.parent)
        deadline = artifacts.timestamp(settings["job_started_at"]).timestamp() + 7200 - (
            settings["shutdown_seconds"] + settings["validation_seconds"] + settings["upload_seconds"])
        result = run_controller(argv, cwd=workspace, env=env, report_path=report_parent / "outcomes.json", manifest=manifest,
            slot=slot, batch_ids=ids, provenance=provenance, deadline=deadline,
            shutdown_seconds=settings["shutdown_seconds"], log_path=scratch / "process.log",
            stop_after_records=settings.get("fixture_stop_after_records"), input_guard=input_guard)
        require(checkout_inventory(root, settings["repository"]) == (context["checkout"], context["inputs"]["input_inventory"]),
                "source changed during execution")
        if result["snapshot"]:
            merged = model.merge_deltas(manifest, recovered["deltas"] + [result["snapshot"][1]],
                allowed_run_ids=set(recovered["allowed_run_ids"]), current_run_id=settings["run_id"],
                current_attempt=settings["attempt"], include_current=True)
            summary = model.summarize(manifest, merged, baseline, slot=slot)
            if summary["failing"]:
                result.update(state="policy_failure", reason="timeout_or_unaccepted_survivor")
            elif summary["complete"]:
                result.update(state="complete", reason="exact_coverage")
        bundle = retain_bundle(output, manifest, receipt, result, report_parent=report_parent, summary=summary)
        shutil.copyfile(scratch / "process.log", Path(output) / "process.log")
        if (report_parent / "outcomes.json").is_file():
            diagnostic = Path(output) / "diagnostic"
            diagnostic.mkdir()
            shutil.copyfile(report_parent / "outcomes.json", diagnostic / "post-shutdown-outcomes.json")
        return bundle


def validate_current_plan(root, planned, settings):
    context, _, _ = collect_context(root, settings, planned["calibration"])
    manifest = planned["manifest"]
    require(context["checkout"]["repository"] == manifest["context"]["checkout"]["repository"]
            and context["run"]["workflow"] == manifest["context"]["run"]["workflow"], "current campaign identity changed")
    require(model.digest({"schema_version": model.SCHEMA_VERSION, "inputs": context["inputs"]}) == manifest["input_fingerprint"],
            "current source or execution contract changed")
    return context


def aggregate(root, planned, chain, settings, output, api=None):
    manifest = planned["manifest"]
    current_context = validate_current_plan(root, planned, settings)
    entry = next((entry for entry in chain["runs"] if str(entry["run_id"]) == settings["run_id"]), None)
    require(entry is not None and all(current_context["checkout"][key] == entry[key] for key in ("commit", "tree", "ref")),
            "current checkout differs from authenticated chain entry")
    api = api or artifacts.GitHub()
    recovered = artifacts.recover(api, manifest, chain, current_run_id=settings["run_id"],
        current_attempt=settings["attempt"], include_current=True)
    baseline_bytes = Path(settings["survivor_baseline"]).read_bytes()
    require(artifacts.sha(baseline_bytes) == manifest["context"]["inputs"]["survivor_baseline_file_digest"],
            "survivor baseline changed since planning")
    baseline = baseline_bytes.decode("utf-8").splitlines() if manifest["context"]["inputs"]["computation_scope"] == "production" else []
    summary = model.summarize(manifest, recovered["records"], baseline)
    state, reason = continuation_status(summary, recovered["bundles"], max_attempts=chain["max_attempts"], attempt=settings["attempt"])
    prefix = "mutation-fixture-slot-" if manifest["context"]["inputs"]["computation_scope"] == "fixture" else "mutation-slot-"
    jobs = list(artifacts.pages(api, f"repos/{settings['repository']}/actions/runs/{settings['run_id']}/attempts/{settings['attempt']}/jobs", "jobs"))
    workers = [job for job in jobs if job["name"] in {prefix + str(slot) for slot in range(8)}]
    evidenced = {str(bundle["receipt"]["job_id"]): bundle for bundle in recovered["bundles"]
                 if bundle["receipt"]["run_id"] == settings["run_id"] and bundle["receipt"]["attempt"] == settings["attempt"]}
    if (not workers and not summary["complete"]) or any(str(job["id"]) not in evidenced for job in workers):
        state, reason = "infrastructure_failure", "missing_worker_artifact"
    elif any(job["status"] != "completed" or (job["conclusion"] != "success"
             and evidenced[str(job["id"])]["status"]["state"] == "complete") for job in workers):
        state, reason = "infrastructure_failure", "current_worker_validation_failed"
    require(validate_current_plan(root, planned, settings) == current_context, "current inputs changed during aggregation")
    recovery_report = {"allowed_run_ids": recovered["allowed_run_ids"], "deltas": recovered["deltas"],
                       "attempts": [{"receipt": bundle["receipt"], "status": bundle["status"],
                                     "delta_id": bundle["delta"]["delta_id"] if bundle["delta"] else None}
                                    for bundle in recovered["bundles"]]}
    detailed = {"state": state, "reason": reason, "summary": summary, "recovery": recovery_report,
                "current_checkout": current_context["checkout"], "original_tested_checkout": manifest["context"]["checkout"],
                "advice": "The external controller may rerun failed slots together within the recorded limits."
                if state.startswith("incomplete_") else "Stop continuation; inspect the recorded result."}
    write_json(output, detailed)
    return {"state": state, "reason": reason, **{key: len(summary[key]) for key in ("planned", "completed", "remaining", "failing")}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("calibrate", "plan", "recover-plan", "slot", "aggregate"))
    parser.add_argument("--root", default=".")
    parser.add_argument("--settings", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--calibration")
    parser.add_argument("--plan")
    parser.add_argument("--chain")
    args = parser.parse_args(argv)
    settings = read_json(args.settings)
    if Path(args.output).resolve().is_relative_to(Path(args.root).resolve()):
        print(json.dumps({"state": "infrastructure_failure", "reason": "output_must_be_outside_source_checkout"}))
        return STATES["infrastructure_failure"]
    try:
        if args.command == "calibrate":
            calibrate(args.root, settings, args.output)
            status = {"state": "complete", "reason": "calibration_complete"}
        elif args.command == "plan":
            manifest = plan(args.root, settings, read_json(args.calibration), args.output)
            status = {"state": "complete", "reason": "plan_complete", "campaign_id": manifest["campaign_id"]}
        elif args.command == "recover-plan":
            planned = artifacts.recover_plan(artifacts.GitHub(), read_json(args.chain), current_run_id=settings["run_id"],
                current_attempt=settings["attempt"],
                repository=settings["repository"], workflow=settings["workflow"], scope=settings["scope"],
                workflow_digest=artifacts.sha((Path(args.root) / settings["workflow"]).read_bytes()))
            write_json(args.output, planned)
            status = {"state": "complete", "reason": "authenticated_plan_restored", "campaign_id": planned["manifest"]["campaign_id"]}
        elif args.command == "slot":
            bundle = execute_slot(args.root, settings, read_json(args.plan), read_json(args.chain), args.output)
            status = bundle["status"]
        else:
            status = aggregate(args.root, read_json(args.plan), read_json(args.chain), settings, args.output)
    except CapacityFailure as error:
        status = {"state": "capacity_failure", "reason": str(error)}
        write_json(str(args.output) + ".failure.json", status)
    except (ValueError, KeyError, OSError, subprocess.SubprocessError, TypeError) as error:
        status = {"state": "infrastructure_failure", "reason": str(error)}
        write_json(str(args.output) + ".failure.json", status)
    public = {key: value for key, value in status.items() if key in
              {"state", "reason", "campaign_id", "planned", "completed", "remaining", "failing", "returncode"}}
    if isinstance(public.get("remaining"), list):
        public["remaining"] = len(public["remaining"])
    print(json.dumps(public, sort_keys=True))
    return STATES[status["state"]]


if __name__ == "__main__":
    sys.exit(main())
