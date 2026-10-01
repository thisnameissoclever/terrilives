"""Read the saved action's cadence without saving or rendering the scene."""
import hashlib
import json
import os
from pathlib import Path

import bpy

BASE = Path(__file__).resolve().parent/'ottoman-sit-candidate-02'
MODEL = BASE/'ottoman-sit-authoring.blend'
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
before = digest(MODEL)
assert bpy.app.background
bpy.ops.wm.open_mainfile(filepath=str(MODEL))
action = bpy.data.objects['SIM_01_SHARED_RIG'].animation_data.action
assert action.name == 'ottoman_sit'
samples, fps = action['loop_samples'], action['sample_fps']
assert samples == 4 and fps == 2
assert digest(MODEL) == before
(BASE/'action-cadence.json').write_text(json.dumps({
    'state': 'complete', 'pid': os.getpid(), 'action': action.name,
    'loop_samples': samples, 'sample_fps': fps, 'model_sha256': before,
    'reader_sha256': digest(Path(__file__)), 'source_unchanged': True,
}, indent=2)+'\n')
