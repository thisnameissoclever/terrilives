"""Export denser parallel textures from verified original renders, never native sprites."""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parents[3] / 'assets/sprites/gen'))
from offline_sims import load_export


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def proof_output_path(target, base):
    """Serialize relative artifact paths independently of the export host OS."""
    return target.relative_to(base).as_posix()


def downsample(source, size):
    image = source.resize(size, Image.Resampling.LANCZOS)
    image.putdata([(r, g, b, a) if a > 4 else (0, 0, 0, 0)
                   for r, g, b, a in image.get_flattened_data()])
    image.info.clear()
    return image


def verify_source(source_path, native_path, size, expected_hash):
    if not source_path.is_file():
        raise ValueError(f'missing {source_path}')
    source_hash = digest(source_path)
    if expected_hash is not None and source_hash != expected_hash:
        raise ValueError(f'source hash mismatch {source_path}')
    with Image.open(source_path) as source:
        if source.mode != 'RGBA' or source.size != (size[0] * 16, size[1] * 16):
            raise ValueError(f'wrong source dimensions/mode {source_path}')
        with Image.open(native_path) as native:
            if downsample(source, size).tobytes() != native.tobytes():
                raise ValueError(f'accepted native reproduction mismatch {source_path}')
    return source_hash


def export(source_root):
    source_root = Path(source_root).resolve()
    status = json.loads((source_root / 'build-status.json').read_text())
    shirts = json.loads((source_root / 'shirt-variants-batch-proof.json').read_text())
    exercise = json.loads((source_root / 'exercise-batch-proof.json').read_text())
    if any(proof.get('state') != 'complete' for proof in (status, shirts, exercise)):
        raise ValueError('source batches must be complete')
    if not shirts.get('original_files_byte_identical'):
        raise ValueError('shirt batch lacks original-file preservation proof')
    jobs, problems = [], []
    for relative, variant in [('', 'green'), ('blue', 'blue'), ('red', 'red'),
                              ('exercise/green', 'green'), ('exercise/blue', 'blue'), ('exercise/red', 'red')]:
        native_path = BASE / 'export' / relative / 'manifest.json'
        manifest = json.loads(native_path.read_text())
        load_export(native_path, expected_variant=variant)
        is_exercise = relative.startswith('exercise/')
        if is_exercise:
            folder = source_root / 'review/exercise' / variant
            recorded = {row['path']: row['sha256'] for row in exercise['variants'][variant]}
        elif variant != 'green':
            folder = source_root / 'review/shirt-variants' / variant
            recorded = {row['path']: row['sha256'] for row in shirts['variants'][variant]['frames']}
        else:
            folder, recorded = source_root / 'review', {}
        frames = []
        for row in manifest['frames']:
            source_path = folder / row['path']
            clip = manifest['clips'][row['action']]
            size = (clip['width'], clip['height'])
            try:
                if recorded and row['path'] not in recorded:
                    raise ValueError(f'missing source hash {source_path}')
                source_hash = verify_source(source_path, native_path.parent / row['path'], size,
                                            recorded.get(row['path']))
            except ValueError as error:
                problems.append(str(error))
                continue
            frames.append((row, source_path, source_hash, size))
        jobs.append((relative, variant, manifest, frames))
    if problems:
        raise ValueError('HD source verification failed before writing:\n' + '\n'.join(problems))
    proof = {'pixel_density': 2, 'frames': [], 'source_verification':
             'Recorded source hashes where available; all sources reproduce hash-validated native RGBA.'}
    for relative, variant, manifest, frames in jobs:
        output = BASE / 'export/hd' / relative
        output.mkdir(parents=True, exist_ok=True)
        dense = deepcopy(manifest)
        dense['pixel_density'] = 2
        for row, source_path, source_hash, size in frames:
            with Image.open(source_path) as source:
                image = downsample(source, (size[0] * 2, size[1] * 2))
            target = output / row['path']
            image.save(target)
            dense_row = next(entry for entry in dense['frames'] if entry['name'] == row['name'])
            dense_row['sha256'] = digest(target)
            proof['frames'].append({'name': row['name'], 'source': source_path.as_posix(),
                                    'source_sha256': source_hash, 'path': proof_output_path(target, BASE),
                                    'sha256': dense_row['sha256']})
        target_manifest = output / 'manifest.json'
        target_manifest.write_text(json.dumps(dense, indent=2) + '\n')
        load_export(target_manifest, expected_variant=variant)
    for row in proof['frames']:
        if digest(BASE / row['path']) != row['sha256']:
            raise ValueError(f'output hash mismatch: {row["path"]}')
    (BASE / 'export/hd/proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(f'PASS: {len(proof["frames"])} verified 2x frames; originals unchanged.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    export(parser.parse_args().source_root)
