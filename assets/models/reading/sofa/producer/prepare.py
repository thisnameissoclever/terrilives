"""Freeze bounded per-state, per-facing source jobs from existing static poses."""
import hashlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ROOT = next(path for path in Path(__file__).resolve().parents if (path / 'assets/models/sims/sim-01').is_dir())
sys.path.insert(0, str(ROOT / 'assets/models/seating'))
from seat_export_contract import CAMERA_MATRIX


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(output, states):
    output.mkdir(exist_ok=False)
    source = HERE / 'source.blend'
    proof = HERE / 'pose-receipt.json'
    paths = [source, proof, HERE / 'source.py', HERE / 'launch.ps1',
             ROOT / 'assets/models/seating/neutral_pose.py', ROOT / 'assets/models/seating/pose_profiles.py',
             ROOT / 'assets/models/sims/sim-01/build_rig.py', ROOT / 'assets/models/sims/sim-01/rig_math.py',
             ROOT / 'assets/models/sims/sim-01/food_depth.py', ROOT / 'assets/models/sims/sim-01/render_job.py',
             ROOT / 'assets/models/sims/sim-01/render_shirt_variants.py', ROOT / 'assets/models/sims/sim-01/shirt_colors.py']
    for path in paths:
        if path.suffix == '.py':
            compile(path.read_text(encoding='utf-8-sig'), str(path), 'exec')
    inputs = {str(path): digest(path) for path in paths}
    for state in states:
        for facing, degrees in dict(SE=90, NW=270, SW=0, NE=180).items():
            job = output / f'{state:02d}-{facing}'; job.mkdir()
            manifest = dict(inputs=inputs, source_scene=str(source), pose_receipt=str(proof), sceneKey=state,
                            facing=facing, facing_radians=math.radians(degrees), camera_matrix=CAMERA_MATRIX,
                            ortho_scale=3.889087200164795, canvas=[160, 176], anchor=[80.00000953674316, 144.00043869018555],
                            seconds=210, jobs=dict(render_script=str(HERE / 'source.py')),
                            outputs=dict(render=str(job / 'raw')))
            (job / 'input-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(dict(output=str(output), states=states, jobs=len(states) * 4)))


if __name__ == '__main__':
    run(Path(sys.argv[1]).resolve(), [int(value) for value in sys.argv[2:]])
