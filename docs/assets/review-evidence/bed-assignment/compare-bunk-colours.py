"""Measure colour reuse against receipt-verified bunk images without rendering.

Requires the existing Pillow tooling. Prints JSON; does not modify source assets.
Exit zero means the comparison ran, not that colour reuse passed visual review.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_path(base, record):
    path = base / record["path"]
    if digest(path) != record["sha256"]:
        raise ValueError(f"Receipt hash differs: {path}")
    return path


def unique_row(rows, facing, frame):
    matches = [row for row in rows if row["facing"] == facing
               and row["frame"] == frame and row["variant"] == "green"]
    if len(matches) != 1:
        raise ValueError(f"Expected one green {facing} sample {frame}, got {len(matches)}")
    return matches[0]


def compare(first, second, radius):
    if first.mode != "RGBA" or second.mode != "RGBA" or first.size != second.size:
        raise ValueError("Expected equally sized RGBA contributions")
    opaque = ImageChops.darker(
        first.getchannel("A").point(lambda value: 255 if value == 255 else 0),
        second.getchannel("A").point(lambda value: 255 if value == 255 else 0),
    )
    # Outside the image is transparent, including at the filter boundary.
    padded = ImageOps.expand(opaque, border=radius, fill=0)
    filtered = padded.filter(ImageFilter.MinFilter(2 * radius + 1))
    interior = filtered.crop((radius, radius, radius + first.width, radius + first.height))
    red, green, blue = ImageChops.difference(first.convert("RGB"), second.convert("RGB")).split()
    maximum = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    masked = ImageChops.multiply(maximum, interior)
    histogram = masked.histogram()
    count = interior.histogram()[255]
    if count == 0:
        raise ValueError("No common opaque interior pixels; comparison is inconclusive")
    return {
        "size": list(first.size),
        "opaque_neighborhood_radius": radius,
        "common_opaque_interior_pixels": count,
        "different_rgb_pixels": sum(histogram[1:]),
        "maximum_channel_difference": max(index for index, count in enumerate(histogram) if count),
    }


def compare_records(base, records, radius):
    paths = [checked_path(base, record) for record in records]
    with Image.open(paths[0]) as first, Image.open(paths[1]) as second:
        metrics = compare(first, second, radius)
    return {"inputs": records, **metrics}


def report(receipt_path):
    receipt = json.loads(receipt_path.read_text())
    if receipt["review_status"] != "accepted-independent-review":
        raise ValueError("Expected the accepted bunk receipt")
    proof_path = checked_path(receipt_path.parent, receipt["raw_proof"])
    manifest_path = checked_path(receipt_path.parent, receipt["manifest"])
    proof = json.loads(proof_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    furniture = [row for row in proof["renders"] if row["owner"] == "furniture"]
    comparisons = []
    for facing in ("SE", "NW", "SW", "NE"):
        raw = [unique_row(furniture, facing, frame) for frame in (0, 3)]
        exported = [unique_row(manifest["frames"], facing, frame)["furniture"] for frame in (0, 3)]
        comparisons.append({
            "facing": facing,
            "raw": compare_records(proof_path.parent, raw, 4),
            "exported": compare_records(manifest_path.parent, exported, 1),
        })
    return {
        "scope": "Green lower-bunk furniture samples 0 and 3; no double-bed acceptance",
        "channel_units": "8-bit PNG values, not linear-light error",
        "identical_state_noise_control": "not available in this receipt",
        "receipt_sha256": digest(receipt_path),
        "raw_proof": receipt["raw_proof"],
        "manifest": receipt["manifest"],
        "comparisons": comparisons,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("receipt", type=Path)
    args = parser.parse_args()
    print(json.dumps(report(args.receipt), indent=2))
