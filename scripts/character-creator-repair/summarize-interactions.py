"""Require the exact capture matrix and arrange actual frames for visual inspection."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
folder = root / 'docs/evidence/2026-10-13-creator-repair/interaction-contracts'
records = []
for directory in [folder, folder/'fish']:
    receipt = json.loads((directory/'receipt.json').read_text(encoding='utf-8'))
    assert not receipt['diagnostics'], receipt['diagnostics']
    for row in receipt['cases']:
        if row['status'] == 'CAPTURED':
            row['directory'] = directory.relative_to(folder).as_posix()
            records.append(row)
expected = {(name, facing) for name in ['bath', 'shower', 'handwash', 'toilet', 'television', 'radio', 'letters', 'fish'] for facing in range(4)}
keys = [(row['id'], row['facing']) for row in records]
assert set(keys) == expected and len(keys) == len(expected)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 20)
for name in ['bath', 'shower', 'handwash', 'toilet', 'television', 'radio', 'letters', 'fish']:
    sheet = Image.new('RGB', (1200, 1002), '#17191f')
    draw = ImageDraw.Draw(sheet)
    for col, facing in enumerate(range(4)):
        row = next(row for row in records if row['id'] == name and row['facing'] == facing)
        phases = row['phases']
        active = [p for p in phases if p['phase'] == 'active']
        frames = [next(p for p in phases if p['phase'] == 'entry'), active[-1], next(p for p in phases if p['phase'] == 'exit')]
        for line, phase in enumerate(frames):
            with Image.open(folder/row['directory']/phase['file']) as source:
                image = source.resize((300, 310), Image.Resampling.LANCZOS)
            x, y = col*300, line*334
            draw.text((x+8,y+1), f"{name} {facing} {phase['phase']}", font=font, fill='white')
            sheet.paste(image,(x,y+24))
    sheet.save(folder/f'{name}-contact-sheet.png')
(folder/'coverage.json').write_bytes(json.dumps({'status':'CAPTURED','expected':len(expected),'cases':records,
    'limits':'Rendered frames still require independent visual review. The first run retained a setup failure for the legacy fish model identifier; its 28 completed cases and the separate four-case fish run form this exact matrix.'},indent=2).encode('utf-8'))
print(json.dumps({'captured':len(records),'facings':4,'families':8}))
