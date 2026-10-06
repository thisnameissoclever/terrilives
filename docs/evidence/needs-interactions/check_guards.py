"""Verify contextual need rules through causal deletions and exact restoration."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time

root = Path(__file__).resolve().parents[3]
out = Path(__file__).resolve().parent
sim = root / "crates/terri-sim/src"
cases = [
    ("washing-ceiling", "need_interactions.rs", r"if delta > 0\.\s*&& need as usize == NeedId::Hygiene.index\(\)\s*&& act.activity == Some\(terri_data::CompiledActivity::WashingHands\)", "if false", "washing_hands_stops"),
    ("washing-above-ceiling", "need_interactions.rs", r"\.max\(0\.\)", "", "washing_hands_stops"),
    ("washing-score-ceiling", "systems/action.rs", r"let delta = crate::need_interactions::cap_delta\(\s*content.0,\s*advert,\s*&needs,\s*\*need_index,\s*delta,\s*\);", "", "autonomous_washing_scores"),
    ("food-travel", "need_interactions.rs", r"if world.get::<Path>\(person\).is_some\(\)\s*\|\|", "if", "standing_food_cost_requires"),
    ("real-food", "need_interactions.rs", r"\s*&& world\s*\.get::<Carrying>\(person\)\s*\.is_some_and\(\|held\| held.0 == food\)", "", "standing_food_cost_requires"),
    ("food-gathering", "need_interactions.rs", r"crate::domestic::gathering\(d, \*id, &chain.id, state.step\)", "false", "standing_food_cost_requires"),
    ("consumption-clock", "need_interactions.rs", r"\|w\| w.remaining_ticks > 0", "|_w| true", "standing_food_cost_requires"),
    ("seat-travel", "need_interactions.rs", r"\s*&& crate::media::projection\(world, person\).is_some\(\)", "", "needs_correction_media_gains"),
    ("actual-seat-rate", "need_interactions.rs", r"\.map_or\(0\., \|o\| \{\s*world\s*\.resource::<Content>\(\)\s*\.0\s*\.object\(o.0\)\s*\.seat_comfort_rate\(\)\s*\}\)", ".map_or(0., |_o| 37. / 62.)", "secondary_seats_supply"),
    ("contextual-payment", "lib.rs", r"need_interactions::tick,", "", "needs_correction"),
    ("shared-liking", "social_company.rs", r"<= self.radius\s*&& feelings.feeling\(other.id\) > 0\.", "<= self.radius", "shared_social_requires_actual"),
    ("shared-object", "social_company.rs", r"\s*&& other.station != station", "", "shared_social_obeys"),
    ("shared-group", "social_company.rs", r"\s*&& matches!\(&other.activity, Activity::Shared\(theirs\) if theirs == group\)", "", "differing_or_failed"),
    ("shared-room", "social_company.rs", r"\s*&& rooms.at\(\(\s*other.position.x.round\(\) as i32,\s*other.position.y.round\(\) as i32,\s*\)\) == Some\(room\)", "", "shared_social_obeys"),
    ("shared-radius", "social_company.rs", r"\s*&& \(other.position.x - position.x\)\s*\.hypot\(other.position.y - position.y\)\s*<= self.radius", "", "shared_social_obeys"),
    ("prospective-preference", "social_company.rs", r"\.is_none_or\(\|p\| p.get\(group\).copied\(\).unwrap_or\(0\.\) < 0\.\)", ".is_none_or(|_p| false)", "shared_social_obeys"),
    ("participant-preference", "social_company.rs", r"\s*\|\| preferences.get\(group\).copied\(\).unwrap_or\(0\.\) < 0\.", "", "shared_social_obeys"),
    ("failed-sharing", "social_company.rs", r"if world.get::<terri_core::Fumbled>\(person\).is_some\(\)\s*\|\|", "if", "differing_or_failed"),
    ("sharing-travel", "social_company.rs", r"if world.get::<Path>\(person\).is_some\(\)\s*\|\|", "if", "shared_social_requires_actual"),
    ("actual-help", "relationship_dynamics.rs", r"crate::need_interactions::active_benefits\(world, entity\)", "crate::need_interactions::goal_benefits(world, entity, *world.get::<Target>(entity).unwrap())", "critical_social_relationship_help"),
    ("seat-help", "need_interactions.rs", r"let seat = seat_rate\(world, person\);", "let seat = 0.;", "critical_comfort_relationship_help"),
    ("owned-refresh", "relationship_dynamics.rs", r"crate::social_company::refresh\(world\);", "", "critical_social_relationship_help"),
    ("same-device", "social_company.rs", r"\s*&& other.station == station", "", "shared_media_refill_is_directional"),
    ("table-facing", "dining.rs", r"\s*&& setting_for\(world, table, chair\).map\(\|\(setting, _\)\| setting\) == diner.setting", "", "meal_social_requires_liked"),
    ("effective-benefits", "social_company.rs", r"delta <= 0\. \|\| need as usize != NeedId::Social.index\(\) \|\| social_available", "true", "social_privacy_substitution_requires"),
]
originals = {}
for name, filename, pattern, replacement, test in cases:
    path = sim / filename
    originals[path] = path.read_bytes()
    count = len(re.findall(pattern, originals[path].decode()))
    if count != 1:
        raise RuntimeError(f"Anchor {name} matches {count} times in {filename}")

base_command = ["cargo", "test", "-p", "terri-sim", "--lib", "-j", "1"]
start = time.monotonic()
print("Running unmutated simulation baseline with one build worker", flush=True)
baseline = subprocess.run(base_command + ["--", "--test-threads=1"], cwd=root, capture_output=True)
elapsed = time.monotonic() - start
baseline_output = (baseline.stdout + baseline.stderr).decode(errors="replace")
(out / "baseline.txt").write_text(baseline_output, encoding="utf-8")
if baseline.returncode != 0 or not re.search(r"test result: ok\. [1-9]\d* passed", baseline_output):
    raise RuntimeError("Unmutated baseline failed; see baseline.txt")
timeout = max(120, math.ceil(4 * elapsed))
print(f"Baseline passed in {elapsed:.2f}s; per-mutation cap {timeout}s", flush=True)
records = []
try:
    for name, filename, pattern, replacement, test in cases:
        path = sim / filename
        before = originals[path]
        changed = re.sub(pattern, replacement, before.decode()).encode()
        if changed == before:
            raise RuntimeError(f"Deletion did not change {name}")
        path.write_bytes(changed)
        command = base_command + [test, "--", "--nocapture", "--test-threads=1"]
        try:
            run = subprocess.run(command, cwd=root, capture_output=True, timeout=timeout)
            output = (run.stdout + run.stderr).decode(errors="replace")
            (out / f"mutation-{name}.txt").write_text(output, encoding="utf-8")
            detected = run.returncode != 0 and "test result: FAILED" in output and "could not compile" not in output
            record = dict(name=name, command=command, exit_code=run.returncode, detected=detected,
                          source_sha256=hashlib.sha256(before).hexdigest(),
                          baseline_seconds=elapsed, timeout_seconds=timeout)
        finally:
            path.write_bytes(before)
            if path.read_bytes() != before:
                raise RuntimeError(f"Restoration failed: {name}")
        record["restored_byte_identical"] = True
        records.append(record)
        (out / "mutations.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
        print(f"{name}: detected={detected}, exit={run.returncode}, restored=True", flush=True)
        if not detected:
            raise RuntimeError(f"Mutation survived or failed to compile: {name}")
finally:
    for path, before in originals.items():
        path.write_bytes(before)
        assert path.read_bytes() == before
