"""Append occupied dining layers while retaining every published empty chair."""
import hashlib
import base64
import json
from pathlib import Path
from dataclasses import dataclass

from PIL import Image, ImageChops

from offline_furniture import FurnitureExport
from offline_props import inside

FACINGS = ('SE', 'SW', 'NW', 'NE')
VARIANTS = ('green', 'blue', 'red')


@dataclass
class DiningExport(FurnitureExport):
    meal_sprites: list
    meal_anchors: dict
    meal_for_body: dict


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_dining(manifest_path, *, existing_names):
    path = Path(manifest_path).resolve()
    data = json.loads(path.read_text())
    assert (data['version'], data['width'], data['height'], data['pixel_density']) == (2, 80, 112, 2)
    assert max(abs(a - b) for a, b in zip(data['anchor'], (40, 112.0004388))) < .002
    models = path.parents[3]
    raw_proof = models / 'domestic/seated-dining/proof.json'
    proof = json.loads(raw_proof.read_text())
    assert proof['state'] == 'complete' and digest(raw_proof) == data['source_proof_sha256']
    assert digest(models / 'domestic/seated-dining.blend') == proof['model_sha256']
    for name, sha in proof['inputs'].items():
        assert digest(models / name) == sha, f'Dining producer changed: {name}'
    assert digest(models / 'domestic/export_seated_dining.py') == data['encoder_sha256']
    meal_proof_path = models / 'domestic/seated-meal/proof.json'
    meal_proof = json.loads(meal_proof_path.read_text())
    assert meal_proof['state'] == 'complete' and digest(meal_proof_path) == data['meal_proof_sha256']
    for name, sha in meal_proof['inputs'].items():
        assert digest(models / 'domestic' / name) == sha, f'Meal producer changed: {name}'
    assert len(proof['contact_samples']) == 96 and len(data['comparisons']) == 96
    rows = {(row['facing'], row['variant'], row['frame']): row for row in data['frames']}
    expected = [(f, v, i) for f in FACINGS for v in VARIANTS for i in range(8)]
    assert len(rows) == len(data['frames']) and set(rows) == set(expected)
    names = set(existing_names)
    sprites, pairs, profiles, bounds, shared, cache = [], {}, {}, {}, {}, {}
    meals, meal_anchors, meal_for_body, shared_meals = [], {}, {}, {}
    def read(ref):
        source = inside(path.parent, ref['path'])
        sha = digest(source)
        assert sha == ref['sha256'], 'Dining layer hash changed'
        if sha not in cache:
            with Image.open(source) as image:
                assert image.mode == 'RGBA' and image.size == (160, 224)
                image.load()
                cache[sha] = image.copy()
            alpha = cache[sha].getchannel('A')
            assert all(not ImageChops.subtract(cache[sha].getchannel(c), alpha).getbbox() for c in ('R', 'G', 'B'))
        return cache[sha], sha
    def add(name, image):
        assert name not in names, f'Duplicate dining sprite: {name}'
        names.add(name)
        sprites.append((name, image, 160, 224))
        return name
    palette_evidence = {}
    for facing in FACINGS:
        name = 'offlineDiningChair' + ('' if facing == 'SE' else facing)
        assert name in names, 'Published dining chair missing'
        profiles[name] = dict(action=13, halfCycleTicks=16, frames={v: [] for v in VARIANTS})
    for facing, variant, index in expected:
        row = rows[facing, variant, index]
        body, sha = read(row['body'])
        name = add(f'occupiedDining{facing}{variant.title()}{index}', body)
        alpha = body.getchannel('A')
        ownership = dict(body=sha, alpha=alpha.tobytes())
        layers = {}
        for role in ('furniture', 'outline'):
            image, layer_sha = read(row[role])
            key = (role, layer_sha)
            if key not in shared:
                shared[key] = add(f'occupiedDining{role.title()}{len(shared)}', image)
            layers[role] = shared[key]
            ownership[role] = layer_sha
            alpha = ImageChops.lighter(alpha, image.getchannel('A'))
        box = alpha.getbbox()
        assert box
        bounds[name] = [v / 2 for v in box]
        pairs[name] = layers
        ref = row['meal']
        meal_path = inside(path.parent, ref['path'])
        meal_sha = digest(meal_path)
        assert meal_sha == ref['sha256'], 'Supported meal hash changed'
        anchor = row['meal_anchor']
        assert len(anchor) == 2 and all(isinstance(v, (int, float)) for v in anchor)
        key = (meal_sha, tuple(anchor))
        if key not in shared_meals:
            meal_name = f'occupiedDiningMeal{len(shared_meals)}'
            assert meal_name not in names
            names.add(meal_name)
            with Image.open(meal_path) as image:
                assert image.mode == 'RGBA' and 0 < image.width < 160 and 0 < image.height < 224
                assert image.getchannel('A').getbbox() == (0, 0, image.width, image.height)
                meals.append((meal_name, image.copy(), image.width, image.height))
            shared_meals[key] = meal_name
            meal_anchors[meal_name] = anchor
        meal_for_body[name] = shared_meals[key]
        ownership['meal'] = key
        palette_evidence.setdefault((facing, index), []).append(ownership)
        empty_name = 'offlineDiningChair' + ('' if facing == 'SE' else facing)
        profiles[empty_name]['frames'][variant].append(name)
    for rows in palette_evidence.values():
        assert len({row['body'] for row in rows}) == 3
        assert all(len({row[key] for row in rows}) == 1 for key in ('alpha', 'furniture', 'outline', 'meal'))
    return DiningExport(sprites, data['anchor'], pairs, profiles, bounds, meals, meal_anchors, meal_for_body)


