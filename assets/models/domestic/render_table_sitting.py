"""Render the fitted dining pose at rest without food or utensils."""
import hashlib
import json
import math
from pathlib import Path
import sys
import bpy

BASE=Path(__file__).resolve().parent
sys.path[:0]=[str(BASE.parent/'furniture'),str(BASE.parent/'sims/sim-01')]
from animation_export import render_pass
from render_shirt_variants import material_snapshot,set_shirt_colors,SHIRT_COLORS

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    assert bpy.app.background
    out=BASE/'table-sitting';out.mkdir(exist_ok=True)
    source=BASE/'seated-dining.blend'
    proof={'state':'running','source_sha256':digest(source),'producer_sha256':digest(Path(__file__)),
           'anchor':json.loads((BASE/'seated-dining/proof.json').read_text())['anchor'],'renders':[]}
    receipt=out/'proof.json'
    assert not receipt.exists(),'Use a fresh output for another art revision'
    receipt.write_text(json.dumps(proof,indent=2))
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene=bpy.context.scene;scene.frame_set(1)
    rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    before=[list(v) for bone in rig.pose.bones for v in bone.matrix]
    hidden=[]
    for name in ('Carried dinner','Dinner on table','Eating spoon','Cooking spoon'):
        root=bpy.data.objects.get(name)
        if root:
            for obj in [root,*root.children_recursive]:
                obj.driver_remove('hide_render');obj.hide_render=True;hidden.append(obj.name)
    bpy.context.view_layer.update()
    assert before==[list(v) for bone in rig.pose.bones for v in bone.matrix]
    proof['hidden_props']=hidden
    scene.render.threads_mode='FIXED';scene.render.threads=2
    body=bpy.data.collections['Seated dining body'];furniture=bpy.data.collections['Seated dining furniture']
    chair=bpy.data.objects['Seated dining chair']
    materials=material_snapshot()
    for variant in ('green','blue','red'):
        if variant!='green':set_shirt_colors(SHIRT_COLORS[variant],materials)
        for facing,degrees in {'SE':90,'SW':0,'NW':270,'NE':180}.items():
            angle=math.radians(degrees);rig.rotation_euler.z=angle-math.pi/2;chair.rotation_euler.z=angle
            for owner in ('beauty','sim','furniture','lines'):
                path=out/f'{variant}-{facing}-{owner}.png'
                render_pass(scene,body,furniture,owner,path,separate_lines=True)
                proof['renders'].append({'variant':variant,'facing':facing,'owner':owner,'path':path.name,'sha256':digest(path)})
                receipt.write_text(json.dumps(proof,indent=2))
    proof['state']='complete';receipt.write_text(json.dumps(proof,indent=2))

if __name__=='__main__':main()
