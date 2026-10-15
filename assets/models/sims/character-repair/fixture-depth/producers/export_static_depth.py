"""Export physical depth companions for published fixtures and surface props."""
from pathlib import Path
import json
import math
import sys
import tomllib
import traceback

import bpy
import numpy as np

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
MODELS = ROOT / 'assets/models'
OUT = BASE / 'fixture-depth'
sys.path.insert(0, str(BASE))
from depth_geometry import Pages, digest, sample

FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def main():
    OUT.mkdir(exist_ok=True)
    atlas_path = ROOT / 'assets/sprites/atlas.toml'
    atlas = tomllib.loads(atlas_path.read_text())
    rows = {row['name']: (index, row) for index, row in enumerate(atlas['sprite'])}
    report = dict(version=1, state='running', encoding='rg-u16-unorm-x-minus-y-range-minus2-plus2',
                  atlasSha256=digest(atlas_path), producerHashes={path.name:digest(path) for path in (Path(__file__), BASE/'depth_geometry.py')},
                  sprites=[], sources={}, coverageSources={})
    pages = Pages(OUT, 'depth')

    def save():
        (OUT/'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    def coverage(sprite):
        page = atlas['pages'][sprite.get('page', 0)]
        image_path = ROOT/'web/public'/page
        if not image_path.exists():
            image_path = ROOT/'assets/sprites'/page
        report['coverageSources'][image_path.relative_to(ROOT).as_posix()] = digest(image_path)
        image = bpy.data.images.load(str(image_path), check_existing=False)
        pixels = np.empty(image.size[0]*image.size[1]*4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        alpha = np.flipud(pixels.reshape((image.size[1], image.size[0], 4)))[sprite['y']:sprite['y']+sprite['h'], sprite['x']:sprite['x']+sprite['w'], 3].copy()
        bpy.data.images.remove(image)
        return alpha

    def export(prefix, root, source, *, canvas=None, crop=(0, 0)):
        report['sources'][prefix] = dict(path=source.relative_to(ROOT).as_posix(), sha256=digest(source))
        for facing, degrees in FACINGS.items():
            name = prefix + ('' if facing == 'SE' else facing)
            index, sprite = rows[name]
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            alpha = coverage(sprite)
            # Published colors use Lanczos3 reduction. Its nonzero filter skirt
            # extends beyond the source silhouette by up to three output texels.
            rgba, proof, _, _ = sample(root.children_recursive, sprite['w'], sprite['h'], alpha > 0,
                                       canvas=canvas, crop=crop, max_edge_distance=3 + math.sqrt(.5))
            proof['coveredPixels'] = proof['opaquePixels']
            proof['opaquePixels'] = int((alpha >= .5).sum())
            proof['coverageRule'] = 'published-alpha-greater-than-zero'
            proof['filterSupportPixels'] = 3
            report['sprites'].append(dict(name=name, atlasIndex=index, sprite=index, pixelDensity=sprite.get('pixel_density', 1), facing=facing,
                                          source=prefix, **pages.add(rgba), **proof))
            save()
            print(name, 'depth complete', flush=True)

    try:
        entries = []
        for name in ['static-props.json', 'static-props-02.json', 'static-props-03.json', 'static-props-04.json']:
            entries.extend(json.loads((MODELS/name).read_text())['objects'])
        entries.extend([
            dict(name='offlineArmchair', directory='living/owner-review-pending/armchair/candidate-03'),
            dict(name='offlineBunk', directory='bedroom/owner-review-pending/bunk/candidate-03'),
        ])
        for entry in entries:
            directory = MODELS/entry['directory']
            proof = json.loads((directory/'proof.json').read_text())
            sources = list(directory.glob('*.blend'))
            if len(sources) != 1:
                raise ValueError(f'Expected exactly one authored model in {directory}')
            source = sources[0]
            if digest(source) != proof['model_sha256']:
                raise ValueError(f'Authored model differs from published receipt: {source}')
            bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
            root = next(obj for obj in bpy.data.objects if obj.type == 'EMPTY' and obj.name.endswith('_MODEL_ROOT'))
            for obj in root.children_recursive:
                obj.hide_render = False
            if entry['name'] == 'offlineBunk':
                export(entry['name'], root, source, canvas=(320, 352), crop=(60, 40))
            else:
                export(entry['name'], root, source)
        sys.path[:0] = [str(MODELS/'furniture'), str(MODELS/'sims/sim-01')]
        from animation_export import scene_for
        from build_parts import set_crank_phase
        for kind in ('bike', 'chair'):
            _, _, root, movable, _, _ = scene_for(kind)
            if kind == 'bike':
                set_crank_phase(movable, 0)
            export('offline'+kind.title(), root, MODELS/'sims/sim-01/sim-01-rigged.blend')
        for filename, prefixes in [('dishes.blend', ['dirtyDishes', 'dirtyDishesPair', 'dirtyPrep', 'dirtyPrepLarge', 'mealPlate']), ('pot.blend', ['cookingPot'])]:
            source = MODELS/'domestic'/filename
            bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
            for prefix in prefixes:
                root = bpy.data.objects[prefix]
                for obj in root.children_recursive:
                    obj.hide_render = False
                export(prefix, root, source)
        report['pages'] = pages.save()
        for source in report['sources'].values():
            if digest(ROOT/source['path']) != source['sha256']:
                raise ValueError('An authored source changed during depth export')
        report['state'] = 'complete'
        save()
    except Exception:
        report['state'] = 'failed'
        report['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    main()
