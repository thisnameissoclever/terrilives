from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[3]
source = root / "crates/terri-sim/src/rooms/matching.rs"
original = source.read_bytes()
text = original.decode("utf-8")
evidence = Path(__file__).parent / "task-2-mutation-evidence"
evidence.mkdir(exist_ok=True)
mutations = [
    ("shared-count-reversed", "b.shared_tiles.cmp(&a.shared_tiles)", "a.shared_tiles.cmp(&b.shared_tiles)"),
    ("retained-fraction-reversed", "(u64::from(b.shared_tiles) * u64::from(a.old_tiles))\n                .cmp(&(u64::from(a.shared_tiles) * u64::from(b.old_tiles)))", "(u64::from(a.shared_tiles) * u64::from(b.old_tiles))\n                .cmp(&(u64::from(b.shared_tiles) * u64::from(a.old_tiles)))"),
    ("old-id-order-reversed", "a.old_id.cmp(&b.old_id)", "b.old_id.cmp(&a.old_id)"),
    ("anchor-column-before-row", "    (y, x)", "    (x, y)"),
    ("west-translation-lost", "+ i64::from(translation.0)", "+ 0"),
    ("duplicate-inheritance-allowed", "|| !used.insert(id)", "|| false"),
]
results = []
try:
    for name, old, new in mutations:
        # Check the actual platform line endings before changing source bytes.
        if "\r\n" in text:
            old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
        assert text.count(old) == 1, (name, text.count(old))
        mutated = text.replace(old, new).encode("utf-8")
        assert mutated != original
        source.write_bytes(mutated)
        process = subprocess.run(["cargo", "test", "-p", "terri-sim", "rooms::identity_tests"], cwd=root, capture_output=True, text=True)
        output = process.stdout + process.stderr
        (evidence / f"{name}.log").write_text(output, encoding="utf-8")
        killed = process.returncode != 0 and "test result: FAILED" in output and "error[E" not in output
        results.append({"name": name, "exit": process.returncode, "killed": killed, "mutated_sha256": hashlib.sha256(mutated).hexdigest()})
        source.write_bytes(original)
        print(json.dumps(results[-1]), flush=True)
        if not killed:
            raise RuntimeError(f"mutation did not produce an assertion failure: {name}")
finally:
    source.write_bytes(original)
    (evidence / "summary.json").write_text(json.dumps({"original_sha256": hashlib.sha256(original).hexdigest(), "restored_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "results": results}, indent=2), encoding="utf-8")
