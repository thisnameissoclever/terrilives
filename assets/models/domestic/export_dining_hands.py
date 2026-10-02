"""Encode hand-only geometry coverage without selecting pixels by colour."""
import hashlib
import json
from pathlib import Path
from PIL import Image

BASE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    source = BASE / 'seated-hands'
    proof = json.loads((source / 'proof.json').read_text())
    assert proof['state'] == 'complete' and len(proof['renders']) == 32
    assert {(r['facing'], r['frame']) for r in proof['renders']} == {
        (facing, frame) for facing in ('SE', 'SW', 'NW', 'NE') for frame in range(8)}
    for name, sha in proof['inputs'].items():
        assert digest(BASE / name) == sha
    output = BASE / 'export/seated-hands-proof'
    output.mkdir(parents=True, exist_ok=True)
    scene = json.loads((BASE / 'export/seated-dining/manifest.json').read_text())
    manifest = dict(width=80, height=112, density=2, anchor=scene['anchor'],
                    source_sha256=digest(source / 'proof.json'),
                    encoder_sha256=digest(Path(__file__)), objects=proof['support_objects'], frames=[])
    for row in proof['renders']:
        path = source / row['path']
        assert path.parent.resolve() == source.resolve() and digest(path) == row['sha256']
        with Image.open(path) as raw:
            alpha = raw.getchannel('A').resize((160, 224), Image.Resampling.BOX)
        assert alpha.getbbox()
        encoded = Image.new('RGBA', alpha.size, 'white')
        encoded.putalpha(alpha)
        name = hashlib.sha256(encoded.tobytes()).hexdigest() + '.png'
        encoded.save(output / name)
        manifest['frames'].append(dict(facing=row['facing'], frame=row['frame'],
                                      path=name, sha256=digest(output / name)))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('Published independent hand geometry masks.')


if __name__ == '__main__':
    main()
