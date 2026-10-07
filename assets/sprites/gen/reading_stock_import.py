"""Validate and import registered signed stock tables for owned-book poses."""
import hashlib
import math
import re
from pathlib import Path

from PIL import Image


class StockTableImporter:
    def __init__(self, sprites, anchors, densities, trims):
        self.sprites, self.anchors = sprites, anchors
        self.densities, self.trims = densities, trims
        self.tables, self.table_ids, self.texture_ids, self.checked_paths = [], {}, {}, {}
        self.checked_borders = set()

    def texture(self, directory, reference, anchor):
        directory = Path(directory).resolve()
        path = (directory / reference['path']).resolve()
        if not path.is_relative_to(directory):
            raise ValueError('Stock texture leaves its immutable export')
        crop, width, height = reference['rawCrop'], reference['width'], reference['height']
        if (len(crop) != 4 or any(type(value) is not int for value in crop)
                or crop[2] - crop[0] != width or crop[3] - crop[1] != height
                or not 0 <= crop[0] < crop[2] <= 192 or not 0 <= crop[1] < crop[3] <= 240
                or reference['trim'] != [crop[0] / 2, crop[1] / 2, width / 2, height / 2]):
            raise ValueError('Stock texture registration differs from its pixel crop')
        expected = (reference['sha256'], reference['pixelsSha256'], width, height)
        if path not in self.checked_paths:
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected[0]:
                raise ValueError('Stock texture file hash differs')
            with Image.open(path) as source:
                image = source.convert('RGBA')
            if (image.size != (width, height) or hashlib.sha256(image.tobytes()).hexdigest() != expected[1]
                    or image.getchannel('A').getextrema() != (255, 255)):
                raise ValueError('Stock texture pixels or opaque coefficient coverage differ')
            self.checked_paths[path] = (expected, image)
        saved, image = self.checked_paths[path]
        if saved != expected:
            raise ValueError('Stock texture has conflicting identities')
        key = (expected[1], width, height, tuple(crop))
        if key not in self.texture_ids:
            index = len(self.sprites)
            self.texture_ids[key] = index
            self.sprites.append((f'readingStock_{expected[1]}_{crop[0]}_{crop[1]}', image, width, height))
            self.anchors[index] = anchor
            self.densities[index] = 2
            self.trims[index] = [crop[0] / 2, crop[1] / 2]
        return self.texture_ids[key]

    def manifest(self, directory, manifest):
        anchor = manifest.get('shelfAnchor')
        if (not isinstance(anchor, list) or len(anchor) != 2
                or any(type(value) not in (int, float) or not math.isfinite(value) for value in anchor)):
            raise ValueError('Book reach has no canonical shelf anchor')
        result = {}
        for name, source in manifest.get('stockTables', {}).items():
            if (source['kind'] not in ('stock', 'occlusion') or source['facing'] not in ('SE', 'NW', 'SW', 'NE')
                    or source['canvas'] != [96, 120] or source['encoding'] != 'scene-linear-premultiplied-signed16'
                    or len(source['rows']) != 256):
                raise ValueError('Book reach stock table contract differs')
            if source['kind'] == 'occlusion' and not valid_visibility_hash(source.get('visibilitySHA')):
                raise ValueError('Stock correction has no source visibility identity')
            pairs = []
            for index, row in enumerate(source['rows']):
                high, low = row['high'], row['low']
                if (type(row['row']) is not int or type(row['state']) is not int
                        or row['row'] != index // 64 or row['state'] != index % 64
                        or (high is None) != (low is None) or (index % 64 == 0 and high is not None)):
                    raise ValueError('Book reach stock states or empty state differ')
                if high is None:
                    pairs.append([-1, -1])
                    continue
                if high['rawCrop'] != low['rawCrop'] or high['trim'] != low['trim']:
                    raise ValueError('Signed stock pair registrations differ')
                pair = [self.texture(directory, high, anchor), self.texture(directory, low, anchor)]
                self.neutral_border(pair, high['rawCrop'])
                pairs.append(pair)
            key = tuple(tuple(pair) for pair in pairs)
            if key not in self.table_ids:
                self.table_ids[key] = len(self.tables)
                self.tables.append(pairs)
            result[name] = dict(index=self.table_ids[key], kind=source['kind'], facing=source['facing'],
                                canvas=source['canvas'], visibilitySHA=source.get('visibilitySHA'),
                                zero=all(pair == [-1, -1] for pair in pairs))
        return result

    def neutral_border(self, pair, crop):
        key = tuple(pair)
        if key in self.checked_borders:
            return
        high, low = [self.sprites[index][1] for index in pair]
        width, height = high.size
        edges = []
        if crop[0] > 0:
            edges.append((0, 0, 1, height))
        if crop[1] > 0:
            edges.append((0, 0, width, 1))
        if crop[2] < 192:
            edges.append((width - 1, 0, width, height))
        if crop[3] < 240:
            edges.append((0, height - 1, width, height))
        for edge in edges:
            high_bytes = high.crop(edge).convert('RGB').tobytes()
            low_bytes = low.crop(edge).convert('RGB').tobytes()
            if high_bytes != bytes([128]) * len(high_bytes) or low_bytes != bytes(len(low_bytes)):
                raise ValueError('Stock coefficient crop has no neutral interpolation border')
        self.checked_borders.add(key)


def valid_visibility_hash(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{64}', value) is not None


def stock_scene(row, manifest, tables):
    stock = tables.get(row.get('stockTable'))
    if not stock or stock['kind'] != 'stock' or stock['facing'] != row['facing']:
        raise ValueError('Reach pose has no matching canonical stock table')
    offset = [row['anchor'][axis] - manifest['shelfAnchor'][axis] for axis in range(2)]
    if any(value < 0 or value + stock['canvas'][axis] > row['canvas'][axis] for axis, value in enumerate(offset)):
        raise ValueError('Reach canvas clips its registered bookcase')
    result = dict(stock=stock['index'], canvas=stock['canvas'], offset=offset)
    correction = tables.get(row.get('stockCorrection'))
    visibility = row.get('stockVisibilitySHA')
    if (not valid_visibility_hash(visibility) or not correction or correction['kind'] != 'occlusion'
            or correction['facing'] != row['facing'] or correction['visibilitySHA'] != visibility):
        raise ValueError('Reach pose has no matching source visibility correction table')
    if not correction['zero']:
        result['correction'] = correction['index']
    return result
