"""Build decoded-layer shader references for the fridge open-and-reach scenes.

Each reference composes the exported body, furniture and ink layers the way the
sprite shader does: sum the premultiplied scene-linear layers, apply the display
transfer once, and composite over the proof board background. The result feeds
`web/proofs/fridge-reach.js`, which compares the real GPU output against it. This
is a shader-fidelity reference, not the original beauty render; the exporter's
own comparison against independent beauty is the separate source gate.
"""
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parents[4]
source = root/'assets/models/kitchen/actions/export/fridge-03'
manifest = json.loads((source/'manifest.json').read_text())
references = []
for obj in manifest['objects']:
    for row in obj['scenes']:
        arrays = [np.asarray(Image.open(source/row['layers'][role]['path']), dtype=np.float64)/255
                  for role in ('body', 'furniture', 'ink')]
        summed = sum(arrays)
        alpha = summed[..., 3:4]
        straight = np.divide(summed[..., :3], alpha, out=np.zeros_like(summed[..., :3]), where=alpha > 0)
        display = np.where(straight <= .0031308, straight*12.92, 1.055*np.maximum(straight, 0)**(1/2.4)-.055)
        rgb = np.where(alpha >= .5, display*np.minimum(alpha, 1)+[.09, .09, .11]*(1-np.minimum(alpha, 1)), [.09, .09, .11])
        assert np.isfinite(rgb).all()
        rgb = np.round(np.clip(rgb, 0, 1)*255).astype(np.uint8)
        image = Image.fromarray(rgb).convert('RGBA')
        data = io.BytesIO()
        image.save(data, format='PNG')
        references.append(dict(name=f"{obj['kind']} {row['facing']} {row['variant']} {row['frame']}",
            empty='offlineFridge'+('' if row['facing'] == 'SE' else row['facing']),
            facing=dict(SE=3, NW=4, SW=2, NE=1)[row['facing']], variant=row['variant'], frame=row['frame'],
            image='data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()))
(root/'web/proofs/fridge-reach-reference.json').write_text(json.dumps(references), newline='\n')
print(len(references), 'complete decoded-layer shader references')
