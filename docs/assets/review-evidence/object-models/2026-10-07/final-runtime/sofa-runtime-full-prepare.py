"""Prepare independent beauty and explicitly derived owner-source GPU references."""
import base64
import hashlib
import itertools
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image

FACINGS = ('SE', 'NW', 'SW', 'NE')
PALETTES = ('green', 'blue', 'red')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(index_path, output):
    index_path, output = Path(index_path).resolve(), Path(output).resolve()
    directory = index_path.parent
    index = json.loads(index_path.read_text())
    manifest_path = directory / 'manifest.json'
    if digest(manifest_path) != index['manifestSHA256']:
        raise ValueError('Reference index is not bound to its export manifest')
    manifest = json.loads(manifest_path.read_text())
    if manifest['phases'].get('sourceAliases') != [0, 0, 0, 0]:
        raise ValueError('This finite witness requires the approved four static phase aliases')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'references').mkdir()
    sources, inputs, cases = {}, {str(index_path): digest(index_path), str(manifest_path): digest(manifest_path)}, []

    def read(ref):
        path = (directory / ref['path']).resolve()
        if not path.is_relative_to(directory) or digest(path) != ref['sha256']:
            raise ValueError('Reference source path or hash differs: ' + str(path))
        inputs[str(path)] = ref['sha256']
        with Image.open(path) as source:
            if source.mode != 'RGBA' or source.size != (ref['width'], ref['height']):
                raise ValueError('Reference source dimensions or mode differ')
            image = np.asarray(source).copy()
        if hashlib.sha256(image.tobytes()).hexdigest() != ref['pixelsSha256']:
            raise ValueError('Reference source decoded pixels differ')
        return image

    expected = set(itertools.product(range(27), FACINGS, PALETTES))
    for row in index['records']:
        key = row['sceneKey'], row['facing'], row['palette']
        if row['kind'] != 'actualUniform' or key not in expected or key in sources:
            raise ValueError('Unexpected, duplicate, or non-actual uniform reference')
        if (row['canvas'] != [160, 176] or row['sourceDensity'] != 8
                or row['sourceFrame'] != row['sceneKey'] * 4
                or len(row['layers']) != 5 or len(row['owners']) != 3):
            raise ValueError('Uniform reference registration or source identity differs')
        sources[key] = row
    if set(sources) != expected:
        raise ValueError(f'Require all 324 uniform source references; found {len(sources)}')

    def dense(ref, shape):
        image = read(ref).astype(np.float32) / 255
        x, y, right, bottom = ref['rawCrop']
        if (any(type(v) is not int for v in ref['rawCrop'])
                or not 0 <= x < right <= shape[1] or not 0 <= y < bottom <= shape[0]
                or (bottom - y, right - x) != image.shape[:2]):
            raise ValueError('Reference crop registration differs')
        result = np.zeros((*shape, 4), np.float32)
        result[y:bottom, x:right] = image
        return result

    def raw_linear(row):
        raw = read(row['sourceBeauty']).astype(np.float32) / 255
        if raw.shape != (1408, 1280, 4):
            raise ValueError('Raw beauty does not match its eight-times canvas')
        rgb = raw[:, :, :3]
        raw[:, :, :3] = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4) * raw[:, :, 3:4]
        return raw.reshape(352, 4, 320, 4, 4).mean(axis=(1, 3))

    def save_case(scene, facing, palettes, kind, rgba, alpha, owners, anchor, bindings,
                  reference_encoding='scene-linear-premultiplied'):
        key = f'{kind}-{scene:02d}-{facing}-' + ''.join(map(str, palettes))
        rgba.astype('<f2').tofile(output / 'references' / (key + '.rgba.bin'))
        alpha.astype('<f2').tofile(output / 'references' / (key + '.alpha.bin'))
        occupied = [scene // (3 ** place) % 3 != 0 for place in range(3)]
        picks = []
        for place in [p for p in range(3) if occupied[p]] + [-1]:
            valid = alpha >= .99
            for other in range(3):
                valid &= owners[other] >= .99 if other == place else owners[other] <= .001
            ys, xs = np.nonzero(valid)
            if not len(xs):
                raise ValueError(f'No independent visible picking witness: {key}, owner {place}')
            chosen = np.linspace(0, len(xs) - 1, min(8, len(xs)), dtype=int)
            picks.append(dict(place=place, points=[[int(xs[i]), int(ys[i])] for i in chosen]))
        cases.append(dict(key=key, sceneKey=scene, facing=facing, palettes=palettes, kind=kind,
                          canvas=[160, 176], anchor=anchor, picks=picks, ownerSources=bindings,
                          referenceRGBA=key + '.rgba.bin', referenceAlpha=key + '.alpha.bin',
                          referenceEncoding=reference_encoding))

    # Process one scene/facing at a time to keep raw-raster memory bounded.
    for scene, facing in itertools.product(range(27), FACINGS):
        actual, layers, ownership = [], [], []
        for palette_index, palette in enumerate(PALETTES):
            row = sources[scene, facing, palette]
            actual.append(raw_linear(row))
            layers.append([dense(ref, (352, 320)) for ref in row['layers']])
            owner_alpha = []
            for place, owner in enumerate(row['owners']):
                action = scene // (3 ** place) % 3
                if (owner is None) != (action == 0):
                    raise ValueError('Source owner does not match occupied seat')
                if owner is not None and owner['stableSeatId'] != f'seat_{place + 1}':
                    raise ValueError('Source owner stable seat differs')
                owner_alpha.append(np.zeros((352, 320), np.float32) if owner is None
                                   else dense(owner['coverage'], (352, 320))[:, :, 3])
            ownership.append(owner_alpha)
            # Empty furniture uses the ordinary sprite path: legacy sRGB Lanczos
            # reduction and straight-sRGB GPU filtering, not occupied linear BOX.
            reference = (np.asarray(Image.fromarray(read(row['sourceBeauty'])).resize(
                (320, 352), Image.Resampling.LANCZOS)).astype(np.float32) / 255 if scene == 0 else actual[-1])
            save_case(scene, facing, [palette_index] * 3, 'actualUniform', reference, reference[:, :, 3],
                      owner_alpha, row['anchor'], [dict(palette=palette, sourceFrame=row['sourceFrame'],
                      sourceBeautySHA256=row['sourceBeauty']['sha256'])],
                      'straight-srgb' if scene == 0 else 'scene-linear-premultiplied')
        for palette in (1, 2):
            if not np.array_equal(actual[0][:, :, 3], actual[palette][:, :, 3]):
                raise ValueError('Uniform source palettes change beauty coverage')
            for place in range(3):
                if not np.array_equal(ownership[0][place], ownership[palette][place]):
                    raise ValueError('Uniform palettes change source owner coverage')
            for layer in (0, 4):
                if not np.array_equal(layers[0][layer], layers[palette][layer]):
                    raise ValueError('Uniform palettes change shared furniture or ink contributions')
        if sum(scene // (3 ** p) % 3 != 0 for p in range(3)) < 2:
            continue
        for palettes in ([0, 1, 2], [2, 0, 1]):
            parts = [layers[0][0], layers[0][4]] + [layers[palettes[p]][p + 1] for p in range(3)]
            combined = np.sum(parts, axis=0)
            bindings = [dict(place=p, palette=PALETTES[palettes[p]],
                             sourceFrame=sources[scene, facing, PALETTES[palettes[p]]]['sourceFrame'],
                             layer=sources[scene, facing, PALETTES[palettes[p]]]['layers'][p + 1])
                        for p in range(3)]
            save_case(scene, facing, list(palettes), 'derivedOwnerSources', combined, actual[0][:, :, 3],
                      ownership[0], sources[scene, facing, 'green']['anchor'], bindings)
        print(json.dumps(dict(preparedScene=scene, facing=facing, cases=len(cases))), flush=True)
    payload = dict(version=1, manifestSHA256=index['manifestSHA256'], sourceIndex=str(index_path),
                   sourceIndexSHA256=digest(index_path), sourceAliases=[0, 0, 0, 0], cases=cases, inputs=inputs,
                   mixedReferenceMeaning='Sum of independently indexed exported linear owner contributions; not an actual mixed-colour beauty render')
    (output / 'prepared.json').write_text(json.dumps(payload, indent=2) + '\n')


if __name__ == '__main__':
    prepare(*sys.argv[1:])
