"""Keep proof references lossless across browser premultiplied-alpha conversions."""
import gzip
import hashlib
import io
import json
from pathlib import Path
import sys
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets/models/architecture/export/reviewed-04'
DESTINATION = Path(__file__).resolve().parent / 'fixtures/architecture'


def prepare(check=False):
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    png = (SOURCE / manifest['resources']['color']).read_bytes()
    png_hash = hashlib.sha256(png).hexdigest()
    assert png_hash == manifest['hashes']['color'], 'Accepted PNG bytes changed'
    with Image.open(io.BytesIO(png)) as image:
        assert image.size == (manifest['width'], manifest['height'])
        rgba = image.convert('RGBA').tobytes()
    output = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as stream:
        stream.write(rgba)
    compressed = output.getvalue()
    receipt = {'width': manifest['width'], 'height': manifest['height'],
               'sourcePngSha256': png_hash, 'rgbaSha256': hashlib.sha256(rgba).hexdigest(),
               'gzipSha256': hashlib.sha256(compressed).hexdigest(),
               'sources': {key: value for key, value in manifest['sourceCoverage'].items()
                           if not key.startswith('floor-patch.')}}
    files = {'color.rgba.bin': compressed,
             'color-rgba.json': (json.dumps(receipt, indent=2) + '\n').encode()}
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        path = DESTINATION / name
        if check:
            assert path.read_bytes() == data, 'Lossless proof fixture changed: ' + name
        else:
            path.write_bytes(data)
    print(f'PASS lossless RGBA: {len(rgba)} bytes, gzip {len(compressed)} bytes, '
          f'{len(receipt["sources"])} original source hashes')


if __name__ == '__main__':
    prepare('--check' in sys.argv)
