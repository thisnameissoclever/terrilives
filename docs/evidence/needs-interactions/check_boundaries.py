"""Check authored validation and the current meal frame, with exact restoration."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
cases = [
    ("need-tuning-boundary", "crates/terri-data/src/compile.rs",
     r"if !tuning.need_interactions.valid\(tuning.mood_low_need_level\)", "if false",
     "terri-data", "need_and_seat_rules_are_validated"),
    ("seat-number-boundary", "crates/terri-data/src/compile.rs",
     r'check_number\(\s*object.seat_comfort_per_tick,\s*&format!\("seat Comfort on \{\}", object.id\),\s*\)\?;',
     "", "terri-data", "need_and_seat_rules_are_validated"),
    ("meal-frame", "crates/terri-sim/src/social_company.rs",
     r"\n    refresh\(world\);", "\n", "terri-sim", "meal_social_requires_liked"),
]
originals = {}
for name, filename, pattern, replacement, package, test in cases:
    path = root / filename
    originals[path] = path.read_bytes()
    assert len(re.findall(pattern, originals[path].decode())) == 1, name
records = []
try:
    for name, filename, pattern, replacement, package, test in cases:
        path = root / filename
        before = originals[path]
        command = ["cargo", "test", "-p", package, "--lib", "-j", "1", test, "--", "--nocapture", "--test-threads=1"]
        started = time.monotonic()
        baseline = subprocess.run(command, cwd=root, capture_output=True)
        elapsed = time.monotonic() - started
        baseline_output = (baseline.stdout + baseline.stderr).decode(errors="replace")
        (out / f"baseline-{name}.txt").write_text(baseline_output, encoding="utf-8")
        assert baseline.returncode == 0 and "1 passed" in baseline_output, name
        timeout = max(120, math.ceil(4 * elapsed))
        path.write_bytes(re.sub(pattern, replacement, before.decode()).encode())
        try:
            run = subprocess.run(command, cwd=root, capture_output=True, timeout=timeout)
            output = (run.stdout + run.stderr).decode(errors="replace")
            (out / f"mutation-{name}.txt").write_text(output, encoding="utf-8")
            detected = run.returncode != 0 and "test result: FAILED" in output and "could not compile" not in output
        finally:
            path.write_bytes(before)
            assert path.read_bytes() == before
        records.append(dict(name=name, command=command, exit_code=run.returncode, detected=detected,
                            source_sha256=hashlib.sha256(before).hexdigest(),
                            baseline_seconds=elapsed, timeout_seconds=timeout,
                            restored_byte_identical=True))
        (out / "boundary-mutations.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
        print(f"{name}: detected={detected}, restored=True", flush=True)
        assert detected, name
finally:
    for path, before in originals.items():
        path.write_bytes(before)
        assert path.read_bytes() == before
