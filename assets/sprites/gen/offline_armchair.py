"""Append reviewed armchair Sit contributions with the published registration."""
import json

from PIL import Image
from armchair_receipt import load_receipt
from offline_props import inside
from offline_seating import digest, load_seating


def load_armchair(manifest_path, *, existing_names=()):
    return load_seating(manifest_path, prefix='offlineArmchair', half_cycle_ticks=24,
                        reuse_empty=False, existing_names=existing_names)


def load_reviewed_armchair(catalog_path, *, existing_names=()):
    paths = load_receipt(catalog_path)
    return load_armchair(paths['manifest'], existing_names=existing_names)


def verify_armchair_generation(catalog_path):
    """Full local acceptance reads originals; clean atlas builds use their receipt."""
    paths = load_receipt(catalog_path)
    result = load_armchair(paths['manifest'])
    raw = json.loads(paths['raw_proof'].read_text())
    for row in raw['renders']:
        path = inside(paths['raw_proof'].parent, row['path'])
        if digest(path) != row['sha256']:
            raise ValueError('Armchair original image changed')
        with Image.open(path) as image:
            if image.format != 'PNG' or image.mode != 'RGBA' or image.size != (768, 960):
                raise ValueError('Expected armchair original RGBA PNG at 768x960')
            image.load()
    return result
