"""Fit rigid floor yaw to all published alpha masks without changing their pixels."""
from pathlib import Path
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}


def fit(geometry_path, reference_path, output):
    geometry = json.loads(geometry_path.read_text(encoding='utf-8'))
    manifest = json.loads(reference_path.read_text(encoding='utf-8'))
    vertices, triangles = np.asarray(geometry['vertices']), np.asarray(geometry['triangles'])
    basis, origin = np.asarray(geometry['basis']), np.asarray(geometry['origin'])
    width, height = geometry['canvas']
    references = {}
    for row in manifest['records']:
        sprite = row['sprite']
        image = Image.new('L', (width, height))
        with Image.open(reference_path.parent / sprite['path']) as original:
            image.paste(original.getchannel('A'), tuple(sprite['rawCrop'][:2]))
        references[row['facing']] = np.asarray(image).astype(float) / 255
    assert set(references) == set(FACINGS)

    def score(yaw, density, save=False):
        total, per_facing = 0., {}
        for facing, angle in FACINGS.items():
            radians = math.radians(yaw + angle)
            c, s = math.cos(radians), math.sin(radians)
            rotation = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
            projected = (vertices @ rotation.T) @ basis + origin
            mask = Image.new('L', (width * density, height * density))
            draw = ImageDraw.Draw(mask)
            for triangle in triangles:
                draw.polygon([tuple(point * density) for point in projected[triangle]], fill=255)
            # Rasterized half-stroke radius at this fitting resolution. It is
            # derived from the retained source style, never optimized with yaw.
            radius = round(geometry['outlineHalfWidthPixels'] * density)
            if radius:
                mask = mask.filter(ImageFilter.MaxFilter(radius * 2 + 1))
            mask = mask.resize((width, height), Image.Resampling.LANCZOS)
            difference = float(np.abs(np.asarray(mask).astype(float) / 255 - references[facing]).sum())
            total += difference
            per_facing[facing] = difference
            if save:
                mask.save(output / f'{facing}-fit-alpha.png')
        return total, per_facing

    coarse = sorted((score(yaw, 2)[0], yaw) for yaw in range(0, 360, 2))
    best = coarse[0][1]
    fine = sorted((score(best + step / 10, 4)[0], best + step / 10) for step in range(-30, 31))
    yaw = fine[0][1]
    total, by_facing = score(yaw, 4, save=True)
    result = dict(yawDegrees=yaw, alphaAbsoluteDifference=total, differenceByFacing=by_facing,
                  method='all-four-complete-alpha-masks', coarse=coarse[:8], fine=fine[:8],
                  priorWidthHeightFit=dict(yawDegrees=233, alphaAbsoluteDifference=score(233, 4)[0]),
                  scale=1, translationOptimized=False, sourceOutlineHalfWidthPixels=geometry['outlineHalfWidthPixels'],
                  rasterization='source-triangle-union-with-fixed-source-stroke-and-Lanczos3',
                  originalSurfaceRecovered=False)
    (output / 'fit-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    fit(*map(Path, sys.argv[1:]))
