"""Measure source skin-before-subdivision against the first runtime export's order."""
from pathlib import Path
import hashlib
import json
import traceback
import bpy
from mathutils import Vector

BASE=Path(__file__).resolve().parent
SOURCE=BASE.parent/'sim-01/sim-01-rigged.blend'
REPORT=BASE/'export/subdivision-parity-before.json'


def run():
    before=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE),load_ui=False,use_scripts=False)
    rig=bpy.data.objects['SIM_01_SHARED_RIG']
    parts=[o for o in bpy.data.objects if o.type=='MESH' and len(o.vertex_groups)>1
           and any(m.type=='SUBSURF' for m in o.modifiers)]
    rest={}
    for obj in parts:
        arm=next(m for m in obj.modifiers if m.type=='ARMATURE');arm.show_viewport=False
        bpy.context.view_layer.update();graph=bpy.context.evaluated_depsgraph_get()
        evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=graph)
        rest[obj.name]=[(obj.matrix_world@v.co,[(obj.vertex_groups[g.group].name,g.weight) for g in v.groups if g.weight>0]) for v in mesh.vertices]
        evaluated.to_mesh_clear();arm.show_viewport=True
    rows=[]
    for action,frame in [('idle',1),('walk',4),('read',1)]:
        rig.animation_data.action=bpy.data.actions[action];bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
        transforms={b.name:rig.pose.bones[b.name].matrix@b.matrix_local.inverted() for b in rig.data.bones}
        for obj in parts:
            evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
            errors=[]
            for vertex,(point,weights) in zip(mesh.vertices,rest[obj.name]):
                approximate=sum((transforms[name]@point*weight for name,weight in weights),Vector())
                actual=obj.matrix_world@vertex.co
                errors.append((actual-approximate).length)
            rows.append(dict(action=action,frame=frame,part=obj.name,vertices=len(errors),maxError=max(errors),meanError=sum(errors)/len(errors)))
            evaluated.to_mesh_clear()
    REPORT.write_text(json.dumps(dict(state='complete',sourceUnchanged=hashlib.sha256(SOURCE.read_bytes()).hexdigest()==before,
        convention='Model-space Euclidean vertex error; no render or source edits',rows=rows),indent=2))


if __name__=='__main__':
    try: run()
    except Exception:
        REPORT.write_text(json.dumps(dict(state='failed',error=traceback.format_exc()),indent=2));raise
