"""Model-registered dishes and authored furniture support points."""
import hashlib
import importlib.util
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


def dining_table_places(root):
    """Read the supporting top from the same geometry used to build the table."""
    path = Path(root) / 'assets/models/dining/table_layout.py'
    spec = importlib.util.spec_from_file_location('domestic_table_layout', path)
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    top = next(part for part in model.parts() if part['name'] == 'Tabletop')
    x, y, z = top['center']
    width, depth, height = top['size']
    return [(x + side * (width/2-.22), y + end * (depth/2-.38), z+height/2)
            for side, end in ((-1,-1),(1,1),(-1,1),(1,-1))]


def layouts(root, sprites):
    indices = {sprite[0]: i for i, sprite in enumerate(sprites)}
    counter = json.loads((Path(root) / 'assets/models/kitchen/owner-review-pending/counter/candidate-01/proof.json').read_text())
    table = json.loads((Path(root) / 'assets/models/dining/owner-review-pending/dining-table/candidate-01/proof.json').read_text())
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
        points = [project_model((x*math.cos(angle)-y*math.sin(angle),
                                 x*math.sin(angle)+y*math.cos(angle), z), table)
                  for x,y,z in dining_table_places(root)]
        result[indices['offlineDiningTable' + suffix]] = dict(kind='table', points=points, props=props)
    return result


def load_pot(root):
    base=Path(root)/'assets/models/domestic'
    proof=json.loads((base/'export/pot/proof.json').read_text())
    if proof['state']!='complete' or len(proof['renders'])!=4:
        raise ValueError('Cooking pot bake is incomplete')
    if hashlib.sha256((base/'pot.blend').read_bytes()).hexdigest()!=proof['model_sha256']:
        raise ValueError('Cooking pot model changed since its bake')
    for name,digest in proof['inputs'].items():
        if hashlib.sha256((base/name).read_bytes()).hexdigest()!=digest:
            raise ValueError(f'Cooking pot source changed: {name}')
    sprites=[]
    for row in proof['renders']:
        path=base/'export/pot'/row['path']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=row['sha256']:
            raise ValueError(f'Cooking pot frame changed: {path}')
        image=Image.open(path).convert('RGBA').resize((48,48),Image.Resampling.LANCZOS)
        sprites.append((row['name'],image,48,48))
    return sprites,proof['anchor']


def stove_layouts(root,sprites):
    indices={s[0]:i for i,s in enumerate(sprites)}
    proof=json.loads((Path(root)/'assets/models/kitchen/owner-review-pending/stove/candidate-01/proof.json').read_text())
    result={}
    contact=json.loads((Path(root)/'assets/models/domestic/cooking-contact.json').read_text())
    x,y,z=contact['pot_center_sim']
    y+=contact['body_distance']
    points=[]
    for facing in ('SE','NW','SW','NE'):
        angle=math.radians(FACINGS[facing])
        points.append(project_model((x*math.cos(angle)-y*math.sin(angle),x*math.sin(angle)+y*math.cos(angle),z),proof))
    for facing in FACINGS:
        suffix='' if facing=='SE' else facing
        result[indices['offlineStove'+suffix]]=dict(kind='stove',points=points,props=[indices['cookingPot'+f] for f in ('','NW','SW','NE')])
    return result
