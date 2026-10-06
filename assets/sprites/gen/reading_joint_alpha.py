"""Retain original beauty coverage before byte rounding, with a bound source hash."""
import base64
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image


def joint_alpha(source, size, expected_hash):
    source = Path(source)
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_hash:
        raise ValueError('Joint-alpha beauty source hash differs')
    with Image.open(source) as image:
        alpha = np.asarray(image.convert('RGBA'), dtype=np.float32)[:, :, 3] / 255
    width, height = size
    factor_y, factor_x = alpha.shape[0] // height, alpha.shape[1] // width
    if alpha.shape != (height * factor_y, width * factor_x):
        raise ValueError('Joint-alpha beauty cannot restore its scene dimensions')
    values = alpha.reshape(height, factor_y, width, factor_x).mean(axis=(1, 3)).astype('<f2')
    return dict(size=list(size), box=[0, 0, width, height], encoding='float16',
                values=base64.b64encode(values.tobytes()).decode('ascii'))


def load_joint(path, manifest):
    path = Path(path)
    data = json.loads((path.parent / 'joint-alpha.json').read_text())
    if data['manifestSHA256'] != hashlib.sha256(path.read_bytes()).hexdigest():
        raise ValueError('Joint-alpha source manifest differs')
    result = {}
    for row in data['records']:
        source = path.parent / row['source']['path']
        values = joint_alpha(source, row['coverage']['size'], row['source']['sha256'])
        if values != row['coverage']:
            raise ValueError('Joint-alpha retained precision differs')
        result[(row['facing'], row['sourceFrame'])] = values
    expected = {(row['facing'], row.get('sourceFrame', row['frame'])) for row in manifest['records']}
    if set(result) != expected:
        raise ValueError('Joint-alpha action frames are incomplete')
    return result
