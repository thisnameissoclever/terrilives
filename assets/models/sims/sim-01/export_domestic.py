"""Verify completed background renders and export registered domestic clips."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
OUT = BASE / 'export' / 'domestic'
STATUS = json.loads((BASE / 'domestic-status.json').read_text())
assert STATUS['state'] == 'complete' and STATUS['background']
assert STATUS['completed'] == STATUS['expected'] == 144
assert hashlib.sha256((BASE / 'sim-01-rigged.blend').read_bytes()).hexdigest() == STATUS['source_sha256']
review = Image.new('RGB', (4 * 208, 3 * 244), '#252a30')
draw = ImageDraw.Draw(review)
for variant in ('green', 'blue', 'red'):
    folder = OUT / variant
    data = json.loads((folder / 'render-manifest.json').read_text())
    for row in data['frames']:
        raw = folder / ('raw-' + row['path'])
        assert hashlib.sha256(raw.read_bytes()).hexdigest() == row.pop('raw_sha256')
        clip = data['clips'][row['action']]
        image = Image.open(raw).convert('RGBA').resize((clip['width'] * 2, clip['height'] * 2), Image.Resampling.LANCZOS)
        image.save(folder / row['path'])
        row['sha256'] = hashlib.sha256((folder / row['path']).read_bytes()).hexdigest()
        row['content_top'] = image.getchannel('A').getbbox()[1] / 2
        if variant == 'green' and row['frame'] == 1:
            x = ('SE', 'SW', 'NW', 'NE').index(row['facing']) * 208
            y = ('prepare', 'cook', 'wash').index(row['action']) * 244
            review.paste(image, (x + 52, y + 24), image)
            draw.text((x + 10, y + 5), row['action'] + ' ' + row['facing'], fill='white')
    (folder / 'manifest.json').write_text(json.dumps(data, indent=2) + '\n')
review_path = BASE / 'review' / 'domestic'
review_path.mkdir(parents=True, exist_ok=True)
review.save(review_path / 'poses.png')
print('Verified and exported 144 domestic frames; accepted rig hash unchanged.')
