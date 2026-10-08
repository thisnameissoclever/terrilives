"""Composite the exported fridge reach scenes into the shipped kitchen corner at game scale.

Usage: python fridge_corner_composite.py EXPORT_DIRECTORY OUTPUT_PNG

The shipped house stands the fridge in a corner: a wall behind it and a wall
along the handle side of the tile in front of it, both 0.14 thick and centred
on the tile edges, with the counter on the hinge side. For every facing the
same corner is turned with the fridge. Each pixel takes the nearest of the
floor, the walls (analytic planes, 2.2 m tall), the counter (its static
sprite at its tile's depth) and the scene (its per-pixel depth sprite), the
same depth comparison the game's renderer makes. The selection ring is drawn
under the sample's feet and the bubble anchor over the body's top.
"""
import json
import math
from pathlib import Path
import sys
import tomllib

import numpy as np
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
sys.path.insert(0, str(BASE))
import fridge_reach_geometry as geo
from fridge_export_contract import feet

FACING_DEGREES = dict(SE=90, NW=270, SW=0, NE=180)
FACINGS = ('SE', 'SW', 'NE', 'NW')
DENSITY = 2
TILE_X, TILE_Y, LIFT = 32.0, 21.0, 273.0/8
WALL_HEIGHT = 2.2
FACE = geo.WALL_FACE
# Walls in the fridge's own frame (front -Y, handle side -X), at their faces.
WALLS = (((-1.5, FACE), (1.5, FACE)), ((-FACE, FACE), (-FACE, -2.0)))
COUNTER = (1.0, 0.0)


def to_game(point, facing):
    turn = math.radians(FACING_DEGREES[facing])
    x, y = point
    bx, by = math.cos(turn)*x-math.sin(turn)*y, math.sin(turn)*x+math.cos(turn)*y
    return bx, -by


def counter_sprite(facing):
    atlas = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    name = 'offlineCounter'+('' if facing == 'SE' else facing)
    row = next(s for s in atlas['sprite'] if s['name'] == name)
    page = Image.open(ROOT/'web/public'/atlas['pages'][row.get('page', 0)]).convert('RGBA')
    return page.crop((row['x'], row['y'], row['x']+row['w'], row['y']+row['h']))


def composite(export, row, anchor, facing, counter):
    scene = Image.open(export/row['reconstruction']['path']).convert('RGBA')
    depth = np.asarray(Image.open(export/row['depth']['path']), dtype=np.int64)
    w, h = scene.size
    # Scene pixel (col, row) relative to the fridge's tile centre, in logical pixels.
    ox, oy = anchor[0]*DENSITY, (anchor[1]-TILE_Y)*DENSITY
    cols = (np.arange(w)+.5-ox)/DENSITY
    rows = (np.arange(h)+.5-oy)/DENSITY
    cc, rr = np.meshgrid(cols, rows)
    column = cc/TILE_X
    canvas = np.zeros((h, w, 3))
    nearest = np.full((h, w), -1e9)
    floor_n = rr/TILE_Y
    tiles = np.floor((floor_n+column)/2+.5)+np.floor((floor_n-column)/2+.5)
    canvas[:] = np.where((tiles % 2 == 0)[..., None], [176, 172, 164], [164, 160, 152])
    nearest[:] = -1e8
    # Counter: its static sprite at its tile, one tile of depth nearer than the fridge.
    cx, cy = to_game(COUNTER, facing)
    sprite = np.asarray(counter, dtype=np.float64)
    cw, ch = counter.size
    sx = int(round(ox+(cx-cy)*TILE_X*DENSITY-cw/2))
    # The static prop anchors 116 logical pixels down its 120 canvas.
    sy = int(round(oy+((cx+cy)*TILE_Y+TILE_Y)*DENSITY-116*DENSITY))
    for y in range(ch):
        for x in range(cw):
            px, py = sx+x, sy+y
            if 0 <= px < w and 0 <= py < h and sprite[y, x, 3] > 127 and cx+cy > nearest[py, px]:
                canvas[py, px] = sprite[y, x, :3]
                nearest[py, px] = cx+cy
    # Walls: analytic planes at their faces.
    for start, end in WALLS:
        (x0, y0), (x1, y1) = to_game(start, facing), to_game(end, facing)
        denominator = (x1-x0)-(y1-y0)
        if abs(denominator) < 1e-9:
            continue
        s = (column-(x0-y0))/denominator
        wx, wy = x0+s*(x1-x0), y0+s*(y1-y0)
        n = wx+wy
        z = (n*TILE_Y-rr)/LIFT
        hit = (s >= 0) & (s <= 1) & (z >= 0) & (z <= WALL_HEIGHT) & (n > nearest)
        shade = 205 if abs(x1-x0) > abs(y1-y0) else 188
        canvas[hit] = [shade, shade-4, shade-14]
        nearest[hit] = n[hit]
    # Scene: per-pixel depth decoded exactly as the game's shader does.
    alpha = np.asarray(scene, dtype=np.float64)[:, :, 3]
    encoded = depth[:, :, 0]*256+depth[:, :, 1]
    n = encoded/65535*4-2
    scene_rgb = np.asarray(scene, dtype=np.float64)[:, :, :3]
    visible = (alpha > 0) & ((depth[:, :, 3] == 0) | (n >= nearest-1e-6))
    a = (alpha/255)[..., None]
    canvas = np.where(visible[..., None], scene_rgb*a+canvas*(1-a), canvas)
    hidden = (alpha > 127) & ~visible
    return Image.fromarray(np.clip(canvas, 0, 255).astype(np.uint8)), (ox, oy), hidden


def build(export, output):
    export = Path(export)
    manifest = json.loads((export/'manifest.json').read_text())
    obj = manifest['objects'][0]
    anchor = obj['anchor']
    scenes = {(r['facing'], r['frame']): r for r in obj['scenes'] if r['variant'] == 'green'}
    cells, report = [], {}
    for facing in FACINGS:
        counter = counter_sprite(facing)
        steps = feet(facing)
        for frame in range(geo.SAMPLES):
            image, (ox, oy), hidden = composite(export, scenes[facing, frame], anchor, facing, counter)
            body = np.asarray(Image.open(export/scenes[facing, frame]['coverage']['body']['path']))
            furniture = np.asarray(Image.open(export/scenes[facing, frame]['coverage']['furniture']['path']))
            lost = dict(body=int((hidden & (body >= furniture)).sum()), fixture=int((hidden & (furniture > body)).sum()))
            draw = ImageDraw.Draw(image)
            fx, fy = steps[frame]
            px, py = ox+(fx-fy)*TILE_X*DENSITY, oy+(fx+fy)*TILE_Y*DENSITY
            draw.ellipse((px-14, py-7, px+14, py+7), outline=(250, 250, 250), width=2)
            top = int(np.argmax(body.max(axis=1) > 0))
            draw.ellipse((px-5, top-24, px+5, top-14), fill=(60, 140, 230))
            draw.text((6, 6), f'{facing} sample {frame} door {geo.DOOR_DEGREES[frame]}', fill=(20, 20, 20))
            report[f'{facing}-{frame}'] = lost
            cells.append(image.resize((image.width*2, image.height*2), Image.Resampling.NEAREST))
    cw, ch = cells[0].size
    sheet = Image.new('RGB', (cw*geo.SAMPLES, ch*len(FACINGS)))
    for index, cell in enumerate(cells):
        sheet.paste(cell, ((index % geo.SAMPLES)*cw, (index//geo.SAMPLES)*ch))
    sheet.save(output)
    return report


if __name__ == '__main__':
    print(json.dumps(build(sys.argv[1], sys.argv[2])))
