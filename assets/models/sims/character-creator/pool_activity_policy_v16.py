"""Derive the left rail transfer from the same integer clock as the feet."""
from copy import deepcopy

from pool_activity_policy_v13 import build_clips as build_base_clips, mode


def build_clips(source, support):
    scale = source["clockUnits"]
    route = source["crestRoute"]
    release, free, approach, plant = route["handTransferUnits"]
    if not release < free < approach < plant <= route["footSwingUnits"][0]:
        raise ValueError("The leading hand must replant before the left foot departs")

    # The base policy accepts additional sample keys via the anchor clock.
    schedule = dict(source, anchors=[
        *source["anchors"],
        *({"unit": unit} for unit in route["sampleUnits"]),
    ])
    clips = build_base_clips(schedule, support)

    def record(travel):
        if not release / scale <= travel < plant / scale:
            return None
        if travel < free / scale:
            return support("Pool ladder rail 1", "release", [release / scale, free / scale])
        if travel < approach / scale:
            return mode("free")
        return support("Pool ladder rail 1", "approach", [approach / scale, plant / scale])

    def reverse(row):
        row = deepcopy(row)
        if row["interval"]:
            row["interval"] = [1 - .9 * p for p in reversed(row["interval"])]
            row["mode"] = {"release": "approach", "approach": "release"}[row["mode"]]
        return row

    for name, clip in clips.items():
        if name == "pool_paddle":
            continue
        exit_clip = name.startswith("pool_exit_")
        for sample in clip["samples"]:
            row = record(sample["travel"])
            if row:
                sample["limbs"]["handL"] = reverse(row) if exit_clip else row
        for window in clip["intervals"]:
            mid = (window["start"] + window["end"]) / 2
            travel = (1 - mid) / .9 if exit_clip else mid
            row = record(travel)
            if row:
                window["limbs"]["handL"] = reverse(row) if exit_clip else row
    return clips
