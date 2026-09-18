"""Load reviewed static model renders for append-only atlas integration."""
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re

from PIL import Image
from style import TILE_HALF_HEIGHT

FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}


def inside(root, relative):
    if not isinstance(relative,str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('path must stay inside its source directory')
    parts = PurePosixPath(relative)
    path = (root/relative).resolve()
    if parts.is_absolute() or '..' in parts.parts or not path.is_relative_to(root):
        raise ValueError('path must stay inside its source directory')
    return path


def registered_anchor(proof):
    origin = proof.get('origin_pixels')
    canvas = proof.get('logical_canvas')
    if (canvas not in ([96,120],[160,176])
            or any(type(value) is not int for value in canvas)):
        raise ValueError('prop camera registration changed')
    expected_origin = (canvas[0]*4,canvas[1]*4+280.0035)
    if (proof.get('source_density') != 8
            or not isinstance(origin,list) or len(origin) != 2
            or any(type(value) not in (int,float) or not math.isfinite(value)
                   or abs(value-expected) > .01
                   for value,expected in zip(origin,expected_origin))):
        raise ValueError('prop camera registration changed')
    # The shader adds the south-corner tile offset before subtracting this
    # anchor. Keep world origin on the tile centre, not 21 pixels below it.
    return [origin[0]/8,origin[1]/8+TILE_HALF_HEIGHT]


def load_props(catalog_path, *, existing_names=()):
    path = Path(catalog_path).resolve()
    catalog = json.loads(path.read_text(encoding='utf-8'))
    if type(catalog.get('version')) is not int or catalog['version'] != 1:
        raise ValueError('unsupported static prop catalog version')
    if not isinstance(catalog.get('objects'),list) or not catalog['objects']:
        raise ValueError('static prop catalog is empty')
    sprites, anchors, densities, content_bounds = [], {}, {}, {}
    names = set(existing_names)
    for entry in catalog['objects']:
        if entry.get('review_status') not in ('accepted-independent-review','owner-approved'):
            raise ValueError('prop needs recorded visual review')
        prefix = entry.get('name')
        if not isinstance(prefix,str) or not re.fullmatch(r'offline[A-Z][A-Za-z0-9]*',prefix):
            raise ValueError('invalid prop sprite prefix')
        directory = inside(path.parent,entry.get('directory'))
        proof = json.loads((directory/'proof.json').read_text(encoding='utf-8'))
        reviewed_digest = hashlib.sha256(
            json.dumps(proof,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        if reviewed_digest != entry.get('proof_sha256'):
            raise ValueError('reviewed proof changed; repeat visual review before accepting it')
        if proof.get('state') != 'complete':
            raise ValueError('prop batch must be complete')
        anchor = registered_anchor(proof)
        width,height = proof['logical_canvas']
        source_size = (width*8,height*8)
        texture_size = (width*2,height*2)
        rows = proof.get('renders',[])
        if len(rows) != 4 or {row.get('facing') for row in rows} != set(FACINGS):
            raise ValueError('prop needs four distinct facings')
        by_facing = {row['facing']:row for row in rows}
        for facing,degrees in FACINGS.items():
            row = by_facing[facing]
            if row.get('degrees') != degrees:
                raise ValueError('prop rotation does not match its facing')
            name = prefix + ('' if facing == 'SE' else facing)
            if name in names:
                raise ValueError(f'duplicate prop sprite name: {name}')
            names.add(name)
            source = inside(directory,row.get('path'))
            if hashlib.sha256(source.read_bytes()).hexdigest() != row.get('sha256'):
                raise ValueError(f'{name}: source hash mismatch')
            with Image.open(source) as image:
                if image.format != 'PNG' or image.mode != 'RGBA' or image.size != source_size:
                    raise ValueError(f'{name}: expected {source_size[0]}x{source_size[1]} RGBA PNG')
                bounds = image.getchannel('A').getbbox()
                if not bounds:
                    raise ValueError(f'{name}: empty source')
                if (bounds[0]<8 or bounds[1]<8 or bounds[2]>source_size[0]-8
                        or bounds[3]>source_size[1]-8):
                    raise ValueError(f'{name}: clipped source')
                sprite = image.resize(texture_size,Image.Resampling.LANCZOS)
            sprites.append((name,sprite,*texture_size))
            anchors[name] = list(anchor)
            densities[name] = 2
            content_bounds[name] = [value/2 for value in sprite.getchannel('A').getbbox()]
    return sprites, anchors, densities, content_bounds
