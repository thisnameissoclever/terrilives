"""Compare full ordered entries and identities from paired fresh inventories."""
from collections import Counter
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
stock_raw = (root / "results/stock_current/project-full-unfiltered.stdout.json").read_bytes()
candidate_raw = (root / "results/candidate_current/project-full-unfiltered.stdout.json").read_bytes()
stock, candidate = json.loads(stock_raw), json.loads(candidate_raw)
def identity(entry):
    return json.dumps([entry[key] for key in ("package", "file", "span", "genre", "replacement")], sort_keys=True)
names = [[entry["name"] for entry in entries] for entries in (stock, candidate)]
identities = [[identity(entry) for entry in entries] for entries in (stock, candidate)]
receipt = {"stock_count": len(stock), "candidate_count": len(candidate),
           "raw_bytes_identical": stock_raw == candidate_raw,
           "complete_ordered_entries_equal": stock == candidate,
           "ordered_names_equal": names[0] == names[1], "identity_sets_equal": set(identities[0]) == set(identities[1]),
           "duplicate_names": [len(values)-len(set(values)) for values in names],
           "duplicate_composite_identities": [len(values)-len(set(values)) for values in identities],
           "stock_sha256": hashlib.sha256(stock_raw).hexdigest(), "candidate_sha256": hashlib.sha256(candidate_raw).hexdigest(),
           "package_counts": dict(Counter(entry["package"] for entry in stock)),
           "all_fields_compared": sorted(stock[0])}
(root / "inventory-comparison.json").write_text(json.dumps(receipt, indent=2)+"\n")
assert receipt["raw_bytes_identical"] and receipt["complete_ordered_entries_equal"]
assert receipt["ordered_names_equal"] and receipt["identity_sets_equal"]
assert receipt["duplicate_names"] == [0, 0] and receipt["duplicate_composite_identities"] == [0, 0]
stock_cases = json.loads((root / "results/stock_fixture/qualification.json").read_text())
candidate_cases = json.loads((root / "results/candidate_fixture/qualification.json").read_text())
assert stock_cases["specification_failed"] == 14 and stock_cases["specification_passed"] == 8
assert candidate_cases["specification_failed"] == 0 and candidate_cases["specification_passed"] == 22
print(json.dumps(receipt, indent=2))
