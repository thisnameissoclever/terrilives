"""Preserve reviewed pixels while applying the saved action's measured cadence."""
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

BASE = Path(__file__).resolve().parent/'ottoman-sit-candidate-02'
SOURCE = BASE/'offline-export/full-clip.webp'
DESTINATION = BASE/'offline-export/full-clip-authored-cadence.webp'
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    cadence_file = BASE/'action-cadence.json'
    cadence = json.loads(cadence_file.read_text())
    if (cadence.get('state') != 'complete' or cadence.get('source_unchanged') is not True
            or cadence.get('action') != 'ottoman_sit'
            or digest(BASE/'ottoman-sit-authoring.blend') != cadence['model_sha256']):
        raise ValueError('Saved action cadence is unverified')
    fps, count = cadence['sample_fps'], cadence['loop_samples']
    if type(fps) not in (int, float) or not math.isfinite(fps) or fps <= 0 or count != 4:
        raise ValueError('Unsupported animation cadence')
    duration = 1000/fps
    if duration != round(duration):
        raise ValueError('Frame duration cannot be represented exactly')
    report_file = BASE/'offline-export/export-proof.json'
    report = json.loads(report_file.read_text())
    recorded = next(row for row in report['review_files'] if row['path'] == SOURCE.name)
    if digest(SOURCE) != recorded['sha256'] or DESTINATION.exists():
        raise ValueError('Changed review input or existing output')
    originals = []
    with Image.open(SOURCE) as image:
        if image.n_frames != count:
            raise ValueError('Wrong preview sample count')
        for frame in range(count):
            image.seek(frame)
            originals.append(image.convert('RGBA').copy())
    originals[0].save(DESTINATION, save_all=True, append_images=originals[1:],
                      duration=round(duration), loop=0, lossless=True)
    observed = []
    with Image.open(DESTINATION) as image:
        if image.n_frames != count:
            raise ValueError('Encoded preview lost samples')
        for frame, original in enumerate(originals):
            image.seek(frame)
            pixels = image.convert('RGBA')
            if pixels.size != original.size or pixels.tobytes() != original.tobytes():
                raise ValueError('Cadence change altered reviewed pixels')
            if image.info['duration'] != round(duration):
                raise ValueError('Encoded duration differs from saved action')
            observed.append(image.info['duration'])
    proof = {'state': 'complete', 'scope': 'offline preview cadence only',
             'source_animation_sha256': digest(SOURCE), 'export_proof_sha256': digest(report_file),
             'action_cadence_sha256': digest(cadence_file), 'model_sha256': cadence['model_sha256'],
             'script_sha256': digest(Path(__file__)), 'preview_sha256': digest(DESTINATION),
             'sample_fps': fps, 'frame_durations_ms': observed, 'decoded_frames_unchanged': True}
    (BASE/'offline-export/cadence-proof.json').write_text(json.dumps(proof, indent=2)+'\n')
    print(f'PASS: {count} identical decoded frames, {duration:g} ms each, from saved action metadata.')


if __name__ == '__main__':
    main()
