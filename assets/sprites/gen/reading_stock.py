"""Compile stock appearance and actor occlusion before filtering sprite pixels."""
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

CANVAS = (96, 120)
SOURCE_DENSITY = 8
OUTPUT_DENSITY = 2
FACTOR = SOURCE_DENSITY // OUTPUT_DENSITY
SCALE = 32767


def linear_premultiplied(image):
    value = np.asarray(image.convert('RGBA'), dtype=np.float32) / 255
    rgb = value[:, :, :3]
    value[:, :, :3] = np.where(rgb <= .04045, rgb / 12.92,
                               ((rgb + .055) / 1.055) ** 2.4) * value[:, :, 3:4]
    return value


def block_average(value, factor=FACTOR):
    height, width, channels = value.shape
    if height % factor or width % factor:
        raise ValueError('Stock source pixels do not align with the output filter')
    return value.reshape(height // factor, factor, width // factor, factor, channels).mean(axis=(1, 3))


def actor_visibility(body, shared_ink, body_ink):
    if body.size != shared_ink.size or body.size != body_ink.size:
        raise ValueError('Actor coverage sources have different registrations')
    b, shared, owned = [np.asarray(image.convert('RGBA'), dtype=np.float32)[:, :, 3] / 255
                        for image in (body, shared_ink, body_ink)]
    if np.any(owned > shared + 1 / 255 + 1e-7):
        raise ValueError('Actor-owned ink exceeds the complete scene ink')
    return np.clip(b * (1 - shared) + owned, 0, 1)


def registered_visibility(visibility, scene_anchor, shelf_anchor):
    offsets = (np.asarray(scene_anchor) - shelf_anchor) * SOURCE_DENSITY
    rounded = np.rint(offsets).astype(int)
    if np.max(np.abs(offsets - rounded)) > .001:
        raise ValueError('Stock visibility requires the unchanged source pixel grid')
    x, y = rounded
    width, height = [value * SOURCE_DENSITY for value in CANVAS]
    if x < 0 or y < 0 or x + width > visibility.shape[1] or y + height > visibility.shape[0]:
        raise ValueError('The reach canvas does not contain the registered bookcase')
    return visibility[y:y + height, x:x + width]


@dataclass(frozen=True)
class RawDifference:
    origin: tuple
    values: np.ndarray

    def stock(self):
        return block_average(self.values)

    def correction(self, visibility):
        x, y = self.origin
        height, width = self.values.shape[:2]
        return block_average(-self.values * visibility[y:y + height, x:x + width, None])


def raw_difference(base, stocked):
    if base.shape != stocked.shape or not np.array_equal(base[:, :, 3], stocked[:, :, 3]):
        raise ValueError('Stock changes the case silhouette or source dimensions')
    value = stocked[:, :, :3] - base[:, :, :3]
    ys, xs = np.nonzero(np.any(value != 0, axis=2))
    if not len(xs):
        return None
    x0, y0 = xs.min() // FACTOR * FACTOR, ys.min() // FACTOR * FACTOR
    x1 = (xs.max() // FACTOR + 1) * FACTOR
    y1 = (ys.max() // FACTOR + 1) * FACTOR
    return RawDifference((int(x0), int(y0)), value[y0:y1, x0:x1].copy())


def encode_difference(value, origin=(0, 0), canvas=CANVAS):
    if value.ndim != 3 or value.shape[2] != 3 or not np.isfinite(value).all() or np.abs(value).max() > 1:
        raise ValueError('Stock difference is outside the signed encoding range')
    codes = np.rint(value * SCALE).astype(np.int32)
    ys, xs = np.nonzero(np.any(codes != 0, axis=2))
    if not len(xs):
        return None
    ox, oy = origin
    width, height = [value * OUTPUT_DENSITY for value in canvas]
    x0, y0 = max(0, ox + int(xs.min()) - 1), max(0, oy + int(ys.min()) - 1)
    x1 = min(width, ox + int(xs.max()) + 2)
    y1 = min(height, oy + int(ys.max()) + 2)
    if x0 >= x1 or y0 >= y1:
        raise ValueError('Stock difference has no registered canvas area')
    # Neutral texels preserve interpolation across the cropped coefficient boundary.
    crop = np.zeros((y1 - y0, x1 - x0, 3), dtype=np.int32)
    left, top = max(x0, ox), max(y0, oy)
    right, bottom = min(x1, ox + codes.shape[1]), min(y1, oy + codes.shape[0])
    crop[top - y0:bottom - y0, left - x0:right - x0] = codes[top - oy:bottom - oy, left - ox:right - ox]
    packed = crop + 32768
    alpha = np.full((*crop.shape[:2], 1), 255, np.uint8)
    high = Image.fromarray(np.concatenate([(packed >> 8).astype(np.uint8), alpha], axis=2))
    low = Image.fromarray(np.concatenate([(packed & 255).astype(np.uint8), alpha], axis=2))
    return high, low, [x0, y0, x1, y1]


class StockTableWriter:
    def __init__(self, directory):
        self.directory = Path(directory)
        (self.directory / 'textures' / 'stock').mkdir(parents=True, exist_ok=True)

    def image(self, image, crop):
        pixels_sha = hashlib.sha256(image.tobytes()).hexdigest()
        relative = f'textures/stock/{image.width}x{image.height}-{pixels_sha}.png'
        path = self.directory / relative
        if path.exists():
            with Image.open(path) as prior:
                if prior.size != image.size or prior.convert('RGBA').tobytes() != image.tobytes():
                    raise ValueError('An existing stock texture has different pixels')
        else:
            image.save(path)
        return dict(path=relative, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    pixelsSha256=pixels_sha, width=image.width, height=image.height,
                    rawCrop=crop, trim=[crop[0] / 2, crop[1] / 2, image.width / 2, image.height / 2], canvas=list(CANVAS))

    def pair(self, value, origin):
        encoded = encode_difference(value, origin)
        if encoded is None:
            return None, None
        high, low, crop = encoded
        return self.image(high, crop), self.image(low, crop)


class StockBasis:
    """Cache one facing's cropped raw differences, not a full catalogue of scenes."""
    def __init__(self, root, manifest_path):
        self.root = Path(root)
        self.manifest_path = Path(manifest_path)
        self.manifest = json.loads(self.manifest_path.read_text())
        self.sources = {}
        for source in self.manifest['source_captures']:
            self.sources.setdefault((source['facing'], source['mask']), source)
        self.facing = None
        self.differences = []
        self.inputs = {}

    def source(self, facing, mask):
        source = self.sources[(facing, mask)]
        path = self.root / source['reuse']['path']
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if sha != source['sha256']:
            raise ValueError('Canonical stock source hash differs')
        self.inputs[str(path)] = sha
        with Image.open(path) as image:
            result = linear_premultiplied(image)
        if result.shape != (CANVAS[1] * SOURCE_DENSITY, CANVAS[0] * SOURCE_DENSITY, 4):
            raise ValueError('Canonical stock source canvas differs')
        return result

    def load(self, facing):
        if self.facing == facing:
            return
        self.differences = []
        self.inputs = {str(self.manifest_path): hashlib.sha256(self.manifest_path.read_bytes()).hexdigest()}
        empty = self.source(facing, 0)
        for row in range(4):
            for state in range(64):
                self.differences.append(None if state == 0 else raw_difference(empty, self.source(facing, state << (row * 6))))
        self.facing = facing

    def table(self, facing, writer, visibility=None):
        self.load(facing)
        if visibility is not None:
            visibility = np.ascontiguousarray(visibility, dtype='<f4')
        if visibility is not None and (visibility.shape != (960, 768)
                                       or not np.isfinite(visibility).all() or visibility.min() < 0 or visibility.max() > 1):
            raise ValueError('Actor visibility is outside the canonical stock canvas')
        rows = []
        for index, difference in enumerate(self.differences):
            high, low = None, None
            if difference is not None:
                value = difference.stock() if visibility is None else difference.correction(visibility)
                high, low = writer.pair(value, tuple(coordinate // FACTOR for coordinate in difference.origin))
            rows.append(dict(row=index // 64, state=index % 64, high=high, low=low))
        result = dict(kind='stock' if visibility is None else 'occlusion', facing=facing, canvas=list(CANVAS),
                      encoding='scene-linear-premultiplied-signed16', rows=rows, inputs=dict(self.inputs))
        if visibility is not None:
            result['visibilitySHA'] = hashlib.sha256(visibility.tobytes()).hexdigest()
        return result
