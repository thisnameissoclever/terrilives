"""Export supplemental exercise poses and composite them with the current SE bike."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
import tomllib

from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
sys.path.insert(0, str(ROOT / 'assets/sprites/gen'))
import objects
from iso import canvas, emit


def wall_proxy(clip, bike, images):
    lot = tomllib.loads((ROOT / 'content/lot.toml').read_text())
    placement = next(row for row in lot['place'] if row['object'] == 'moving_box')
    assert (placement['x'], placement['y']) == (4, 11)
    assert {'x': 5, 'y': 11} in lot['wall']
    wall_source, wall_draw = canvas()
    objects.wallNS(wall_draw)
    wall = emit(wall_source, *objects.EXACT['wallNS'])[0]
    floor_source, floor_draw = canvas()
    objects.floor(floor_draw)
    floor = emit(floor_source, *objects.EXACT.get('floor', (None, None)))[0]
    board = Image.new('RGBA', (3 * 200, 200), (235, 230, 218, 255))
    labels = ImageDraw.Draw(board)
    for column in range(3):
        origin = (column * 200 + 90, 145)
        for dx, dy in ((0, -1), (1, -1), (-1, 0), (0, 0), (1, 0)):
            point = (origin[0] + (dx - dy) * 32, origin[1] + (dx + dy) * 21)
            board.alpha_composite(floor, (round(point[0] - floor.width / 2), round(point[1] + 21 - floor.height)))
        board.alpha_composite(bike, (round(origin[0] - bike.width / 2), origin[1] + 21 - bike.height))
        if column:
            body = images[('green', f'exercise-SE-{column - 1}.png')]
            board.alpha_composite(body, (round(origin[0] - clip['anchor'][0]), round(origin[1] + 21 - clip['anchor'][1])))
        # Actual lot divider tiles (5,10) and (5,11), drawn after the bike and body.
        for dx, dy in ((1, -1), (1, 0)):
            point = (origin[0] + (dx - dy) * 32, origin[1] + (dx + dy) * 21)
            board.alpha_composite(wall, (round(point[0] - wall.width / 2), point[1] + 21 - wall.height))
        labels.text((column * 200 + 6, 7), 'Unoccupied + actual wall' if not column else f'Pose {column - 1} + actual wall', fill=(35, 32, 28))
    board.convert('RGB').resize((2400, 800), Image.Resampling.NEAREST).save(BASE / 'review/exercise/se-bike-wall-proxy-4x.png')


def export(preview):
    mode = 'preview' if preview else 'batch'
    proof = json.loads((BASE / f'exercise-{mode}-proof.json').read_text())
    assert proof['state'] == 'complete'
    source = json.loads((BASE / 'export/manifest.json').read_text())
    clip = proof['clip']
    size = (clip['width'], clip['height'])
    images = {}
    for variant, frames in proof['variants'].items():
        manifest = deepcopy(source)
        manifest.update(variant=variant, clips={'exercise': clip}, frames=[],
                        source_rig_sha256=proof['source_rig_sha256'], additive_rig_sha256=proof['additive_rig_sha256'])
        output = BASE / ('review/exercise/native-preview' if preview else 'export/exercise') / variant
        output.mkdir(parents=True, exist_ok=True)
        for frame in frames:
            path = BASE / 'review/exercise' / variant / frame['path']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == frame['sha256']
            image = Image.open(path).convert('RGBA')
            assert image.size == (size[0] * 16, size[1] * 16)
            image = image.resize(size, Image.Resampling.LANCZOS)
            image.putdata([(r, g, b, a) if a > 4 else (0, 0, 0, 0)
                           for r, g, b, a in image.get_flattened_data()])
            bounds = image.getchannel('A').getbbox()
            assert bounds and bounds[0] > 0 and bounds[1] > 0 and bounds[2] < size[0] and bounds[3] < size[1], (variant, frame['path'], bounds)
            if variant != 'green':
                assert image.getchannel('A').tobytes() == images[('green', frame['path'])].getchannel('A').tobytes()
            target = output / frame['path']
            image.info.clear()
            image.save(target)
            prefix = 'rigSim' + (variant.title() if variant != 'green' else '')
            manifest['frames'].append({'name': f'{prefix}Exercise{frame["facing"]}{frame["frame"]}',
                                       'action': 'exercise', 'facing': frame['facing'], 'frame': frame['frame'],
                                       'path': frame['path'], 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
            images[(variant, frame['path'])] = image
        if not preview:
            assert len(frames) == 8
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    bike_canvas, draw = canvas()
    objects.cardboardBoxOpen(draw)
    bike = emit(bike_canvas, *objects.EXACT.get('cardboardBoxOpen', (None, None)))[0]
    wall_proxy(clip, bike, images)
    board = Image.new('RGBA', (320, 166), (235, 230, 218, 255))
    labels = ImageDraw.Draw(board)
    loop = []
    for index in range(2):
        origin = (index * 160 + 80, 124)
        board.alpha_composite(bike, (round(origin[0] - bike.width / 2), origin[1] + 21 - bike.height))
        body = images[('green', f'exercise-SE-{index}.png')]
        board.alpha_composite(body, (round(origin[0] - clip['anchor'][0]), round(origin[1] + 21 - clip['anchor'][1])))
        labels.text((index * 160 + 5, 6), f'SE pose {index}: adjusted bars', fill=(35, 32, 28))
        loop.append(board.crop((index * 160, 0, (index + 1) * 160, 166)).convert('RGB').resize((640, 664), Image.Resampling.NEAREST))
    board.convert('RGB').resize((1280, 664), Image.Resampling.NEAREST).save(BASE / 'review/exercise/se-bike-contact-4x.png')
    loop[0].save(BASE / 'review/exercise/se-bike-two-pose-loop.webp', save_all=True,
                 append_images=loop[1:], duration=800, loop=0, lossless=True)
    if not preview:
        all_facings = Image.new('RGBA', (320, 4 * 166), (235, 230, 218, 255))
        labels = ImageDraw.Draw(all_facings)
        for row, facing in enumerate(('SE', 'SW', 'NW', 'NE')):
            surface, draw = canvas()
            objects._bike(draw, facing.lower())
            prop = emit(surface, *objects.EXACT.get('cardboardBoxOpen', (None, None)))[0]
            for index in range(2):
                origin = (index * 160 + 80, row * 166 + 124)
                all_facings.alpha_composite(prop, (round(origin[0] - prop.width / 2), origin[1] + 21 - prop.height))
                body = images[('green', f'exercise-{facing}-{index}.png')]
                all_facings.alpha_composite(body, (round(origin[0] - clip['anchor'][0]), round(origin[1] + 21 - clip['anchor'][1])))
                labels.text((index * 160 + 5, row * 166 + 6), f'{facing} pose {index}: actual bike facing', fill=(35, 32, 28))
        all_facings.convert('RGB').resize((960, 1992), Image.Resampling.NEAREST).save(BASE / 'review/exercise/all-facing-bike-contact-3x.png')
    print(f'PASS: {mode} supplemental exercise export and current-bike SE composite.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true')
    export(parser.parse_args().preview)
