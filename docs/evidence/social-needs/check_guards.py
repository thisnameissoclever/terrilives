"""Delete Social mechanisms individually and verify their causal assertions."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import argparse
import math

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--baseline-seconds", type=float, required=True,
                    help="Elapsed seconds of the current host's unmutated workspace test command")
args = parser.parse_args()
if args.baseline_seconds <= 0:
    parser.error("Measure a positive unmutated baseline before checking guards")
timeout = max(120, math.ceil(4 * args.baseline_seconds))

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
cases = [
    ("affinity", "social_company.rs", r"\s*&& feelings\.feeling\(other\.id\) > 0\.", "", "shared_media_refill_is_directional"),
    ("same-device", "social_company.rs", r"\s*&& other\.station == station", "", "shared_media_refill_is_directional"),
    ("capacity", "beds.rs", r"\s*&& occupants\.len\(\) < interaction\.slots as usize", "", "standing_shared_media_saves"),
    ("standing-endpoint", "media.rs", r"\s*\|\| claims\s*\.iter\(\)\s*\.any\(\|d\| d\.person != person\.index_u32\(\) && d\.endpoint == tile\)", "", "standing_shared_media_saves"),
    ("terminal-social", "systems/chain.rs", r"if \*delta > 0\. && \*need_index as usize == NeedId::Social\.index\(\)", "if false", "completing_a_meal_pays_only"),
    ("negative-cost", "systems/interact.rs", r"if \*delta > 0\.\s*&& \*need_index", "if *need_index", "social_costs_still_apply"),
    ("friendship-horizon", "social_company.rs", r"let horizon = \(building \+ 1\.\) \* duration as f32;", "let horizon = building * duration as f32;", "friendship_utility_counts"),
    ("restored-profiles", "lib.rs", r"relationship_dynamics::refresh_profiles,", "", "friendship_selection_rebuilds_profiles"),
    ("real-food", "social_company.rs", r"if world\s*\.get::<terri_core::Carrying>\(person\)\s*\.is_none_or\(\|held\| held\.0 != food\)", "if false", "meal_social_requires_liked"),
    ("effective-privacy-benefits", "social_company.rs", r"delta <= 0\. \|\| need as usize != NeedId::Social\.index\(\) \|\| social_available", "true", "social_privacy_substitution_requires"),
    ("effective-media-waiting", "waiting.rs", r"advertised_needs\(object, &effective\)", "advertised_needs(object, advertisements)", "waiting_for_media_without_liked"),
    ("effective-chain-waiting", "systems/chain.rs", r"crate::waiting::effective_needs\(\s*station,\s*&chain\.advertises,\s*false,?\s*\)", "crate::waiting::advertised_needs(station, &chain.advertises)", "a_booked_station_is_waited_for"),
    ("recipe-address", "compatibility.rs", r"\.nth\(interaction as usize - definition\.interactions\.len\(\)\)", ".nth(interaction as usize)", "offered_recipe_dispositions"),
]
originals = {}
for _, filename, pattern, _, _ in cases:
    path = root / "crates/terri-sim/src" / filename
    originals[path] = path.read_bytes()
    if len(re.findall(pattern, originals[path].decode())) != 1:
        raise RuntimeError(f"Mutation anchor must match once: {filename}: {pattern}")

records = []
try:
    for name, filename, pattern, replacement, test in cases:
        path = root / "crates/terri-sim/src" / filename
        before = originals[path]
        changed = re.sub(pattern, replacement, before.decode()).encode()
        if changed == before:
            raise RuntimeError(f"Mutation did not change bytes: {name}")
        path.write_bytes(changed)
        try:
            command = ["cargo", "test", "--workspace", "--lib", test, "--", "--nocapture"]
            try:
                run = subprocess.run(command, cwd=root, capture_output=True, timeout=timeout)
            except subprocess.TimeoutExpired as error:
                partial = (error.stdout or b"") + (error.stderr or b"")
                (out / f"mutation-{name}-timeout.txt").write_bytes(partial)
                raise RuntimeError(f"Guard {name} timed out after {timeout}s; inspect preserved build output") from error
            output = (run.stdout + run.stderr).decode(errors="replace")
            (out / f"mutation-{name}.txt").write_text(output, encoding="utf-8")
            detected = run.returncode != 0 and "test result: FAILED" in output and "could not compile" not in output
            record = dict(name=name, command=command, exit_code=run.returncode, detected=detected,
                          source_sha256=hashlib.sha256(before).hexdigest(),
                          baseline_seconds=args.baseline_seconds, timeout_seconds=timeout)
        finally:
            path.write_bytes(before)
            if path.read_bytes() != before:
                raise RuntimeError(f"Source restoration failed: {name}")
        record["restored_byte_identical"] = True
        records.append(record)
        (out / "mutations.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
        print(f"{name}: detected={detected}, exit={run.returncode}, restored=True", flush=True)
        if not detected:
            raise RuntimeError(f"Guard mutation survived: {name}")
finally:
    for path, original in originals.items():
        path.write_bytes(original)
        assert path.read_bytes() == original
