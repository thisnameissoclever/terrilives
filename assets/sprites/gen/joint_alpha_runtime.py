"""Retain original beauty coverage before byte rounding, with a bound source hash."""
import array
import base64
import hashlib
import json
from pathlib import Path
import struct
from PIL import Image


def joint_alpha(source, size, expected_hash):
    source = Path(source)
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_hash:
        raise ValueError('Joint-alpha beauty source hash differs')
    width, height = size
    if any(type(value) is not int or value <= 0 for value in size):
        raise ValueError('Joint-alpha scene dimensions must be positive whole pixels')
    with Image.open(source) as image:
        alpha = image.convert('RGBA').getchannel('A')
        factor_y, factor_x = alpha.height // height, alpha.width // width
        if factor_x < 1 or factor_y < 1 or alpha.size != (width * factor_x, height * factor_y):
            raise ValueError('Joint-alpha beauty cannot restore its scene dimensions')
        # Float pixels retain the fractional block average before half-float encoding.
        reduced = alpha.convert('F').resize((width, height), Image.Resampling.BOX)
        values = b''.join(struct.pack('<e', value / 255) for value in array.array('f', reduced.tobytes()))
    return dict(size=list(size), box=[0, 0, width, height], encoding='float16',
                values=base64.b64encode(values).decode('ascii'))


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
