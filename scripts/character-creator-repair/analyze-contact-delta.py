"""Measure the intentional phase-reference change without image tolerances."""
import gzip
import json
from pathlib import Path

import numpy as np
from PIL import Image

root = Path("docs/evidence/2026-10-13-creator-repair/prepared-parity")
old = root / "contact-old-raw"
new = root / "contact-canonical-raw"
before = json.loads((old / "receipt.json").read_text(encoding="utf-8"))
after = json.loads((new / "receipt.json").read_text(encoding="utf-8"))
rows = []

for index, (a, b) in enumerate(zip(before["rows"], after["rows"], strict=True)):
    assert a["file"] == b["file"] and a["sha256"] == b["sha256"]
    width = a["attachments"]["surface"]["width"]
    height = a["attachments"]["surface"]["height"]

    def read(folder, name, dtype):
        return np.frombuffer(gzip.decompress((folder / f"{index:03}-{name}").read_bytes()), dtype=dtype)

    old_ids = read(old, "identity.bin.gz", "<u4")
    new_ids = read(new, "identity.bin.gz", "<u4")
    assert np.array_equal(old_ids, new_ids)
    assert a["attachments"]["annotation"] == b["attachments"]["annotation"]
    old_depth = read(old, "surface.bin.gz", "<u4")
    new_depth = read(new, "surface.bin.gz", "<u4")
    depth_mask = old_depth != new_depth
    depth_indices = np.flatnonzero(depth_mask)
    depth_values_old = old_depth.view("<f4")[depth_mask].astype(np.float64)
    depth_values_new = new_depth.view("<f4")[depth_mask].astype(np.float64)
    assert np.isfinite(depth_values_old).all() and np.isfinite(depth_values_new).all()
    old_color = read(old, "color.rgba16f.gz", "<u2").reshape(-1, 4)
    new_color = read(new, "color.rgba16f.gz", "<u2").reshape(-1, 4)
    color_mask = np.any(old_color != new_color, axis=1)
    color_indices = np.flatnonzero(color_mask)
    color_delta = np.abs(old_color[color_mask].view("<f2").astype(np.float32) - new_color[color_mask].view("<f2").astype(np.float32))

    def bounds(indices):
        if len(indices) == 0:
            return None
        return [int((indices % width).min()), int((indices // width).min()),
                int((indices % width).max()), int((indices // width).max())]

    displayed_old = np.asarray(Image.open(old / a["screenshot"]).convert("RGBA"))
    displayed_new = np.asarray(Image.open(new / b["screenshot"]).convert("RGBA"))
    displayed_delta = np.abs(displayed_old.astype(np.int16) - displayed_new.astype(np.int16))
    display_mask = np.any(displayed_delta != 0, axis=2)
    rows.append({
        "file": a["file"], "physicalIdentityExact": True, "annotationIdentityExact": True,
        "surfaceSamplesChanged": int(depth_mask.sum()), "surfaceOwners": np.unique(old_ids[depth_mask]).tolist(),
        "surfaceMaxAbsoluteDifference": float(np.abs(depth_values_old - depth_values_new).max(initial=0)),
        "surfaceBoundsAtSceneResolution": bounds(depth_indices),
        "colorSamplesChanged": int(color_mask.sum()), "colorOwners": np.unique(old_ids[color_mask]).tolist(),
        "colorMaxAbsoluteDifference": float(color_delta.max(initial=0)), "colorBoundsAtSceneResolution": bounds(color_indices),
        "displayedPixelsChanged": int(display_mask.sum()), "displayedMaxChannelDifference": int(displayed_delta.max(initial=0)),
        "sceneSize": [width, height], "actors": b["scene"]["actors"],
    })

result = {"scope": "Exact old first-entry phase 2 versus explicit canonical phase 0; no tolerance or changed-pixel masking.", "rows": rows}
(root / "contact-phase-delta.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps([{k: v for k, v in row.items() if k != "actors"} for row in rows]))
