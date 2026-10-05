"""Reopen every saved sample at final registration and measure fish envelopes."""
import hashlib
import json
from pathlib import Path
import sys
import bpy

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'bathroom'), str(BASE.parent/'kitchen')]
from check_aquarium_scene import validate


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 1 or not bpy.app.background:
        raise ValueError('Use background Blender with an absolute batch directory')
    directory = Path(args[0])
    if not directory.is_absolute():
        raise ValueError('Use an absolute batch directory')
    for frame in range(8):
        source = directory/f'frame-{frame}'
        output = source/'scene-check.json'
        if output.exists():
            raise ValueError('Preserve the existing scene-check result')
        proof = json.loads((source/'proof.json').read_text())
        model = source/f'aquarium-swim-{frame}-authoring.blend'
        before = hashlib.sha256(model.read_bytes()).hexdigest()
        if before != proof['model_sha256']:
            raise ValueError('Swimming model changed after rendering')
        bpy.ops.wm.open_mainfile(filepath=str(model))
        result = validate()
        if hashlib.sha256(model.read_bytes()).hexdigest() != before:
            raise ValueError('Validation altered the swimming model')
        output.write_text(json.dumps({**result, 'model_sha256': before}, indent=2)+'\n')
