"""Inspect explicit production scenes without saving or rendering them."""
from pathlib import Path
import hashlib
import json
import bpy

BASE=Path(__file__).resolve().parent
MODELS=BASE.parents[1]
SOURCES={
    'base':'sims/sim-01/sim-01-rigged.blend',
    'exercise':'sims/sim-01/sim-01-exercise.blend',
    'prepare':'sims/sim-01/sim-01-domestic.blend',
    'cooking':'domestic/dining.blend',
    'dining':'domestic/seated-dining.blend',
    'dishes':'domestic/cleanup.blend',
    'cleaning':'cleaning/cleaning.blend',
    'toilet':'bathroom/actions/review/toilet/loop-01/toilet-loop-authoring.blend',
    'bath':'bathroom/actions/review/bath/loop-02/bath-loop-authoring.blend',
    'recline':'reading/recline/producer/editable/source.blend',
}
def matrix(value):return [float(value[row][col]) for col in range(4) for row in range(4)]
def run():
    rows={}
    for name,relative in SOURCES.items():
        path=MODELS/relative
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        bpy.ops.wm.open_mainfile(filepath=str(path),load_ui=False,use_scripts=False)
        rigs=[]
        for obj in bpy.data.objects:
            if obj.type!='ARMATURE':continue
            rigs.append(dict(name=obj.name,matrix=matrix(obj.matrix_world),action=obj.animation_data.action.name if obj.animation_data and obj.animation_data.action else None,
                bones=[dict(name=bone.name,parent=bone.parent.name if bone.parent else None,rest=matrix(bone.matrix_local)) for bone in obj.data.bones]))
        objects=[dict(name=obj.name,type=obj.type,parent=obj.parent.name if obj.parent else None,matrix=matrix(obj.matrix_world),
            action=obj.animation_data.action.name if obj.animation_data and obj.animation_data.action else None,
            collections=[collection.name for collection in obj.users_collection],hide=obj.hide_render) for obj in bpy.data.objects if obj.type not in ['CAMERA','LIGHT']]
        rows[name]=dict(path=relative,sha256=before,rigs=rigs,objects=objects,
            actions=[dict(name=action.name,frames=list(action.frame_range),samples=action.get('loop_samples')) for action in bpy.data.actions])
        assert hashlib.sha256(path.read_bytes()).hexdigest()==before
        (BASE/'clip-inventory.json').write_text(json.dumps(rows,indent=2))
    (BASE/'clip-inventory-status.json').write_text(json.dumps({'state':'complete','sources':len(rows)}))
if __name__=='__main__':run()
