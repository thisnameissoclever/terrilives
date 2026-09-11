"""Record the complete render dependency set without rewriting old journals."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[2]
SIM_INPUTS = ('sim-01-rigged.blend','registered-canvas-proof.json','build_rig.py',
              'render_shirt_variants.py','shirt_colors.py','rig_math.py','food_depth.py','render_job.py')
FURNITURE_INPUTS = ('render_provenance.py','render_contributions.py','animation_export.py',
                    'build_parts.py','geometry.py','preview.py')


def inputs():
    paths = [BASE/name for name in FURNITURE_INPUTS]
    paths.extend(BASE.parent/'sims/sim-01'/name for name in SIM_INPUTS)
    return {path.relative_to(ROOT).as_posix():hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


def verify(directory, complete=True):
    proof = json.loads((Path(directory)/'dependency-proof.json').read_text())
    if proof['inputs'] != inputs():
        raise ValueError('Supplemental render dependencies changed')
    if proof['mode'] not in ('generation-start-and-end','post-render-git-comparison'):
        raise ValueError('Unknown dependency proof mode')
    if complete and proof['mode'] == 'generation-start-and-end' and proof.get('state') != 'complete':
        raise ValueError('Render dependency verification is incomplete')
    return proof


def capture_existing(directory):
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    for name in SIM_INPUTS:
        path = BASE.parent/'sims/sim-01'/name
        relative = path.relative_to(ROOT).as_posix()
        committed = subprocess.check_output(['git','show',f'{revision}:{relative}'],cwd=ROOT)
        if committed != path.read_bytes():
            raise ValueError(f'Post-render dependency differs from committed source: {relative}')
    proof = {'mode':'post-render-git-comparison','revision':revision,'inputs':inputs(),
             'limitation':'Additional dependency hashes were recorded after rendering. This verifies current files against Git, not their state throughout the earlier render.'}
    (Path(directory)/'dependency-proof.json').write_text(json.dumps(proof,indent=2))


def render(directory):
    import bpy
    import render_contributions
    directory = Path(directory)
    directory.mkdir(parents=True,exist_ok=True)
    path = directory/'dependency-proof.json'
    start = inputs()
    if path.exists():
        previous = verify(directory,complete=False)
        if previous['mode'] != 'generation-start-and-end':
            raise ValueError('Start a fresh directory for generation-time provenance')
    proof = {'mode':'generation-start-and-end','inputs':start,'state':'running',
             'blender_version':bpy.app.version_string,
             'blender_build_hash':bpy.app.build_hash.decode()}
    path.write_text(json.dumps(proof,indent=2))
    render_contributions.OUTPUT = directory
    render_contributions.run()
    if inputs() != start:
        raise ValueError('Render dependency changed during generation')
    settings = bpy.context.scene.view_settings
    proof.update(state='complete',color_management={
        'view_transform':settings.view_transform,'look':settings.look,
        'exposure':settings.exposure,'gamma':settings.gamma})
    path.write_text(json.dumps(proof,indent=2))


if __name__ == '__main__':
    if '--capture-existing' in sys.argv:
        capture_existing(BASE/'review/contributions-01')
    elif '--verify' in sys.argv:
        verify(BASE/'review/contributions-01')
        print('PASS: supplemental dependencies match the recorded post-render evidence')
    else:
        if '--' not in sys.argv or len(sys.argv[sys.argv.index('--')+1:]) != 1:
            raise SystemExit('Blender usage: --python render_provenance.py -- ABSOLUTE_NEW_BATCH_DIRECTORY')
        render(Path(sys.argv[-1]).resolve())
