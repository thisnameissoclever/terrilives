"""Import the approved static covered-bed contributions without changing old sprites."""
import base64
import hashlib
import itertools
import json
from pathlib import Path

from PIL import Image

MANIFEST_SHA256 = "0c9b1c854d2a74993b1d3e9fb9297e75c4fa5ca59762daa531c363d57acca2cb"
PALETTES = ("green", "blue", "red")
FACINGS = ("SE", "NW", "SW", "NE")


def scene_key(mask, palettes):
    return mask * 9 + PALETTES.index(palettes[0]) * 3 + PALETTES.index(palettes[1])


def load_covered_bed(path):
    path = Path(path).resolve()
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != MANIFEST_SHA256:
        raise ValueError("covered bed manifest differs from the approved production export")
    manifest = json.loads(payload)
    if (manifest["pilot"] is not False or manifest["static"] is not True
            or manifest["version"] != 1 or manifest["pixel_density"] != 2
            or manifest["encoding"] != "scene-linear-premultiplied-visible-additive"
            or manifest["picking"] != "visible-owner-fill-alpha"):
        raise ValueError("unsupported covered bed export contract")
    width, height = manifest["width"] * 2, manifest["height"] * 2
    layers, masks = {}, {}

    def decode(ref, mode, inventory):
        target = (path.parent / ref["path"]).resolve()
        if not target.is_relative_to(path.parent):
            raise ValueError("covered bed reference escapes its export directory")
        if hashlib.sha256(target.read_bytes()).hexdigest() != ref["sha256"]:
            raise ValueError("covered bed file hash differs")
        with Image.open(target) as source:
            source.load()
            if source.mode != mode or source.size != (width, height):
                raise ValueError("covered bed layer mode or registration differs")
            image = source.copy()
        digest = hashlib.sha256(image.tobytes()).hexdigest()
        if digest != ref["pixels_sha256"]:
            raise ValueError("covered bed decoded pixels differ")
        inventory.setdefault(digest, image)
        return digest

    scenes = {}
    expected = set()
    for facing, mask in itertools.product(FACINGS, range(4)):
        for p0, p1 in itertools.product(PALETTES if mask & 1 else ("green",),
                                        PALETTES if mask & 2 else ("green",)):
            expected.add((facing, scene_key(mask, (p0, p1))))
    for row in manifest["scenes"]:
        mask, palettes = row["occupancy"], row["palettes"]
        key = (row["facing"], scene_key(mask, palettes))
        if row["sample"] != 0 or key not in expected or key in scenes:
            raise ValueError("covered bed scene is duplicate, incomplete or unregistered")
        owners = [body["place"] for body in row["bodies"]]
        if owners != [place for place in range(2) if mask & (1 << place)]:
            raise ValueError("covered bed scene owner places differ from occupancy")
        refs = [decode(row["furniture"], "RGBA", layers), None, None,
                decode(row["outline"], "RGBA", layers)]
        coverage = [None, None]
        for body in row["bodies"]:
            place = body["place"]
            refs[place + 1] = decode(body, "RGBA", layers)
            coverage[place] = decode(body["coverage"], "L", masks)
        scenes[key] = (refs, coverage)
    if set(scenes) != expected or len(layers) != 69 or len(masks) != 10:
        raise ValueError("covered bed production inventory is incomplete")
    return manifest, layers, masks, scenes


def append_layers(sprites, anchors, densities, path):
    imported = load_covered_bed(path)
    manifest, layers, _, _ = imported
    indices = {}
    names = {sprite[0] for sprite in sprites}
    for digest, image in sorted(layers.items()):
        name = "coveredBedLayer_" + digest
        if name in names:
            raise ValueError("covered bed layer name already exists")
        index = len(sprites)
        indices[digest] = index
        sprites.append((name, image, image.width, image.height))
        anchors[index] = manifest["anchor"]
        densities[index] = 2
    return imported, indices


def _coverage_record(image):
    box = image.getbbox()
    if box is None:
        raise ValueError("an active covered-bed owner has no visible fill")
    crop = image.crop(box)
    # This is L-mode intensity, never RGBA alpha. Retain zero values inside the crop.
    values = crop.tobytes() if image.mode == "L" else b"".join(int(value).to_bytes(2, "little") for value in crop.getdata())
    record = {"size": list(image.size), "box": list(box), "values": base64.b64encode(values).decode("ascii")}
    if image.mode != "L":
        record["bitDepth"] = 16
    return record


def append_scene_records(sprites, placed, anchors, densities, bounds, imported, indices):
    """Append metadata aliases after texture composition; allocate no duplicate texels."""
    manifest, layers, masks, scenes = imported
    mask_ids = {digest: index for index, digest in enumerate(sorted(masks))}
    coverage = [_coverage_record(masks[digest]) for digest in sorted(masks)]
    catalog, descriptors, alpha_ids = {}, {}, {}
    names = {sprite[0]: index for index, sprite in enumerate(sprites)}
    for (facing, key), (refs, owner_masks) in sorted(scenes.items()):
        empty_name = "offlineDoubleBed" + ("" if facing == "SE" else facing)
        if empty_name not in names:
            raise ValueError("covered bed has no exact empty-facing sprite")
        alias = len(sprites)
        primary = indices[refs[0]]
        _, image, width, height = sprites[primary]
        sprites.append((f"coveredBedScene_{facing}_{key}", image, width, height))
        placed[alias] = placed[primary]
        anchors[alias] = manifest["anchor"]
        densities[alias] = 2
        # Summed alpha gates picking exactly like the shader; each term is already visible.
        # Preserve sums above 255 until AFTER filtering, matching the GPU gate.
        terms = [layers[digest].getchannel("A").tobytes() for digest in refs if digest is not None]
        alpha = Image.new("I", (width, height))
        alpha.putdata([sum(values) for values in zip(*terms)])
        box = alpha.getbbox()
        bounds[alias] = [coordinate / 2 for coordinate in box]
        alpha_digest = hashlib.sha256(alpha.tobytes()).hexdigest()
        if alpha_digest not in alpha_ids:
            alpha_ids[alpha_digest] = len(coverage)
            coverage.append(_coverage_record(alpha))
        alpha_id = alpha_ids[alpha_digest]
        owners = []
        for digest in owner_masks:
            if digest is None:
                owners.append(None)
                continue
            box = masks[digest].getbbox()
            # UI markers use the visible-owner center; scene registration is never moved.
            owners.append({"coverage": mask_ids[digest],
                           "marker": [(box[0] + box[2]) / 4 - manifest["anchor"][0],
                                      (box[1] + box[3]) / 4 - manifest["anchor"][1]]})
        catalog.setdefault(names[empty_name], {})[key] = {
            "sprite": alias, "alpha": alpha_id, "owners": owners,
        }
        descriptors[alias] = [indices[digest] if digest is not None else -1 for digest in refs]
    return catalog, descriptors, coverage
