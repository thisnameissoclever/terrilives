"""Render the complete green interaction pilot without changing accepted scenes."""
import json
import math
from pathlib import Path
import sys
import traceback

import bpy

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
import animation_export as export
from geometry import FACINGS, pedal
from build_parts import set_crank_phase
from preview import rider_pose, project

OUTPUT = BASE/'review/animation-02'


def status(state, **fields):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'status.json').write_text(json.dumps({'state':state, **fields}, indent=2))


def run():
    assert bpy.app.background
    status('running', completed=0)
    source = export.SIM/'sim-01-rigged.blend'
    source_hash = export.digest(source)
    records = []
    proof = {'source_sha256':source_hash, 'density':8, 'logical_canvas':[96,120],
             'objects':{}, 'renders':records, 'state':'running'}
    for kind, count in (('bike',8),('chair',4)):
        scene, rig, root, movable, sim_collection, furniture_collection = export.scene_for(kind)
        scene.render.resolution_x, scene.render.resolution_y = 768, 960
        bpy.context.view_layer.update()
        proof['objects'][kind] = {'world_origin':project(scene,(0,0,0)), 'samples':count,
                                  'ortho_scale':scene.camera.data.ortho_scale}
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            rig.rotation_euler.z = math.radians(degrees)
            for index in range(count):
                if kind == 'bike':
                    rider_pose(rig,index/count)
                    set_crank_phase(movable,index/count)
                else:
                    rig.animation_data.action = bpy.data.actions['read']
                    scene.frame_set(index+1)
                bpy.context.view_layer.update()
                path = OUTPUT/f'{kind}-{facing}-{index}-beauty.png'
                export.render_pass(scene,sim_collection,furniture_collection,'beauty',path)
                row = {'path':path.name,'kind':kind,'facing':facing,'frame':index,
                       'sha256':export.digest(path)}
                if kind == 'bike':
                    row['pedal_contacts'] = {side:pedal(side,index/count) for side in ('L','R')}
                records.append(row)
                status('running',completed=len(records),total=48,last=path.name)
    assert export.digest(source) == source_hash, 'Accepted source changed'
    proof['state'] = 'complete'
    (OUTPUT/'proof.json').write_text(json.dumps(proof,indent=2))
    status('complete',completed=len(records),total=48)


if __name__ == '__main__':
    try:
        run()
    except Exception:
        status('failed',traceback=traceback.format_exc())
        raise
