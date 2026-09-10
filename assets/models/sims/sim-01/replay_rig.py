"""Prove that the saved editable actions reproduce selected exported renders."""
import bpy
import hashlib
import json
import math
import sys
import traceback
import numpy as np
from pathlib import Path

BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
from render_job import apply_render_job
FACINGS={'SE':90,'SW':0,'NW':270,'NE':180}


def replay():
    assert bpy.app.background
    (BASE/'saved-rig-render-replay.json').write_text(json.dumps({'state':'running'}))
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'sim-01-rigged.blend'))
    scene=bpy.context.scene
    rig=bpy.data.objects['SIM_01_SHARED_RIG']
    registration=json.loads((BASE/'registered-canvas-proof.json').read_text())
    directory=BASE/'review/saved-rig-replay'
    directory.mkdir(exist_ok=True)
    proof=[]
    for action,facing,index in (('idle','SE',0),('walk','SW',2),('read','SE',0),('eat','SE',2)):
        fingerprint=apply_render_job(scene,rig,registration,action,facing,index)
        filename=f'{action}-{facing}-{index}.png'
        path=directory/filename
        scene.render.filepath=str(path)
        bpy.ops.render.render(write_still=True)
        hashes=[]
        for candidate in (BASE/'review'/filename,path):
            image=bpy.data.images.load(str(candidate),check_existing=False)
            pixels=np.empty(len(image.pixels),dtype=np.float32)
            image.pixels.foreach_get(pixels)
            hashes.append(hashlib.sha256(pixels.tobytes()).hexdigest())
            bpy.data.images.remove(image)
        expected,actual=hashes
        proof.append({'frame':filename,'expected_decoded_sha256':expected,
                      'decoded_rgba_float_sha256':actual,'matches':expected==actual,
                      'state':fingerprint})
    matches=all(frame['matches'] for frame in proof)
    (BASE/'saved-rig-render-replay.json').write_text(json.dumps({'state':'complete' if matches else 'failed','frames':proof},indent=2)+'\n')
    if not matches:
        raise RuntimeError('Decoded render mismatch: '+', '.join(frame['frame'] for frame in proof if not frame['matches']))


if __name__=='__main__':
    try:
        replay()
    except Exception:
        target=BASE/'saved-rig-render-replay.json'
        result=json.loads(target.read_text()) if target.exists() else {}
        result.update(state='failed',traceback=traceback.format_exc())
        target.write_text(json.dumps(result,indent=2))
        raise
