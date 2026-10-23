"""List both tools against the same frozen source and retain exact commands."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parent
source = root / "game-source"
stock = Path("C:/Users/myema/.cargo/bin/cargo-mutants.exe")
candidate = root / "target/release/cargo-mutants.exe"
assert hashlib.sha256(stock.read_bytes()).hexdigest() == "b4173bae5c104a37e72c1944b5f7ef79b6f235e09f5e6a7bcc5e6771bb75c406"
assert hashlib.sha256(candidate.read_bytes()).hexdigest() == json.loads((root / "build-receipt.json").read_text())["candidate_sha256"]
env = dict(os.environ, CARGO_NET_OFFLINE="true", RUSTUP_TOOLCHAIN="1.94.1", CARGO_BUILD_JOBS="2",
           CARGO_TARGET_DIR=str(root / "metadata-target"), TEMP=str(root / "tmp"), TMP=str(root / "tmp"), TMPDIR=str(root / "tmp"))
for key in ("TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR", "RUST_LOG"):
    env.pop(key, None)
base = ["mutants", "--dir", str(source), "--list", "--json", "--no-config",
        "--package", "terri-core", "--package", "terri-sim", "--package", "terri-data", "--package", "terri-wasm"]
commands = []
resume = sys.argv[1:] == ["--resume-after-stock"]
assert not sys.argv[1:] or resume
command_file = root / ("paired-invocations-continuation.json" if resume else "paired-invocations.json")
assert not command_file.exists()
def proof(label):
    subprocess.run([sys.executable, str(root / "freeze-proof.py"), label], check=True, env=env)
def invoke(label, executable, extra=()):
    folder = root / "results" / label
    folder.mkdir(parents=True, exist_ok=False)
    argv = [str(executable), *base, *extra]
    started = time.monotonic()
    started_utc = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(argv, cwd=root, env=env, capture_output=True, timeout=120)
    (folder / "project-full-unfiltered.stdout.json").write_bytes(result.stdout)
    (folder / "stderr.log").write_bytes(result.stderr)
    commands.append({"started_utc": started_utc, "finished_utc": datetime.now(timezone.utc).isoformat(), "argv": argv, "cwd": str(root),
                     "timeout_seconds": 120, "exit_code": result.returncode, "wall_seconds": round(time.monotonic()-started,6),
                     "stdout_sha256": hashlib.sha256(result.stdout).hexdigest()})
    command_file.write_text(json.dumps(commands, indent=2)+"\n")
    assert result.returncode == 0
    return json.loads(result.stdout)
if resume:
    assert json.loads((root / "freeze-before-stock.json").read_text()) == json.loads((root / "freeze-after-stock.json").read_text())
    stock_entries = json.loads((root / "results/stock_current/project-full-unfiltered.stdout.json").read_bytes())
    proof("before-candidate")
else:
    proof("before-stock")
    stock_entries = invoke("stock_current", stock)
    proof("after-stock")
candidate_entries = invoke("candidate_current", candidate)
proof("after-candidate")
subprocess.run([sys.executable, str(root / "compare.py")], check=True, env=env)
targets = [entry["name"] for entry in stock_entries if entry["genre"] == "FnValue"][:2]
targets += [entry["name"] for entry in stock_entries if entry["genre"] == "BinaryOperator"][:1]
assert len(targets) == 3
def escape(value):
    return "".join("\\"+char if char in r"\.^$|?*+()[]{}" else char for char in value)
pattern = "^(?:" + "|".join(map(escape, targets)) + ")$"
stock_selected = invoke("stock_three", stock, ["--re", pattern])
proof("after-stock-three")
candidate_selected = invoke("candidate_three", candidate, ["--re", pattern])
proof("after-candidate-three")
selected = {"requested_names": targets, "stock_selected": [entry["name"] for entry in stock_selected],
            "candidate_selected": [entry["name"] for entry in candidate_selected]}
(root / "full-scope-three-selection.json").write_text(json.dumps(selected, indent=2)+"\n")
assert set(selected["candidate_selected"]) == set(targets) and len(candidate_selected) == 3
assert len(stock_selected) > 3
assert hashlib.sha256(stock.read_bytes()).hexdigest() == "b4173bae5c104a37e72c1944b5f7ef79b6f235e09f5e6a7bcc5e6771bb75c406"
print(json.dumps({"stock_selected": len(stock_selected), "candidate_selected": len(candidate_selected), "global_stock_unchanged": True}))
