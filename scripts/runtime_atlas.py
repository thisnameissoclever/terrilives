"""Lossless bordered atlas blocks and source-derived CPU coverage.

Unique blocks live in a temporary backing file. Only one decoded source or
physical page and the small hash index need to be resident during generation.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import math
import mmap
import re
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

VIRTUAL_SIZE = 2048
TILE_SIZE = 8
BORDER = 1
PHYSICAL_SIZE = 2048
CELL_SIZE = TILE_SIZE + 2 * BORDER
TILES_PER_ROW = PHYSICAL_SIZE // CELL_SIZE
SLOTS_PER_PAGE = TILES_PER_ROW ** 2
BUDGET = 384 * 1024 ** 2
OUTPUT = Path('web/public/atlas-storage')
METADATA = Path('web/src/render/atlas-storage-metadata.ts')
FOLDERS = ('fixture-depth', 'aquarium-depth', 'outdoor-depth', 'shelf-depth',
           'components', 'dropped-book')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_initializer(source: str, name: str):
    """Read generated JSON without evaluating TypeScript or matching nested braces."""
    match = re.search(r'export const ' + re.escape(name) + r'\b[^\n]*?=\s*', source)
    if not match:
        raise ValueError(f'Missing generated initializer: {name}')
    value, end = json.JSONDecoder().raw_decode(source, match.end())
    if not source[end:].lstrip().startswith(';'):
        raise ValueError(f'Non-JSON generated initializer: {name}')
    return value


def bordered_blocks(page: np.ndarray, tile_size: int = TILE_SIZE):
    if (page.dtype != np.uint8 or page.ndim != 3 or page.shape[2] != 4
            or page.shape[0] != page.shape[1] or page.shape[0] == 0
            or tile_size <= 0 or page.shape[0] % tile_size):
        raise ValueError('Virtual page dimensions or pixel type are invalid')
    padded = np.pad(page, ((1, 1), (1, 1), (0, 0)), mode='edge')
    stride = tile_size + 2
    for y in range(0, page.shape[0], tile_size):
        for x in range(0, page.shape[1], tile_size):
            yield padded[y:y + stride, x:x + stride].tobytes()


class TileStore:
    """Disk-backed exact interning; hashes select candidates, bytes decide equality."""

    def __init__(self, path: Path, tile_size: int = TILE_SIZE):
        self.file = path.open('w+b')
        self.tile_size = tile_size
        self.block_bytes = (tile_size + 2) ** 2 * 4
        self.count = 0
        self.index: dict[bytes, list[int]] = {}
        self.zero = bytes(self.block_bytes)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.file.close()

    def read(self, index: int) -> bytes:
        if not 0 <= index < self.count:
            raise ValueError('Physical block index is invalid')
        self.file.seek(index * self.block_bytes)
        result = self.file.read(self.block_bytes)
        if len(result) != self.block_bytes:
            raise ValueError('Physical block is truncated')
        return result

    def add_page(self, page: np.ndarray) -> np.ndarray:
        entries = []
        for block in bordered_blocks(page, self.tile_size):
            if block == self.zero:
                entries.append(0)
                continue
            digest = hashlib.sha256(block).digest()
            candidates = self.index.get(digest, [])
            found = next((index for index in candidates if self.read(index) == block), None)
            if found is None:
                found = self.count
                self.file.seek(found * self.block_bytes)
                self.file.write(block)
                self.count += 1
                if candidates:
                    candidates.append(found)
                else:
                    self.index[digest] = [found]
            entries.append(found + 1)
        return np.asarray(entries, dtype='<u4')


def verify_page(page: np.ndarray, entries: np.ndarray, read_block, unique: int,
                tile_size: int = TILE_SIZE) -> None:
    """Reconstruct source pixels and check halos independently of producer extraction."""
    if (page.dtype != np.uint8 or page.ndim != 3 or page.shape[2] != 4
            or page.shape[0] != page.shape[1] or page.shape[0] == 0
            or tile_size <= 0 or page.shape[0] % tile_size):
        raise ValueError('Virtual page dimensions or pixel type are invalid')
    size = page.shape[0]
    blocks_per_side = size // tile_size
    expected_count = blocks_per_side ** 2
    if (entries.ndim != 1 or len(entries) != expected_count or entries.dtype.kind not in 'ui'
            or np.any(entries < 0) or np.any(entries > unique)):
        raise ValueError('Virtual block lookup length or index is invalid')
    cell_size = tile_size + 2
    cells = np.zeros((expected_count, cell_size, cell_size, 4), dtype=np.uint8)
    for position in np.flatnonzero(entries):
        actual = read_block(int(entries[position]) - 1)
        if len(actual) != cell_size ** 2 * 4:
            raise ValueError('Physical block byte length is invalid')
        cells[position] = np.frombuffer(actual, dtype=np.uint8).reshape(cell_size, cell_size, 4)
    cells = cells.reshape(blocks_per_side, blocks_per_side, cell_size, cell_size, 4)

    # Lookup positions define block row then column. Reassemble the complete
    # center image without extracting any expected source blocks.
    reconstructed = cells[:, :, 1:-1, 1:-1].transpose(0, 2, 1, 3, 4).reshape(page.shape)
    if reconstructed.tobytes() != page.tobytes():
        raise ValueError('Reconstructed virtual page pixels differ from source')

    # Compute each edge's source coordinates directly. No padded source image
    # or producer iterator participates in this halo oracle, including corners.
    starts = np.arange(blocks_per_side) * tile_size
    along = np.clip(starts[:, None] + np.arange(-1, tile_size + 1), 0, size - 1)
    before = np.maximum(starts - 1, 0)
    after = np.minimum(starts + tile_size, size - 1)
    sides = (
        (cells[:, :, 0, :, :], page[before[:, None, None], along[None, :, :]]),
        (cells[:, :, -1, :, :], page[after[:, None, None], along[None, :, :]]),
        (cells[:, :, :, 0, :], page[along[:, None, :], before[None, :, None]]),
        (cells[:, :, :, -1, :], page[along[:, None, :], after[None, :, None]]),
    )
    if any(not np.array_equal(actual, expected) for actual, expected in sides):
        raise ValueError('Virtual page halo pixels differ from independently clamped source')


def body_mask(alpha: np.ndarray) -> tuple[bytes, bytes, bytes]:
    flat = alpha.reshape(-1)
    partial = np.flatnonzero((flat > 0) & (flat < 255))
    return (np.packbits(flat == 255, bitorder='little').tobytes(),
            partial.astype('<u4').tobytes(), flat[partial].tobytes())


def indicator_bottom(alpha: np.ndarray, density: float) -> float:
    rows = np.flatnonzero(np.any(alpha >= 32, axis=1))
    if not len(rows) or density <= 0:
        raise ValueError('Activity indicator has no visible coverage or invalid density')
    return int(rows[-1] + 1) / density


def coverage_span(payload: bytes, span: list[int], words: bool = False) -> np.ndarray:
    if len(span) != 2 or any(type(value) is not int for value in span):
        raise ValueError('CPU coverage span is invalid')
    offset, count = span
    if offset < 4 or count < 0 or offset + count * (4 if words else 1) > len(payload) or words and offset % 4:
        raise ValueError('CPU coverage span bounds or alignment are invalid')
    return np.frombuffer(payload, dtype='<u4' if words else np.uint8, count=count, offset=offset)


def decode_body_mask(payload: bytes, row: dict, pixel_count: int) -> np.ndarray:
    opaque = coverage_span(payload, row['opaque'])
    indices = coverage_span(payload, row['partialPixels'], words=True)
    partial = coverage_span(payload, row['partialAlpha'])
    if len(opaque) != math.ceil(pixel_count / 8) or len(indices) != len(partial):
        raise ValueError('CPU body coverage lengths are invalid')
    if (np.any(indices >= pixel_count) or np.any(indices[1:] <= indices[:-1])
            or np.any(partial == 0) or np.any(partial == 255)):
        raise ValueError('CPU body partial coverage is invalid')
    # Decode by shifts, independently of the producer's packbits operation.
    positions = np.arange(pixel_count)
    alpha = (((opaque[positions // 8] >> (positions % 8)) & 1) * 255).astype(np.uint8)
    if np.any(alpha[indices]):
        raise ValueError('Opaque and partial body coverage overlap')
    if pixel_count % 8 and int(opaque[-1]) >> (pixel_count % 8):
        raise ValueError('Body coverage has set bits outside its rectangle')
    alpha[indices] = partial
    return alpha


def verify_cpu_page(payload: bytes, records: dict, sprites: list[dict], layer: int, page: np.ndarray):
    for kind in ('bodies', 'dishes', 'indicators'):
        for row in records[kind]:
            sprite = sprites[row['sprite']]
            if sprite.get('page', 0) != layer:
                continue
            x, y, w, h = (sprite[key] for key in ('x', 'y', 'w', 'h'))
            expected = page[y:y + h, x:x + w, 3]
            if kind == 'bodies':
                actual = decode_body_mask(payload, row, w * h)
            elif kind == 'dishes':
                actual = coverage_span(payload, row['alpha'])
            else:
                bottom = max((y + 1 for y in range(h) if np.any(expected[y] >= 32)), default=0)
                if bottom == 0 or row['bottomPixels'] != bottom / sprite.get('pixel_density', 1):
                    raise ValueError('Indicator bottom differs from source alpha')
                continue
            if not np.array_equal(actual, expected.reshape(-1)):
                raise ValueError(f'{kind} coverage differs from source alpha')


@dataclass(frozen=True)
class Source:
    path: Path
    width: int
    height: int
    digest: str
    raw: bool = False

    def page(self) -> np.ndarray:
        data = self.path.read_bytes()
        if sha256(data) != self.digest:
            raise ValueError(f'Source checksum differs: {self.path}')
        if self.raw:
            if len(data) != self.width * self.height * 4:
                raise ValueError(f'Source RGBA byte length differs: {self.path}')
            pixels = np.frombuffer(data, dtype=np.uint8).reshape(self.height, self.width, 4)
        else:
            with Image.open(io.BytesIO(data)) as image:
                if image.size != (self.width, self.height):
                    raise ValueError(f'Source PNG dimensions differ: {self.path}')
                pixels = np.asarray(image.convert('RGBA'))
        if not (0 < self.width <= VIRTUAL_SIZE and 0 < self.height <= VIRTUAL_SIZE):
            raise ValueError(f'Source exceeds virtual page: {self.path}')
        page = np.zeros((VIRTUAL_SIZE, VIRTUAL_SIZE, 4), dtype=np.uint8)
        page[:self.height, :self.width] = pixels
        return page


def source_catalog(root: Path):
    manifest = tomllib.loads((root / 'assets/sprites/atlas.toml').read_text(encoding='utf-8'))
    original = manifest['pages']
    if not original or not all(isinstance(name, str) for name in original):
        raise ValueError('Atlas page names must be a nonempty string list')
    sources = []
    for name in original + ['grime/household-stains.png']:
        path = root / 'web/public' / name
        data = path.read_bytes()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
        if name in original and (width, height) != (VIRTUAL_SIZE, VIRTUAL_SIZE):
            raise ValueError('Original atlas page dimensions differ')
        digest = sha256(data)
        if name in original and digest not in name:
            raise ValueError('Original atlas page filename does not match its checksum')
        sources.append(Source(path, width, height, digest))
    companions = []
    for folder in FOLDERS:
        directory = root / 'assets/models/sims/character-repair' / folder
        data = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
        if data['state'] != 'complete':
            raise ValueError(f'Fixture companion export is incomplete: {folder}')
        groups = [data['pages']] if folder in FOLDERS[:4] else [data['colorPages'], data['depthPages']]
        for group in groups:
            for index, row in enumerate(group):
                if row['pageIndex'] != index:
                    raise ValueError('Fixture companion pages are out of order')
                companions.append({'folder': folder, **{key: row[key] for key in
                                   ('path', 'width', 'height', 'sha256')}})
                sources.append(Source(directory / row['path'], row['width'], row['height'], row['sha256'], True))
    return original, companions, sources


def validate_sprite_catalog(source: str, sprites: list[dict]) -> None:
    """Accept the generator's literal sprite rows, never execute their wrapper."""
    match = re.search(r'export const SPRITES\b[^\n]*=\s*\[\n(.*?)\n\];', source, re.S)
    if match is None:
        raise ValueError('Generated sprite catalogue is missing')
    rows = []
    pattern = (r"\s*atlasSprite\(\{\s*name:\s*'([^']*)',\s*x:\s*(\d+),\s*y:\s*(\d+),"
               r'\s*w:\s*(\d+),\s*h:\s*(\d+)(?:,\s*pixel_density:\s*([\d.]+))?'
               r'(?:,\s*page:\s*(\d+))?\s*\}\),\s*')
    for line in match.group(1).splitlines():
        row = re.fullmatch(pattern, line)
        if row is None:
            raise ValueError('Generated sprite row has unsupported syntax')
        name, x, y, width, height, density, page = row.groups()
        record = {'name': name, 'x': int(x), 'y': int(y), 'w': int(width), 'h': int(height)}
        if density is not None:
            record['pixel_density'] = float(density)
        if page is not None:
            record['page'] = int(page)
        rows.append(record)
    if rows != sprites:
        raise ValueError('TypeScript and TOML sprite catalogues differ')


