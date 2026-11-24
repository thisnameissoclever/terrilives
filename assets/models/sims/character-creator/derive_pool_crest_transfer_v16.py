"""Derive experimental v16 contacts while preserving the evaluated fixture."""
import hashlib
import json
from copy import deepcopy
from pathlib import Path

from pool_activity_policy_v16 import build_clips


DIRECTORY = Path(__file__).resolve().parent
PHYSICAL_FIELDS = ("solids", "rails", "ground", "waterHeight", "frame", "fixtureModel")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":")).encode()


def main():
    motion_path = DIRECTORY / "pool_activity_motion_v15.json"
    fixture_path = DIRECTORY / "clips/pool/contacts-v4.json"
    motion = json.loads(motion_path.read_bytes())
    fixture = json.loads(fixture_path.read_bytes())
    original = deepcopy(fixture)
    route = {
        "handTransferUnits": [42400, 42800, 43600, 44800],
        "footSwingUnits": [44800, 53200],
        "rightStepUnits": [53200, 64000],
        "sampleUnits": [42000, 42400, 42800, 43600, 44800, 47950, 50050, 53200, 64000],
    }
    motion.update(version=16, crestRoute=route)
    motion["derivation"].update(prior=motion_path.name, crestRoute="Transfer the left hand under two planted soles, then step directly from outside3 to inside3.")
    motion["anchors"] = [row for row in motion["anchors"] if row["unit"] != 48000]
    for row in motion["anchors"]:
        if row["unit"] == 56000:
            row.update(unit=53200, phase=.532)
    transfers = motion["footTransitions"]
    transfers[:] = [row for row in transfers if row["from"] != "crest" or row["limb"] != "footL"]
    for row in transfers:
        if row["limb"] == "footL" and row["from"] == "outside3":
            row.update(to="inside3", startUnit=44800, endUnit=53200, start=.448, end=.532)
        if row["limb"] == "footR" and row["from"] == "crest":
            row.update(startUnit=53200, start=.532)
    regions = {r["surface"]: r["region"] for sample in original["clips"]["pool_enter"]["samples"]
               for r in sample["limbs"].values() if r["surface"] is not None}

    def support(surface, kind="support", interval=None):
        return dict(mode=kind, surface=surface, interval=interval, intervalSpace="clip-phase", region=deepcopy(regions[surface]))

    fixture["clips"] = build_clips(motion, support)
    source_bytes = (json.dumps(motion, indent=2) + "\n").encode()
    fixture["revisions"]["poseProducer"] = digest(source_bytes)
    fixture["revisions"]["clipLibrary"] = digest(canonical(fixture["clips"]))
    assert all(fixture[field] == original[field] for field in PHYSICAL_FIELDS)
    assert fixture["revisions"]["model"] == original["revisions"]["model"]
    fixture_bytes = (json.dumps(fixture, separators=(",", ":")) + "\n").encode()
    (DIRECTORY / "pool_activity_motion_v16.json").write_bytes(source_bytes)
    (fixture_path.parent / "contacts-v5.json").write_bytes(fixture_bytes)
    print(json.dumps({"motion": digest(source_bytes), "fixture": digest(fixture_bytes),
                      "priorMotion": digest(motion_path.read_bytes()), "priorFixture": digest(fixture_path.read_bytes()),
                      "clipLibrary": fixture["revisions"]["clipLibrary"],
                      "physical": {key: digest(canonical(fixture[key])) for key in PHYSICAL_FIELDS}}))


if __name__ == "__main__":
    main()
