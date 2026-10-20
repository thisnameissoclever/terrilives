"""Prove normalization accepts equivalent containers and rejects real drift."""
import copy
import json
from pathlib import Path
from receipt_compare import assert_receipts_equal

root = Path(__file__).resolve().parent
baseline = json.loads((root / "freeze-before-stock.json").read_text())
results = []
equivalent = copy.deepcopy(baseline)
equivalent["inputs"]["roots"] = tuple(equivalent["inputs"]["roots"])
equivalent["inputs"]["explicit_files_including_absent"] = tuple(equivalent["inputs"]["explicit_files_including_absent"])
assert_receipts_equal(equivalent, baseline)
results.append({"case": "tuple_json_array_equivalence", "pass": True})
for case, change in (("changed_scoped_blob", "blob"), ("changed_generation_byte_hash", "generation_hash")):
    changed = copy.deepcopy(equivalent)
    if change == "blob":
        row = changed["inputs"]["entries"][0]
        row["git_blob"] = "0" * 40
    else:
        key = next(iter(changed["generation_actual_sha256"]))
        changed["generation_actual_sha256"][key] = "0" * 64
    try:
        assert_receipts_equal(changed, baseline)
    except AssertionError:
        results.append({"case": case, "pass": True, "rejected": True})
    else:
        raise AssertionError(f"Normalization hid drift: {case}")
out = root / "checker-control-results.json"
assert not out.exists()
out.write_text(json.dumps(results, indent=2)+"\n")
print(json.dumps(results))
