"""Build the approved isolated tool with pinned inputs and bounded resources."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def git(*args):
    return subprocess.check_output(["git", "-C", str(SOURCE), *args]).decode().strip()
assert git("rev-parse", "HEAD") == "8ab1dc786a1f61a4e370416cc6c68b81a704e917"
assert digest(ROOT.parent / "cargo-mutants-27.1.0-struct-filter.patch") == "6693b7a61b4c7cb398e199c4e33675f9267bc50559790e069341be377f32ba6f"
assert digest(SOURCE / "src/visit.rs") == "15c1d1606b518f1fbb5ea0e08b76cd88a36cf93dccf69161b468ef34ae657b3d"
assert (SOURCE / "src/visit.rs").read_bytes() == (ROOT.parent / "cargo-mutants-27.1.0-visit-candidate.rs").read_bytes()
assert git("diff", "--name-only") == "src/visit.rs"
lock_before = digest(SOURCE / "Cargo.lock")
assert lock_before == "0d2699c31955d28f429731eda2972dc4faced07747320b074bc774c3334f75c0"
for name in ("target", "logs", "tmp"):
    (ROOT / name).mkdir(exist_ok=True)
env = dict(os.environ)
env.update(CARGO_TARGET_DIR=str(ROOT / "target"), CARGO_BUILD_JOBS="2", RUSTUP_TOOLCHAIN="1.94.1",
           TEMP=str(ROOT / "tmp"), TMP=str(ROOT / "tmp"), TMPDIR=str(ROOT / "tmp"))
for name in ("TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR", "RUST_LOG"):
    env.pop(name, None)
argv = ["rustup", "run", "1.94.1", "cargo", "build", "--locked", "--release", "--bin", "cargo-mutants", "--jobs", "2"]
receipt = {"started_utc": datetime.now(timezone.utc).isoformat(), "argv": argv, "cwd": str(SOURCE),
           "source_commit": git("rev-parse", "HEAD"), "source_tree": git("rev-parse", "HEAD^{tree}"),
           "patch_sha256": digest(ROOT.parent / "cargo-mutants-27.1.0-struct-filter.patch"),
           "visit_sha256": digest(SOURCE / "src/visit.rs"), "lock_sha256_before": lock_before,
           "cargo_version": subprocess.check_output(["rustup", "run", "1.94.1", "cargo", "-V"]).decode().strip(),
           "rustc_version": subprocess.check_output(["rustup", "run", "1.94.1", "rustc", "-Vv"]).decode(),
           "limits": {"cargo_jobs": 2, "wall_seconds": 1800}, "capacity_samples": [],
           "task_owned_paths": {name: str(ROOT / name) for name in ("target", "logs", "tmp")}}
started = time.monotonic()
with (ROOT / "logs/build.log").open("wb") as log:
    proc = subprocess.Popen(argv, cwd=SOURCE, env=env, stdout=log, stderr=subprocess.STDOUT)
    receipt["pid"] = proc.pid
    while proc.poll() is None:
        memory = subprocess.check_output(["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize | ConvertTo-Json -Compress"]).decode()
        receipt["capacity_samples"].append({"elapsed_seconds": round(time.monotonic()-started, 3), **json.loads(memory)})
        (ROOT / "build-receipt.json").write_text(json.dumps(receipt, indent=2)+"\n")
        if time.monotonic()-started > 1800:
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], check=True)
            receipt["time_limit_reached"] = True
            break
        time.sleep(10)
    receipt["exit_code"] = proc.wait()
receipt.update(finished_utc=datetime.now(timezone.utc).isoformat(), wall_seconds=round(time.monotonic()-started,3),
               lock_sha256_after=digest(SOURCE / "Cargo.lock"), locked_lockfile_unchanged=lock_before == digest(SOURCE / "Cargo.lock"),
               changed_files=git("diff", "--name-only").splitlines())
candidate = ROOT / "target/release/cargo-mutants.exe"
if receipt["exit_code"] == 0:
    receipt.update(candidate=str(candidate), candidate_sha256=digest(candidate),
                   candidate_version=subprocess.check_output([str(candidate), "mutants", "--version"]).decode().strip())
(ROOT / "build-receipt.json").write_text(json.dumps(receipt, indent=2)+"\n")
print(json.dumps(receipt, indent=2))
raise SystemExit(receipt["exit_code"])