def coverage_tables(export, sprites):
    """Keep body and wood ownership separate while sampling the displayed pair."""
    indices = {name: i for i, (name, *_) in enumerate(sprites)}
    images = {name: image for name, image, *_ in export.sprites}
    masks, shared, catalog = [], {}, {}
    def mask(alpha):
        box = alpha.getbbox()
        assert box, 'Dining owner has no visible coverage'
        values = alpha.crop(box).tobytes()
        key = (box, values)
        if key not in shared:
            shared[key] = len(masks)
            masks.append(dict(size=list(alpha.size), box=list(box),
                              values=base64.b64encode(values).decode('ascii')))
        return shared[key]
    for name, pair in export.pairs.items():
        body = images[name].getchannel('A')
        wood = images[pair['furniture']].getchannel('A')
        ink = images[pair['outline']].getchannel('A')
        body_ink = Image.new('L', ink.size)
        b, w, outline, owned = body.load(), wood.load(), ink.load(), body_ink.load()
        for y in range(ink.height):
            for x in range(ink.width):
                if not outline[x, y]:
                    continue
                scores = [b[x, y], w[x, y]]
                if not sum(scores):
                    for radius in range(1, 4):
                        for dy in range(-radius, radius + 1):
                            for dx in range(-radius, radius + 1):
                                if not dx and not dy:
                                    continue
                                px, py = x + dx, y + dy
                                if 0 <= px < ink.width and 0 <= py < ink.height:
                                    distance = dx * dx + dy * dy
                                    scores[0] = max(scores[0], b[px, py] / distance)
                                    scores[1] = max(scores[1], w[px, py] / distance)
                        if sum(scores):
                            break
                assert sum(scores), 'Dining outline has no nearby visible owner'
                if scores[0] >= scores[1]:
                    owned[x, y] = outline[x, y]
        catalog[indices[name]] = [mask(body), mask(wood), mask(ink), mask(body_ink)]
    return catalog, masks


def meal_tables(export, sprites, masks):
    """Associate each fitted body with its separately supported, visible meal."""
    indices = {name: i for i, (name, *_) in enumerate(sprites)}
    coverage = {}
    for name, image, *_ in export.meal_sprites:
        alpha = image.getchannel('A')
        box = alpha.getbbox()
        coverage[name] = len(masks)
        masks.append(dict(size=list(alpha.size), box=list(box),
                          values=base64.b64encode(alpha.crop(box).tobytes()).decode('ascii')))
    return {indices[body]: dict(sprite=indices[meal], coverage=coverage[meal],
                               offset=[export.anchor[i] - export.meal_anchors[meal][i] for i in (0, 1)])
            for body, meal in export.meal_for_body.items()}
