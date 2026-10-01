"""Encode independent full-table beauty renders for graphics comparisons."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent / 'furniture'))
from layer_partition import encode_contribution


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    source = BASE / 'seated-table'
    proof = json.loads((source / 'proof.json').read_text())
    assert proof['state'] == 'complete' and len(proof['renders']) == 96
    for name, sha in proof['inputs'].items():
        assert digest(BASE / name) == sha
    output = BASE / 'export/seated-table-proof'
    output.mkdir(parents=True, exist_ok=True)
    manifest = dict(width=proof['width'], height=proof['height'], density=2, anchor=proof['anchor'],
                    source_sha256=digest(source / 'proof.json'), encoder_sha256=digest(Path(__file__)), frames=[])
    for row in proof['renders']:
        path = source / row['path']
        assert path.parent.resolve() == source.resolve() and digest(path) == row['sha256']
        with Image.open(path) as raw:
            box = raw.getchannel('A').getbbox()
            assert box and 0 < box[0] < box[2] < raw.width and 0 < box[1] < box[3] < raw.height
            encoded = encode_contribution(raw, (proof['width'] * 2, proof['height'] * 2))
        name = hashlib.sha256(encoded.tobytes()).hexdigest() + '.png'
        encoded.save(output / name)
        manifest['frames'].append(dict(row, reference=dict(path=name, sha256=digest(output / name))))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Published independent full-table references.')


if __name__ == '__main__':
    main()
