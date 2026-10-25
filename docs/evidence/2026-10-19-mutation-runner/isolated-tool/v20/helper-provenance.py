"""Record the reviewed helper reuse and bounded V20 adaptations."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
assert (root / "receipt_compare.py").read_bytes() == (root.parent / "receipt_compare.py").read_bytes()
data = {"canonical_receipt_comparison_identical_to_reviewed_helper": True,
        "canonical_helper_sha256": digest(root / "receipt_compare.py"),
        "reviewed_guard_source_sha256": digest(root.parent / "freeze-proof.py"),
        "adapted_input_proof_sha256": digest(root / "input-proof.py"),
        "preparation_script_sha256": digest(root / "prepare-helpers.py"),
        "report_generator_sha256": digest(root / "write-report.py"),
        "adaptations": ["V20 exact commit and separate source directory", "Proof reports under new reports directory",
                        "Reject links at clone root and along explicit fixture ancestors"],
        "scope": "All conservative roots and explicit files from the reviewed helper retained",
        "preparation_note": "An initial shell helper-copy command failed to parse; the saved preparation script succeeded before any proof or listing."}
out = root / "reports/helper-provenance.json"
assert not out.exists()
out.write_text(json.dumps(data, indent=2)+"\n")
print(json.dumps({"reviewed_canonical_helper_reused": True, "output": str(out)}))
