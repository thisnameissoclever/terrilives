"""Import registered visibility contributions without changing the atlas prefix."""
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re

from PIL import Image, ImageChops

FACINGS = ("SE", "NW", "SW", "NE")
VARIANTS = ("green", "blue", "red")
COUNTS = {"bike": 8, "chair": 4}


def empty_name(obj, facing):
    return f"offline{obj.title()}{'' if facing == 'SE' else facing}"


@dataclass
class FurnitureExport:
    sprites: list
    anchor: list
    pairs: dict
    profiles: dict
    bounds: dict


def load_furniture(manifest_path, *, existing_names=()):
    path = Path(manifest_path).resolve()
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if type(data.get("version")) is not int or data["version"] != 1:
        raise ValueError("unsupported furniture manifest version")
    if (any(type(data.get(key)) is not int for key in ("width", "height", "pixel_density")) or
            (data.get("width"), data.get("height"), data.get("pixel_density")) != (96, 120, 2)):
        raise ValueError("furniture registration must be 96x120 at pixel_density 2")
    anchor = data.get("anchor")
    if not isinstance(anchor, list) or len(anchor) != 2 or any(
        type(v) not in (int, float) or not math.isfinite(v) or abs(v - expected) > 0.001
        for v, expected in zip(anchor, (48.00001, 116.00044))
    ):
        raise ValueError("furniture anchor differs from the shared camera registration")
    sprites, pairs, profiles, bounds = [], {}, {}, {}
    names = set(existing_names)
    images, shared = {}, {}
    premultiplied = set()

    def add(name, ref, contribution=False):
        if not isinstance(ref, dict):
            raise ValueError("missing furniture image reference")
        for key in ("width", "height", "pixel_density", "anchor"):
            if key in ref and ref[key] != data[key]:
                raise ValueError("image registration differs from manifest")
        relative, sha = ref.get("path"), ref.get("sha256")
        if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
            raise ValueError("image path must be relative POSIX inside export directory")
        pure = PurePosixPath(relative)
        image_path = (path.parent / relative).resolve()
        if pure.is_absolute() or ".." in pure.parts or not image_path.is_relative_to(path.parent):
            raise ValueError("image path must stay inside export directory")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
            raise ValueError("invalid image hash")
        # Validate every reference, even when its pixels have already been imported.
        if hashlib.sha256(image_path.read_bytes()).hexdigest() != sha:
            raise ValueError(f"{relative}: image hash mismatch")
        if sha not in images:
            with Image.open(image_path) as image:
                if image.format != "PNG" or image.mode != "RGBA" or image.size != (192, 240):
                    raise ValueError(f"{relative}: expected RGBA PNG at 192x240")
                images[sha] = image.copy()
        image = images[sha]
        if contribution and sha not in premultiplied:
            alpha = image.getchannel("A")
            if any(ImageChops.subtract(image.getchannel(channel), alpha).getbbox()
                   for channel in ("R", "G", "B")):
                raise ValueError(f"{relative}: contribution must contain premultiplied RGB")
            premultiplied.add(sha)
        if name in names:
            raise ValueError(f"duplicate furniture sprite name: {name}")
        names.add(name)
        sprites.append((name, image, 192, 240))
        return name

    empty = {}
    for row in data.get("empty", []):
        key = (row.get("object"), row.get("facing"))
        if key in empty:
            raise ValueError("duplicate empty furniture coverage")
        if key[0] not in COUNTS or key[1] not in FACINGS:
            raise ValueError("invalid empty furniture coverage")
        empty[key] = row
    expected_empty = [(obj, facing) for obj in COUNTS for facing in FACINGS]
    if set(empty) != set(expected_empty):
        raise ValueError("missing empty furniture coverage")
    for obj, facing in expected_empty:
        name = empty_name(obj, facing)
        add(name, empty[obj, facing])
        if sprites[-1][1].getchannel("A").getbbox() is None:
            raise ValueError("empty furniture must have visible pixels")
        profiles[name] = {"action": 6 if obj == "bike" else 3,
                          "halfCycleTicks": 8 if obj == "bike" else 24,
                          "frames": {variant: [] for variant in VARIANTS}}
    frames = {}
    for row in data.get("frames", []):
        if type(row.get("frame")) is not int:
            raise ValueError("frame sample must be an integer")
        key = (row.get("object"), row.get("facing"), row.get("variant"), row.get("frame"))
        if key in frames:
            raise ValueError("duplicate occupied furniture coverage")
        frames[key] = row
    expected = [(obj, facing, variant, frame) for obj, count in COUNTS.items()
                for facing in FACINGS for variant in VARIANTS for frame in range(count)]
    if set(frames) != set(expected):
        raise ValueError("missing or invalid occupied furniture coverage")
    for obj, facing, variant, frame in expected:
        row = frames[obj, facing, variant, frame]
        body = add(f"offline{obj.title()}{facing}{variant.title()}{frame}", row.get("body"), True)
        image_bounds = sprites[-1][1].getchannel("A").getbbox()
        if image_bounds is None:
            raise ValueError("occupied furniture body must be visible")
        bounds[body] = [v / 2 for v in image_bounds]
        layers = {}
        for role in ("furniture", "outline"):
            ref = row.get(role)
            if not isinstance(ref, dict):
                raise ValueError(f"missing {role} contribution")
            key = (role, ref.get("sha256"))
            # Every path/hash must be checked, including shared references.
            candidate = f"offline{role.title()}{len(shared)}"
            name = add(candidate, ref, True)
            if key in shared:
                sprites.pop()
                names.remove(name)
                name = shared[key]
            else:
                shared[key] = name
            layers[role] = name
        pairs[body] = layers
        profiles[empty_name(obj, facing)]["frames"][variant].append(body)
    # Source phases turn backward for this rig. Reverse playback, retaining
    # phase zero as the resting/reduced-motion pose and every sprite's index.
    for facing in FACINGS:
        for sequence in profiles[empty_name("bike",facing)]["frames"].values():
            sequence[1:] = reversed(sequence[1:])
    return FurnitureExport(sprites, anchor, pairs, profiles, bounds)


def validate_pairs(sprites, anchors, densities, pairs):
    for body, layers in pairs.items():
        refs = (body, layers["furniture"], layers["outline"])
        if any(type(index) is not int or not 0 <= index < len(sprites) for index in refs):
            raise ValueError("paired sprite index is out of range")
        registration = [(sprites[i][2:], densities.get(i, 1), anchors.get(i)) for i in refs]
        if registration[1:] != registration[:1] * 2:
            raise ValueError("paired sprite registration differs")


def furniture_tables(export, sprites):
    indices = {sprite[0]: i for i, sprite in enumerate(sprites)}
    anchors = {indices[name]: list(export.anchor) for name, *_ in export.sprites}
    density = {index: 2 for index in anchors}
    bounds = {indices[name]: box for name, box in export.bounds.items()}
    tops = {index: box[1] for index, box in bounds.items()}
    pairs = {indices[name]: {role: indices[layer] for role, layer in layers.items()}
             for name, layers in export.pairs.items()}
    catalog = {indices[name]: {**profile, "frames": {
        variant: [indices[body] for body in frames] for variant, frames in profile["frames"].items()
    }} for name, profile in export.profiles.items()}
    validate_pairs(sprites, anchors, density, pairs)
    return anchors, tops, bounds, density, pairs, catalog
