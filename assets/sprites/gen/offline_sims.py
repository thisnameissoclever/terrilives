"""Validate offline model renders before appending them to the sprite atlas."""

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import re

from PIL import Image


FACINGS = ("SE", "NW", "SW", "NE")  # Render-buffer order: +X, -X, +Y, -Y.
STEMS = {
    "idle": "Idle", "walk": "Walk", "read": "Read", "talk": "Talk",
    "eat": "Eat", "stand_read": "StandRead", "watch_fish": "WatchFish",
    "sit": "Sit", "sleep": "Sleep", "exercise": "Exercise",
}


@dataclass
class SimExport:
    sprites: list
    clips: dict
    frames: dict
    variant: str = "green"
    pixel_density: int = 1


def load_export(manifest_path, *, required_clips=(), existing_names=(), expected_variant="green"):
    """Load only complete clips; pilot exports cannot satisfy a full-set gate."""
    path = Path(manifest_path).resolve()
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    density = data.get("pixel_density", 1)
    if type(density) is not int or density < 1:
        raise ValueError("pixel_density must be a positive integer")
    variant = data.get("variant", "green")
    if variant not in ("green", "blue", "red") or variant != expected_variant:
        raise ValueError(f"unexpected Sim shirt variant: {variant}")
    prefix = "rigSim" + (variant.title() if variant != "green" else "")
    if data.get("schema_version") != 1:
        raise ValueError("unsupported Sim export schema_version")
    if (data.get("width"), data.get("height")) != (38, 88):
        raise ValueError("Sim exports must declare 38x88 base dimensions")
    anchor = data.get("anchor")
    if not isinstance(anchor, list) or len(anchor) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 512 for v in anchor):
        raise ValueError("base anchor must contain bounded finite pixel coordinates")
    clips = data.get("clips")
    if not isinstance(clips, dict) or not clips:
        raise ValueError("Sim export must declare clips")
    missing = set(required_clips) - clips.keys()
    if missing:
        raise ValueError(f"missing required clips: {sorted(missing)}")
    for action, clip in clips.items():
        if action not in STEMS or not isinstance(clip, dict):
            raise ValueError(f"unsupported clip: {action}")
        count = clip.get("frame_count")
        if type(count) is not int or not 1 <= count <= 120:
            raise ValueError(f"{action}: frame_count must be an integer from 1 to 120")
        rate = clip.get("sample_fps")
        if type(rate) not in (int, float) or not math.isfinite(rate) or rate <= 0:
            raise ValueError(f"{action}: sample_fps must be finite and positive")
        if type(clip.get("loop")) is not bool or not isinstance(clip.get("source_action"), str) or not clip["source_action"]:
            raise ValueError(f"{action}: declare loop and source_action")
        if any(key in clip for key in ("width", "height", "anchor")):
            width, height, anchor = clip.get("width"), clip.get("height"), clip.get("anchor")
            if type(width) is not int or type(height) is not int or not 1 <= width <= 256 or not 1 <= height <= 256:
                raise ValueError(f"{action}: registered dimensions must be integers from 1 to 256")
            if not isinstance(anchor, list) or len(anchor) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 512 for v in anchor):
                raise ValueError(f"{action}: explicit anchor must contain bounded finite pixel coordinates")
        else:
            clip.update(width=38, height=88, anchor=data["anchor"])
    rows = data.get("frames")
    if not isinstance(rows, list):
        raise ValueError("Sim export must contain frames")
    occupied_names = set(existing_names)
    indexed = {}
    metadata = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("invalid Sim frame record")
        action, facing, frame = row.get("action"), row.get("facing"), row.get("frame")
        if action not in clips or facing not in FACINGS or type(frame) is not int or not 0 <= frame < clips[action]["frame_count"]:
            raise ValueError("frame does not belong to a declared clip/facing/sample")
        name = row.get("name")
        if name != f"{prefix}{STEMS[action]}{facing}{frame}" or name in occupied_names:
            raise ValueError(f"invalid or duplicate sprite name: {name}")
        occupied_names.add(name)
        relative = row.get("path")
        if not isinstance(relative, str) or not relative:
            raise ValueError(f"{name}: frame path must stay inside export directory")
        image_path = (path.parent / relative).resolve()
        if Path(relative).is_absolute() or not image_path.is_relative_to(path.parent):
            raise ValueError(f"{name}: frame path must stay inside export directory")
        expected_hash = row.get("sha256")
        if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
            raise ValueError(f"{name}: invalid SHA-256 hash")
        if hashlib.sha256(image_path.read_bytes()).hexdigest() != expected_hash:
            raise ValueError(f"{name}: source hash mismatch")
        with Image.open(image_path) as image:
            width, height = clips[action]["width"], clips[action]["height"]
            if image.format != "PNG" or image.mode != "RGBA" or image.size != (width * density, height * density):
                raise ValueError(f"{name}: expected an RGBA PNG at {width * density}x{height * density}")
            crop = image.copy()
        bounds = crop.getchannel("A").getbbox()
        if bounds is None:
            raise ValueError(f"{name}: empty frame")
        hand = row.get("hand_anchor")
        if action == "eat" and (not isinstance(hand, list) or len(hand) != 2 or
                any(type(v) not in (int, float) or not math.isfinite(v) for v in hand) or
                not 0 <= hand[0] <= width or not 0 <= hand[1] <= height):
            raise ValueError(f"{name}: eating requires a visible finite hand_anchor")
        if action == "eat" and type(row.get("hand_in_front")) is not bool:
            raise ValueError(f"{name}: eating requires an explicit hand_in_front depth order")
        row["content_top"] = bounds[1] / density
        indexed[(action, facing, frame)] = (name, crop, width * density, height * density)
        metadata[name] = row
    expected = [
        (action, facing, frame)
        for action in STEMS if action in clips
        for facing in FACINGS
        for frame in range(clips[action]["frame_count"])
    ]
    if set(indexed) != set(expected):
        raise ValueError("every clip must have complete contiguous samples in all four facings")
    return SimExport([indexed[key] for key in expected], clips, metadata, variant, density)


def runtime_tables(export, all_sprites):
    """Resolve clip samples and registration from one validated export."""
    indices = {sprite[0]: index for index, sprite in enumerate(all_sprites)}
    prefix = "rigSim" + (export.variant.title() if export.variant != "green" else "")
    anchors, hands, tops, clips, hand_fronts = {}, {}, {}, {}, {}
    for name, row in export.frames.items():
        index = indices[name]
        anchors[index] = export.clips[row["action"]]["anchor"]
        tops[index] = row["content_top"]
        if "hand_anchor" in row:
            hands[index] = row["hand_anchor"]
            hand_fronts[index] = row["hand_in_front"]
    for action in STEMS:
        if action not in export.clips:
            continue
        clip = export.clips[action]
        clips[action] = {"frames": [
            [indices[f"{prefix}{STEMS[action]}{facing}{frame}"] for frame in range(clip["frame_count"])]
            for facing in FACINGS
        ]}
        if action == "walk":
            distance = clip.get("distance_per_cycle_model_units")
            if type(distance) not in (int, float) or distance <= 0 or not math.isfinite(distance) or abs(1 / distance - round(1 / distance)) > 1e-9:
                raise ValueError("walk cycle distance must meet at integer tile corners")
            clips[action]["cycleTiles"] = distance
    return anchors, hands, tops, clips, hand_fronts
