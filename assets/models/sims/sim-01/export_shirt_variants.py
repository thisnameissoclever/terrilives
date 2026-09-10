"""Downsample material variants while preserving the approved frame metadata."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent


def export(preview=False):
    mode = 'preview' if preview else 'batch'
    proof = json.loads((BASE / f'shirt-variants-{mode}-proof.json').read_text())
    assert proof['state'] == 'complete' and proof['original_files_byte_identical']
    source = json.loads((BASE / 'export/manifest.json').read_text())
    native = {}
    for variant in ('blue', 'red'):
        manifest = deepcopy(source)
        manifest['variant'] = variant
        manifest['source_rig_sha256'] = proof['source_rig_sha256']
        manifest['frames'] = []
        available = {frame['path']: frame for frame in proof['variants'][variant]['frames']}
        output = BASE / ('review/shirt-variants/native-preview' if preview else 'export') / variant
        output.mkdir(parents=True, exist_ok=True)
        for original in source['frames']:
            if original['path'] not in available:
                assert preview
                continue
            entry = deepcopy(original)
            path = BASE / 'review/shirt-variants' / variant / entry['path']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == available[entry['path']]['sha256']
            clip = source['clips'][entry['action']]
            size = (clip['width'], clip['height'])
            image = Image.open(path).convert('RGBA')
            assert image.size == (size[0] * 16, size[1] * 16)
            image = image.resize(size, Image.Resampling.LANCZOS)
            image.putdata([(r, g, b, a) if a > 4 else (0, 0, 0, 0)
                           for r, g, b, a in image.get_flattened_data()])
            bounds = image.getchannel('A').getbbox()
            assert bounds and bounds[0] > 0 and bounds[1] > 0 and bounds[2] < size[0] and bounds[3] < size[1]
            green = Image.open(BASE / 'export' / original['path']).convert('RGBA')
            assert image.getchannel('A').tobytes() == green.getchannel('A').tobytes(), (variant, entry['path'], 'alpha differs')
            image.info.clear()
            target = output / entry['path']
            image.save(target)
            entry['name'] = original['name'].replace('rigSim', f'rigSim{variant.title()}', 1)
            entry['sha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
            manifest['frames'].append(entry)
            native[(variant, entry['path'])] = image
        if not preview:
            assert len(manifest['frames']) == len(source['frames']) == 148
            (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    sheet = Image.new('RGB', (3 * 240, 2 * 580), (235, 230, 218))
    draw = ImageDraw.Draw(sheet)
    for column, (variant, label) in enumerate((('blue', 'Tim: blue'), ('green', 'Bill: existing green'), ('red', 'Casey: red'))):
        for row, facing in enumerate(('SE', 'SW')):
            filename = f'idle-{facing}-0.png'
            image = (Image.open(BASE / 'export' / filename).convert('RGBA') if variant == 'green'
                     else native[(variant, filename)])
            draw.text((column * 240 + 10, row * 580 + 12), f'{label} / {facing}', fill=(35, 32, 28))
            large = image.resize((228, 528), Image.Resampling.NEAREST)
            sheet.paste(large, (column * 240 + 6, row * 580 + 38), large)
    sheet.save(BASE / 'review/shirt-variants/shirt-color-contact-6x.png')
    if not preview:
        review = BASE / 'review/shirt-variants'
        variants = ('blue', 'green', 'red')
        facings = ('SE', 'SW', 'NW', 'NE')
        def frame_image(variant, filename):
            return (Image.open(BASE / 'export' / filename).convert('RGBA') if variant == 'green'
                    else native[(variant, filename)])
        contact = Image.new('RGBA', (3 * 160 * 3, 4 * 118 * 3), (235, 230, 218, 255))
        labels = ImageDraw.Draw(contact)
        for column, variant in enumerate(variants):
            for row, facing in enumerate(facings):
                labels.text((column * 480 + 8, row * 354 + 8), f'{variant} {facing}: idle / walk / eat', fill=(35, 32, 28))
                x = column * 480 + 6
                for filename in (f'idle-{facing}-0.png', f'walk-{facing}-2.png', f'eat-{facing}-2.png'):
                    frame = frame_image(variant, filename)
                    large = frame.resize((frame.width * 3, frame.height * 3), Image.Resampling.NEAREST)
                    contact.alpha_composite(large, (x, row * 354 + 30))
                    x += 156
        contact.convert('RGB').save(review / 'all-facing-color-contact-3x.png')
        loop = []
        for index in range(8):
            canvas = Image.new('RGBA', (4 * 156, 3 * 338), (235, 230, 218, 255))
            labels = ImageDraw.Draw(canvas)
            for row, variant in enumerate(variants):
                for column, facing in enumerate(facings):
                    labels.text((column * 156 + 5, row * 338 + 5), f'{variant} {facing}', fill=(35, 32, 28))
                    frame = frame_image(variant, f'walk-{facing}-{index}.png')
                    canvas.alpha_composite(frame.resize((156, 312), Image.Resampling.NEAREST), (column * 156, row * 338 + 24))
            loop.append(canvas.convert('RGB'))
        loop[0].save(review / 'all-facing-shirt-walk-loop.webp', save_all=True,
                     append_images=loop[1:], duration=50, loop=0, lossless=True)
    print(f'PASS: {mode} shirt variants; original alpha and frame metadata preserved.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true')
    export(parser.parse_args().preview)
