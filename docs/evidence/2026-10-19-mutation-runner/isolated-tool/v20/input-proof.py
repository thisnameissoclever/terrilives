"""Bind paired list-only qualifications to identical clean game inputs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from receipt_compare import assert_receipts_equal

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source"
ROOTS = ("crates/", "content/", "assets/", "web/", "scripts/", "tools/", ".github/", ".cargo/")
FILES = ("Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "rust-toolchain", ".gitignore", ".gitattributes", "docs/mutants-baseline.txt", "docs/evidence/2026-10-17-room-identities/published-v15-producer/published-v15-golden-public-100.sav")
def git(*args):
    return subprocess.check_output(["git", "-C", str(SOURCE), *args])
def digest(data):
    return hashlib.sha256(data).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument("label")
args = parser.parse_args()
assert args.label in ("before-stock", "after-stock", "before-candidate", "after-candidate", "after-stock-three", "after-candidate-three")
assert not git("status", "--porcelain", "--untracked-files=normal").strip()
assert not any(line[:1].islower() or line.startswith("S ") for line in git("ls-files", "-v").decode().splitlines())
extras = git("ls-files", "--others", "--ignored", "--exclude-standard").decode().splitlines()
assert not any(path in FILES or path.startswith(ROOTS) for path in extras)
assert git("rev-parse", "HEAD").decode().strip() == "0b886b73d8fb0492fe8e8029957e0fc1db5715a7"
assert not SOURCE.is_symlink() and not SOURCE.is_junction()
pending = []
for directory in ROOTS:
    base = SOURCE / directory
    if base.exists():
        assert not base.is_symlink() and not base.is_junction()
        pending.append(base)
while pending:
    with os.scandir(pending.pop()) as entries:
        for entry in entries:
            assert not entry.is_symlink() and not entry.is_junction()
            if entry.is_dir(follow_symlinks=False):
                pending.append(entry.path)
for name in FILES:
    path = SOURCE / name
    if path.exists():
        for ancestor in (path, *path.parents):
            if ancestor == SOURCE:
                break
            assert not ancestor.is_symlink() and not ancestor.is_junction()
rows = []
generation_bytes = {}
for record in git("ls-files", "--stage", "-z").split(b"\0"):
    if not record:
        continue
    metadata, raw_path = record.split(b"\t", 1)
    path = raw_path.decode()
    if path in FILES or path.startswith(ROOTS):
        mode, blob, stage = metadata.decode().split()
        assert stage == "0" and mode in ("100644", "100755")
        disk = SOURCE / path
        rows.append({"path": path, "mode": mode, "git_blob": blob})
        if len(rows) % 2000 == 0:
            print(f"{args.label}: {len(rows)} conservative input paths inspected", flush=True)
        if (path.startswith("crates/") and (path.endswith(".rs") or disk.name in ("Cargo.toml", "Cargo.lock"))) or path in ("Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "rust-toolchain", ".gitignore", ".gitattributes") or path.startswith(".cargo/"):
            generation_bytes[path] = digest(disk.read_bytes())
rows.sort(key=lambda row: row["path"])
inputs = {"representation": "clean-git-blob-sha1", "roots": ROOTS, "explicit_files_including_absent": FILES, "entries": rows}
canonical = json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()
receipt = {"commit": git("rev-parse", "HEAD").decode().strip(), "tree": git("rev-parse", "HEAD^{tree}").decode().strip(),
           "clean": True, "input_sha256": digest(canonical), "input_count": len(rows), "inputs": inputs,
           "no_hidden_index_bits": True, "no_untracked_or_ignored_scoped_inputs": True,
           "generation_actual_sha256": generation_bytes, "generation_actual_file_count": len(generation_bytes),
           "game_lock_sha256": digest((SOURCE / "Cargo.lock").read_bytes()),
           "fixture_environment_unset": {key: key not in os.environ for key in ("TERRI_WRITE_RUNTIME_FIXTURE", "TERRI_PROVE_RUNTIME_FIXTURE", "TERRI_BROWSER_FIXTURE_DIR")}}
out = ROOT / "reports" / ("freeze-" + args.label + ".json")
assert not out.exists()
out.write_text(json.dumps(receipt, indent=2)+"\n")
print(json.dumps({key: value for key, value in receipt.items() if key not in ("inputs", "generation_actual_sha256")}))
if args.label != "before-stock":
    assert_receipts_equal(receipt, json.loads((ROOT / "reports" / "freeze-before-stock.json").read_text()))
