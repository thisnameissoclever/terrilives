"""Bounded Windows inventory parity for the committed V20 native source."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tomllib

import psutil

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[3]
COMMIT = "0b886b73d8fb0492fe8e8029957e0fc1db5715a7"
SOURCE = ROOT / "source"
REPORTS = ROOT / "reports"
STOCK = Path("C:/Users/myema/.cargo/bin/cargo-mutants.exe")
CANDIDATE = ROOT.parent / "target/release/cargo-mutants.exe"
EXPECTED = {str(STOCK): "b4173bae5c104a37e72c1944b5f7ef79b6f235e09f5e6a7bcc5e6771bb75c406",
            str(CANDIDATE): "3b065b4fac0a0c98acb810883aa0c403bb9f9a7020c706715940a34ede78f7a6"}
for name in ("source", "tmp", "target", "reports"):
    path = ROOT / name
    if name != "source":
        path.mkdir(exist_ok=False)
    assert not path.is_symlink() and not path.is_junction()
paths = [ROOT / name for name in ("source", "tmp", "target", "reports")]
assert all(a != b and a not in b.parents and b not in a.parents for index, a in enumerate(paths) for b in paths[index+1:])
for key in os.environ:
    assert key not in ("RUSTFLAGS", "RUSTC", "RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER", "CARGO_ENCODED_RUSTFLAGS") and not key.startswith("CARGO_PROFILE_"), f"Unexpected compiler/profile override: {key}"
environment = dict(os.environ, CARGO_NET_OFFLINE="true", RUSTUP_TOOLCHAIN="1.94.1", CARGO_BUILD_JOBS="2",
                   CARGO_TARGET_DIR=str(ROOT / "target"), TEMP=str(ROOT / "tmp"), TMP=str(ROOT / "tmp"), TMPDIR=str(ROOT / "tmp"),
                   GIT_TERMINAL_PROMPT="0", PYTHONDONTWRITEBYTECODE="1")
for name in ("TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR", "RUST_LOG"):
    environment.pop(name, None)
limits = {"checkout_seconds": 1800, "listing_seconds": 120, "input_proof_seconds": 180,
          "overall_seconds": 2400, "max_task_rss_bytes": 4*1024**3, "min_host_free_bytes": 2*1024**3, "cargo_jobs": 2}
started = time.monotonic()
records = []
samples = []
def sha(data):
    return hashlib.sha256(data).hexdigest()
def binaries():
    found = {str(path): sha(path.read_bytes()) for path in (STOCK, CANDIDATE)}
    assert found == EXPECTED, "Pinned tool binary changed"
    return found
def save(path, value):
    path.write_text(json.dumps(value, indent=2)+"\n", encoding="utf-8")
def stop_owned(proc):
    try:
        children = psutil.Process(proc.pid).children(recursive=True)
    except psutil.NoSuchProcess:
        children = []
    for item in reversed(children):
        try:
            item.kill()
        except psutil.NoSuchProcess:
            pass
    if proc.poll() is None:
        proc.kill()
    proc.wait()
def run(label, argv, cwd, timeout):
    step_started = time.monotonic()
    record = {"label": label, "argv": list(map(str, argv)), "cwd": str(cwd), "timeout_seconds": timeout,
              "started_utc": datetime.now(timezone.utc).isoformat()}
    stdout = REPORTS / (label+".stdout")
    stderr = REPORTS / (label+".stderr")
    assert not stdout.exists() and not stderr.exists()
    with stdout.open("wb") as out, stderr.open("wb") as err:
        proc = subprocess.Popen(list(map(str, argv)), cwd=cwd, env=environment, stdout=out, stderr=err,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        record["pid"] = proc.pid
        last_sample = -20
        while proc.poll() is None:
            elapsed = time.monotonic()-step_started
            free = psutil.virtual_memory().available
            try:
                family = [psutil.Process(proc.pid), *psutil.Process(proc.pid).children(recursive=True)]
                rss = sum(p.memory_info().rss for p in family if p.is_running()) + psutil.Process().memory_info().rss
            except psutil.NoSuchProcess:
                rss = psutil.Process().memory_info().rss
            violation = elapsed > timeout or time.monotonic()-started > limits["overall_seconds"] or rss > limits["max_task_rss_bytes"] or free < limits["min_host_free_bytes"]
            if elapsed-last_sample >= 15:
                samples.append({"label": label, "elapsed_seconds": round(elapsed,3), "task_rss_bytes": rss, "host_available_bytes": free})
                save(REPORTS / "capacity.json", samples)
                last_sample = elapsed
            if violation:
                stop_owned(proc)
                record["limit_failure"] = {"elapsed_seconds": elapsed, "task_rss_bytes": rss, "host_available_bytes": free}
                break
            time.sleep(1)
        record.update(exit_code=proc.wait(), wall_seconds=round(time.monotonic()-step_started,6),
                      finished_utc=datetime.now(timezone.utc).isoformat())
    record.update(stdout_sha256=sha(stdout.read_bytes()), stderr_sha256=sha(stderr.read_bytes()))
    records.append(record)
    save(REPORTS / "commands.json", records)
    print(f"{label}: exit {record['exit_code']}, {record['wall_seconds']} seconds", flush=True)
    assert record["exit_code"] == 0 and "limit_failure" not in record, f"Command failed: {label}; see retained logs"
    return stdout.read_bytes()

try:
    before = binaries()
    run("clone", ["git", "clone", "--shared", "--no-checkout", REPOSITORY, SOURCE], ROOT, 120)
    run("checkout-config", ["git", "config", "core.autocrlf", "false"], SOURCE, 30)
    run("checkout", ["git", "checkout", "--detach", COMMIT], SOURCE, limits["checkout_seconds"])
    pin = tomllib.loads((SOURCE / "rust-toolchain.toml").read_text())["toolchain"]
    assert pin["channel"] == "1.94.1", "Committed toolchain does not match required 1.94.1"
    context = {"cargo": run("cargo-version", ["cargo", "-V"], SOURCE, 30).decode().strip(),
               "rustc": run("rustc-version", ["rustc", "-Vv"], SOURCE, 30).decode().strip(),
               "committed_toolchain": pin, "toolchain_sha256": sha((SOURCE / "rust-toolchain.toml").read_bytes()),
               "metadata_context": {key: environment[key] for key in ("RUSTUP_TOOLCHAIN", "CARGO_BUILD_JOBS", "CARGO_TARGET_DIR", "CARGO_NET_OFFLINE")}}
    assert context["cargo"].startswith("cargo 1.94.1 ") and context["rustc"].startswith("rustc 1.94.1 ")
    save(REPORTS / "toolchain.json", context)
    def proof(label):
        run(label, [sys.executable, ROOT / "input-proof.py", label], ROOT, limits["input_proof_seconds"])
    base = ["mutants", "--dir", SOURCE, "--list", "--json", "--no-config", "--package", "terri-core",
            "--package", "terri-sim", "--package", "terri-data", "--package", "terri-wasm"]
    proof("before-stock")
    stock_raw = run("stock-inventory", [STOCK, *base], ROOT, limits["listing_seconds"])
    proof("after-stock")
    proof("before-candidate")
    candidate_raw = run("candidate-inventory", [CANDIDATE, *base], ROOT, limits["listing_seconds"])
    proof("after-candidate")
    stock, candidate = json.loads(stock_raw), json.loads(candidate_raw)
    def identities(entries):
        return [json.dumps([entry[key] for key in ("package", "file", "span", "genre", "replacement")], sort_keys=True) for entry in entries]
    names = [[entry["name"] for entry in entries] for entries in (stock, candidate)]
    ids = [identities(entries) for entries in (stock, candidate)]
    comparison = {"boundary": "Committed V20 native source; not final workflow input fingerprint", "commit": COMMIT,
                  "stock_count": len(stock), "candidate_count": len(candidate), "raw_bytes_identical": stock_raw == candidate_raw,
                  "complete_ordered_entries_equal": stock == candidate, "ordered_names_equal": names[0] == names[1],
                  "identity_sets_equal": set(ids[0]) == set(ids[1]), "duplicate_names": [len(a)-len(set(a)) for a in names],
                  "duplicate_composite_identities": [len(a)-len(set(a)) for a in ids],
                  "stock_sha256": sha(stock_raw), "candidate_sha256": sha(candidate_raw),
                  "package_counts": dict(Counter(entry["package"] for entry in stock)), "all_fields_compared": sorted(stock[0])}
    save(REPORTS / "comparison.json", comparison)
    assert comparison["raw_bytes_identical"] and comparison["complete_ordered_entries_equal"]
    assert comparison["ordered_names_equal"] and comparison["identity_sets_equal"]
    assert comparison["duplicate_names"] == [0,0] and comparison["duplicate_composite_identities"] == [0,0]
    after = binaries()
    snapshots = [json.loads((REPORTS / ("freeze-"+label+".json")).read_text()) for label in ("before-stock", "after-stock", "before-candidate", "after-candidate")]
    assert all(item == snapshots[0] for item in snapshots)
    assert not list((ROOT / "target").rglob("*.rlib")) and not list((ROOT / "target").rglob("*.rmeta")), "Unexpected compilation artifact"
    save(REPORTS / "provenance.json", {"qualification_passed": True, "completed_utc": datetime.now(timezone.utc).isoformat(),
         "boundary": comparison["boundary"], "final_workflow_input_fingerprint": False, "linux_final_source_enumeration_required": True,
         "binary_hashes_before": before, "binary_hashes_after": after, "binaries_unchanged": before == after,
         "limits": limits, "wall_seconds": round(time.monotonic()-started,3), "toolchain": context,
         "input_commit": snapshots[0]["commit"], "input_tree": snapshots[0]["tree"], "input_sha256": snapshots[0]["input_sha256"],
         "input_count": snapshots[0]["input_count"], "generation_actual_file_count": snapshots[0]["generation_actual_file_count"],
         "snapshots_identical": True, "comparison": comparison, "no_tool_rebuild_or_selector_fixture_rerun": True,
         "only_mutants_listing": True, "no_compilation_artifacts_in_owned_target": True,
         "checker_sha256": {name: sha((ROOT / name).read_bytes()) for name in ("qualify.py", "input-proof.py", "receipt_compare.py")}})
    print(json.dumps(comparison), flush=True)
except BaseException as error:
    save(REPORTS / "failure.json", {"error": repr(error), "utc": datetime.now(timezone.utc).isoformat(), "commands_completed": len(records)})
    print(f"FAIL: {error}", flush=True)
    raise
