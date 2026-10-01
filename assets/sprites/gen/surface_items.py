"""Model-registered dishes and authored furniture support points."""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image
from objects import table_surface

FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def load_dishes(root):
    root = Path(root) / 'assets/models/domestic'
    proof = json.loads((root / 'export/proof.json').read_text())
    if proof['state'] != 'complete' or len(proof['renders']) != 20:
        raise ValueError('Dish renders are incomplete')
    if hashlib.sha256((root / 'dishes.blend').read_bytes()).hexdigest() != proof['model_sha256']:
        raise ValueError('Dish model changed since export')
    for name, digest in proof['inputs'].items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Dish source changed since export: {name}')
    sprites = []
    for row in proof['renders']:
        path = root / 'export' / row['path']
        if hashlib.sha256(path.read_bytes()).hexdigest() != row['sha256']:
            raise ValueError(f'Dish render changed: {path}')
        image = Image.open(path).convert('RGBA').resize((48, 48), Image.Resampling.LANCZOS)
        sprites.append((row['name'], image, 48, 48))
    return sprites, proof['anchor']


def project_model(point, proof):
    """Project a model-space displacement through the furniture's own camera."""
    matrix = proof['camera_matrix']
    density = proof['logical_canvas'][1] / proof['ortho_scale']
    return [round(sum(matrix[i][0] * point[i] for i in range(3)) * density, 6),
            round(-sum(matrix[i][1] * point[i] for i in range(3)) * density, 6)]


def layouts(root, sprites):
    indices = {sprite[0]: i for i, sprite in enumerate(sprites)}
    counter = json.loads((Path(root) / 'assets/models/kitchen/owner-review-pending/counter/candidate-01/proof.json').read_text())
    result = {}
    for facing, degrees in FACINGS.items():
        suffix = '' if facing == 'SE' else facing
        props = [indices[name + suffix] for name in
                 ('dirtyDishes', 'dirtyDishesPair', 'dirtyPrep', 'dirtyPrepLarge', 'mealPlate')]
        angle = math.radians(degrees)
        points = []
        for x, y in ((-.22, -.22), (.22, -.22), (-.22, .22), (.22, .22)):
            points.append(project_model((x * math.cos(angle) - y * math.sin(angle),
                                         x * math.sin(angle) + y * math.cos(angle),
                                         counter['model_checks']['worktop_height']), counter))
        result[indices['offlineCounter' + suffix]] = dict(kind='counter', points=points, props=props)
        x0, y0, x1, y1, height = table_surface(facing.lower())
        points = []
        for x, y in ((x0 + .30, y0 + .24), (x1 - .30, y1 - .24),
                     (x0 + .30, y1 - .24), (x1 - .30, y0 + .24)) if facing in ('SE', 'NW') else (
                         (x0 + .24, y0 + .30), (x1 - .24, y1 - .30),
                         (x1 - .24, y0 + .30), (x0 + .24, y1 - .30)):
            # Legacy emit includes the inclusive bottom raster row in its canvas.
            points.append([round((x-y)*32, 6), round((x+y)*21-height*38-1, 6)])
        result[indices['table' + suffix]] = dict(kind='table', points=points, props=props)
    return result