def coverage_inputs(root: Path):
    source = (root / 'web/src/render/atlas.ts').read_text(encoding='utf-8')
    # SPRITES wraps each row in atlasSprite(...); the matching TOML is the
    # generator's plain-data sprite catalogue, including pixel density.
    sprites = tomllib.loads((root / 'assets/sprites/atlas.toml').read_text(encoding='utf-8'))['sprite']
    validate_sprite_catalog(source, sprites)
    variants = json_initializer(source, 'RIGGED_SIM_VARIANTS')
    layouts = json_initializer(source, 'SURFACE_LAYOUTS')
    bodies = sorted({sprite for variant in variants.values() for clip in variant.values()
                     for facing in clip['frames'] for sprite in facing})
    dishes = sorted({sprite for layout in layouts.values() if layout['kind'] != 'stove'
                     for sprite in layout['props'][:4]})
    indicators = [index for index, sprite in enumerate(sprites)
                  if re.match(r'^(activity|conversation)', sprite['name'])]
    return sprites, bodies, dishes, indicators


def source_records(root: Path, sources: list[Source]) -> list[dict]:
    return [{'file': source.path.relative_to(root).as_posix(), 'width': source.width,
             'height': source.height, 'sha256': source.digest} for source in sources]


class CoverageBuilder:
    def __init__(self, inputs):
        self.sprites, self.bodies, self.dishes, self.indicators = inputs
        self.payload = bytearray(b'ACV1')
        self.spans: dict[bytes, tuple[int, int]] = {}
        self.records = {'bodies': [], 'dishes': [], 'indicators': []}
        self.by_page: dict[int, list[tuple[str, int]]] = {}
        for kind, indices in [('bodies', self.bodies), ('dishes', self.dishes), ('indicators', self.indicators)]:
            for index in indices:
                self.by_page.setdefault(self.sprites[index].get('page', 0), []).append((kind, index))

    def span(self, data: bytes, words: bool = False) -> list[int]:
        # Align every span so identical byte runs can serve either byte or word records.
        if data not in self.spans:
            self.payload.extend(bytes((-len(self.payload)) % 4))
            self.spans[data] = (len(self.payload), len(data))
            self.payload.extend(data)
        offset, length = self.spans[data]
        return [offset, length // 4 if words else length]

    def add_page(self, page_index: int, page: np.ndarray):
        for kind, index in self.by_page.get(page_index, []):
            sprite = self.sprites[index]
            x, y, w, h = (sprite[key] for key in ('x', 'y', 'w', 'h'))
            if min(x, y) < 0 or min(w, h) <= 0 or x + w > page.shape[1] or y + h > page.shape[0]:
                raise ValueError('Coverage rectangle exceeds original atlas page')
            alpha = page[y:y + h, x:x + w, 3]
            row = {'sprite': index}
            if kind == 'bodies':
                opaque, partial_pixels, partial_alpha = body_mask(alpha)
                row.update(opaque=self.span(opaque), partialPixels=self.span(partial_pixels, words=True),
                           partialAlpha=self.span(partial_alpha))
            elif kind == 'dishes':
                row['alpha'] = self.span(alpha.tobytes())
            else:
                row['bottomPixels'] = indicator_bottom(alpha, sprite.get('pixel_density', 1))
            self.records[kind].append(row)

    def finish(self):
        for kind, expected in [('bodies', self.bodies), ('dishes', self.dishes), ('indicators', self.indicators)]:
            self.records[kind].sort(key=lambda row: row['sprite'])
            if [row['sprite'] for row in self.records[kind]] != expected:
                raise ValueError(f'Missing CPU coverage records: {kind}')
        return bytes(self.payload), self.records


def write_binary(directory: Path, prefix: str, payload: bytes) -> dict:
    # Keep equivalent gzip streams produced by other zlib versions.
    for path in sorted(directory.glob(f'{prefix}-*.bin.gz')):
        encoded = path.read_bytes()
        if path.name == f'{prefix}-{sha256(encoded)}.bin.gz' and gzip.decompress(encoded) == payload:
            return {'file': f'atlas-storage/{path.name}', 'length': len(payload), 'sha256': sha256(payload)}
    encoded = gzip.compress(payload, mtime=0)
    name = f'{prefix}-{sha256(encoded)}.bin.gz'
    (directory / name).write_bytes(encoded)
    return {'file': f'atlas-storage/{name}', 'length': len(payload), 'sha256': sha256(payload)}


def physical_pages(store: TileStore):
    for start in range(0, store.count, SLOTS_PER_PAGE):
        page = np.zeros((PHYSICAL_SIZE, PHYSICAL_SIZE, 4), dtype=np.uint8)
        for slot in range(min(SLOTS_PER_PAGE, store.count - start)):
            y, x = divmod(slot, TILES_PER_ROW)
            page[y * CELL_SIZE:(y + 1) * CELL_SIZE, x * CELL_SIZE:(x + 1) * CELL_SIZE] = np.frombuffer(
                store.read(start + slot), dtype=np.uint8).reshape(CELL_SIZE, CELL_SIZE, 4)
        yield page


def budget(unique: int, virtual_layers: int) -> int:
    total = math.ceil(unique / SLOTS_PER_PAGE) * PHYSICAL_SIZE ** 2 * 4
    total += virtual_layers * (VIRTUAL_SIZE // TILE_SIZE) ** 2 * 4
    if total >= BUDGET:
        raise ValueError(f'Atlas storage exceeds its 384 MiB budget: {total} bytes')
    return total


def generate(root: Path) -> dict:
    original, companions, sources = source_catalog(root)
    coverage = CoverageBuilder(coverage_inputs(root))
    directory = root / OUTPUT
    directory.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='runtime-atlas-') as temporary:
        with TileStore(Path(temporary) / 'tiles') as store:
            lookups = []
            for layer, source in enumerate(sources):
                page = source.page()
                lookups.append(store.add_page(page))
                if layer < len(original):
                    coverage.add_page(layer, page)
                print(f'Packed virtual page {layer + 1}/{len(sources)}; {store.count} unique blocks', flush=True)
            storage_bytes = budget(store.count, len(sources))
            pages = []
            for index, page in enumerate(physical_pages(store)):
                encoded = io.BytesIO()
                Image.fromarray(page).save(encoded, format='PNG', compress_level=9)
                data = encoded.getvalue()
                digest = sha256(data)
                name = f'page-{digest}.png'
                path = directory / name
                if not path.exists() or path.read_bytes() != data:
                    path.write_bytes(data)
                pages.append({'file': f'atlas-storage/{name}', 'sha256': digest})
                print(f'Wrote physical page {index + 1}/{math.ceil(store.count / SLOTS_PER_PAGE)}', flush=True)
            lookup = write_binary(directory, 'lookup', b'ATL1' + b''.join(row.tobytes() for row in lookups))
            payload, records = coverage.finish()
            coverage_record = {**write_binary(directory, 'coverage', payload), **records}
            result = {'version': 1, 'virtualSize': VIRTUAL_SIZE, 'virtualLayers': len(sources),
                      'tileSize': TILE_SIZE, 'border': BORDER, 'physicalSize': PHYSICAL_SIZE,
                      'tilesPerRow': TILES_PER_ROW, 'uniqueTiles': store.count,
                      'originalAtlasPages': original, 'companions': companions,
                      'sources': source_records(root, sources),
                      'pages': pages, 'lookup': lookup, 'coverage': coverage_record}
    text = '// Generated by scripts/build-runtime-atlas.py. Do not edit.\nexport const ATLAS_STORAGE = '
    text += json.dumps(result, indent=2) + ' as const;\n'
    (root / METADATA).write_text(text, encoding='utf-8', newline='\n')
    wanted = {Path(row['file']).name for row in pages + [lookup, coverage_record]}
    for path in directory.iterdir():
        if path.name not in wanted and re.fullmatch(r'(page|lookup|coverage)-[0-9a-f]{64}\.(png|bin\.gz)', path.name):
            path.unlink()
    print(f'Artwork storage: {storage_bytes} bytes ({storage_bytes / 1024 ** 2:.2f} MiB)', flush=True)
    return result


def read_metadata(root: Path) -> dict:
    source = (root / METADATA).read_text(encoding='utf-8')
    prefix = 'export const ATLAS_STORAGE = '
    value, end = json.JSONDecoder().raw_decode(source, source.index(prefix) + len(prefix))
    if source[end:].strip() != 'as const;':
        raise ValueError('Generated storage metadata has unexpected code')
    return value


def read_binary(root: Path, record: dict, header: bytes) -> bytes:
    if not re.fullmatch(r'atlas-storage/(lookup|coverage)-[0-9a-f]{64}\.bin\.gz', record['file']):
        raise ValueError('Binary artifact filename is invalid')
    encoded = (root / 'web/public' / record['file']).read_bytes()
    if sha256(encoded) not in record['file']:
        raise ValueError('Binary artifact filename does not match its encoded checksum')
    payload = gzip.decompress(encoded)
    if (len(payload) != record['length'] or sha256(payload) != record['sha256']
            or not payload.startswith(header)):
        raise ValueError('Binary artifact header, length, or checksum differs')
    return payload


def check(root: Path) -> dict:
    """Read committed artifacts and prove all source pixels, borders and CPU data."""
    result = read_metadata(root)
    original, companions, sources = source_catalog(root)
    constants = {'version': 1, 'virtualSize': VIRTUAL_SIZE, 'virtualLayers': len(sources),
                 'tileSize': TILE_SIZE, 'border': BORDER, 'physicalSize': PHYSICAL_SIZE,
                 'tilesPerRow': TILES_PER_ROW, 'originalAtlasPages': original, 'companions': companions,
                 'sources': source_records(root, sources)}
    if any(result[key] != value for key, value in constants.items()):
        raise ValueError('Storage layout or source manifest differs')
    unique = result['uniqueTiles']
    if not isinstance(unique, int) or unique <= 0 or len(result['pages']) != math.ceil(unique / SLOTS_PER_PAGE):
        raise ValueError('Unique block count or physical page count is invalid')
    storage_bytes = budget(unique, len(sources))
    payload = read_binary(root, result['lookup'], b'ATL1')
    expected_entries = len(sources) * (VIRTUAL_SIZE // TILE_SIZE) ** 2
    if len(payload) != 4 + expected_entries * 4:
        raise ValueError('Lookup payload length differs from virtual layout')
    lookup = np.frombuffer(payload, dtype='<u4', offset=4)
    if np.any(lookup > unique):
        raise ValueError('Lookup points outside physical storage')
    if len(np.unique(lookup[lookup != 0])) != unique:
        raise ValueError('Physical storage includes unreferenced blocks')
    coverage_payload = read_binary(root, result['coverage'], b'ACV1')
    coverage = CoverageBuilder(coverage_inputs(root))
    with tempfile.TemporaryDirectory(prefix='runtime-atlas-check-') as temporary:
        backing = Path(temporary) / 'physical-blocks'
        with backing.open('w+b') as blocks:
            for page_index, row in enumerate(result['pages']):
                if not re.fullmatch(r'atlas-storage/page-[0-9a-f]{64}\.png', row['file']):
                    raise ValueError('Physical page filename is invalid')
                data = (root / 'web/public' / row['file']).read_bytes()
                if sha256(data) != row['sha256'] or row['sha256'] not in row['file']:
                    raise ValueError('Physical page checksum differs')
                with Image.open(io.BytesIO(data)) as image:
                    if image.mode != 'RGBA' or image.size != (PHYSICAL_SIZE, PHYSICAL_SIZE):
                        raise ValueError('Physical page dimensions or format differ')
                    pixels = np.asarray(image)
                used = min(SLOTS_PER_PAGE, unique - page_index * SLOTS_PER_PAGE)
                for slot in range(SLOTS_PER_PAGE):
                    y, x = divmod(slot, TILES_PER_ROW)
                    cell = pixels[y * CELL_SIZE:(y + 1) * CELL_SIZE, x * CELL_SIZE:(x + 1) * CELL_SIZE]
                    if slot < used:
                        blocks.write(cell.tobytes())
                    elif np.any(cell):
                        raise ValueError('Unused physical block is nonzero')
                edge = TILES_PER_ROW * CELL_SIZE
                if np.any(pixels[edge:]) or np.any(pixels[:, edge:]):
                    raise ValueError('Unused physical page margin is nonzero')
            blocks.flush()
            with mmap.mmap(blocks.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
                block_bytes = CELL_SIZE ** 2 * 4
                def read_block(index):
                    return mapped[index * block_bytes:(index + 1) * block_bytes]
                count = (VIRTUAL_SIZE // TILE_SIZE) ** 2
                for layer, source in enumerate(sources):
                    page = source.page()
                    verify_page(page, lookup[layer * count:(layer + 1) * count], read_block, unique)
                    if layer < len(original):
                        coverage.add_page(layer, page)
                        verify_cpu_page(coverage_payload, result['coverage'], coverage.sprites, layer, page)
                    print(f'Verified virtual page {layer + 1}/{len(sources)}, including halos', flush=True)
    expected_payload, records = coverage.finish()
    if expected_payload != coverage_payload or any(result['coverage'][key] != value for key, value in records.items()):
        raise ValueError('CPU coverage differs from source alpha')
    wanted = {Path(row['file']).name for row in result['pages'] + [result['lookup'], result['coverage']]}
    actual = {path.name for path in (root / OUTPUT).iterdir()}
    if actual != wanted:
        raise ValueError('Storage artifact directory has missing or obsolete files')
    print(f'Exact pixels, halos and CPU coverage verified; {storage_bytes} graphics bytes', flush=True)
    return result
