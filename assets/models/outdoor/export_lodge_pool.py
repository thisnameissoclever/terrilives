"""Build and render the wood-sided 3 by 4 pool using the registered game camera."""
import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent
sys.path[:0] = [str(HERE), str(MODELS / 'furniture')]
from build_parts import box, material, mesh
from registered_pool_art import evaluated, render, ripple_surface, sha
from pool_activity_layout_v9 import corners, shell
from pool_activity_model_v8 import replace_mesh

CANVAS = (256, 224)
ORIGIN = (.5, -1)
BASELINE = HERE / 'owner-review-pending/pool/activity-v9/pool-authoring.blend'
WALL = (-.94, 1.94, -2.94, .39)
LINER = (-.86, 1.86, -2.86, .31)
COPING = (-.96, 1.96, -2.96, .41)
OPENING = (-.85, 1.85, -2.85, .30)
WATER = (-.865, 1.865, -2.865, .315)


def water_surface(obj):
    ripple_surface(obj, WATER, .82, 5, 8)
    obj.data.materials[0] = material('Lodge deep teal water', (.023, .25, .28))
    obj.data.materials[1] = material('Lodge water reflections', (.32, .66, .65))


def stair_beam(root, name, x, a, b, width, thickness, finish):
    start, end = Vector((x, *a)), Vector((x, *b))
    beam = box(name, (start + end)/2, (width, thickness, (end-start).length), finish, root, 0)
    beam.rotation_euler = (end-start).to_track_quat('Z', 'Y').to_euler()


def build(root):
    baseline = {row['id']: row for row in evaluated(root)}
    objects = {obj.name: obj for obj in root.children_recursive}
    for obj in list(objects.values()):
        if (obj.name.startswith('Pool ladder rail') or obj.name.startswith('Pool wall trim')):
            bpy.data.objects.remove(obj, do_unlink=True)
    wall = objects['Pool wall']
    replace_mesh(wall, *shell(WALL, LINER, 0, .865))
    wall.data.materials[0] = material('Lodge walnut siding', (.30, .147, .076))
    coping = objects['Pool stone coping']
    verts, faces, _ = shell(COPING, OPENING, .865, .90)
    replace_mesh(coping, verts, faces, [0]*len(faces), bevel=.003)
    coping.data.materials[0] = material('Lodge sandstone coping', (.66, .59, .45))
    replace_mesh(objects['Pool basin floor'], corners(LINER,.06), [(0,1,2,3)], [0])
    water_surface(objects['Pool water surface'])
    seam = material('Lodge board seams', (.12, .061, .031))
    upright = material('Lodge oak uprights', (.48, .286, .154))
    tread = material('Lodge oak steps', (.55, .34, .18))
    handrail = material('Lodge brushed bronze railing', (.66, .57, .40))
    for index in range(1, 7):
        v,f,_ = shell((WALL[0]-.002,WALL[1]+.002,WALL[2]-.002,WALL[3]+.002),
                      (WALL[0]+.008,WALL[1]-.008,WALL[2]+.008,WALL[3]-.008), .123*index, .123*index+.012)
        mesh(f'Lodge board seam {index}',v,f,seam,root)
    for side,y in [('front',WALL[3]+.005),('rear',WALL[2]-.005)]:
        for index,x in enumerate((WALL[0]+.045,.5,WALL[1]-.045)):
            box(f'Lodge {side} upright {index+1}', (x,y,.43),(.056,.014,.85),upright,root,0)
    for side,x in [('left',WALL[0]-.005),('right',WALL[1]+.005)]:
        for index,y in enumerate((WALL[2]+.045,(WALL[2]+WALL[3])/2,WALL[3]-.045)):
            box(f'Lodge {side} upright {index+1}',(x,y,.43),(.014,.056,.85),upright,root,0)
    for name,obj in objects.items():
        if 'outside ladder tread' in name or name == 'Pool ladder crest landing':
            obj.data.materials[0] = tread
    # Wider stringers keep the tread ends seated and carry the offset rail posts.
    for side, x, stringer_x in [('left', -.905, -.8825), ('right', -.095, -.1175)]:
        stair_beam(root, f'Lodge {side} oak stringer', stringer_x,
                   (.969,.035), (.405,.985), .098, .06, upright)
        box(f'Lodge {side} landing stringer', (stringer_x, .193, .9625),
            (.098, .48, .075), upright, root, 0)
        stair_beam(root, f'Lodge {side} bottom post',x,(.943,.11),(.943,.40),.034,.034,handrail)
        stair_beam(root, f'Lodge {side} sloping handrail',x,(.943,.40),(.415,1.27),.034,.034,handrail)
        stair_beam(root, f'Lodge {side} landing handrail',x,(.42,1.27),(-.03,1.27),.034,.034,handrail)
        stair_beam(root, f'Lodge {side} crest post',x,(-.03,1.0),(-.03,1.27),.034,.034,handrail)
    bpy.context.view_layer.update()
    solids = evaluated(root)
    for s in solids:
        a,b = s['bounds']
        if a[0]<-1 or b[0]>2 or a[1]<-3 or b[1]>1:
            raise ValueError(f"{s['id']} leaves the assigned footprint: {s['bounds']}")
        if ('ladder tread' in s['id'] or s['id']=='Pool ladder crest landing') and s != baseline[s['id']]:
            raise ValueError(f"Installed forefoot surface changed: {s['id']}")
    return solids


def export(out):
    out.mkdir(parents=True,exist_ok=False)
    baseline_proof = BASELINE.with_name('proof.json')
    if json.loads(baseline_proof.read_bytes())['model_sha256'] != sha(BASELINE):
        raise ValueError('The fitted source pool differs from its registered render')
    bpy.ops.wm.open_mainfile(filepath=str(BASELINE), load_ui=False, use_scripts=False)
    root = bpy.data.objects['POOL_MODEL_ROOT']
    model_scene = next(s for s in bpy.data.scenes if root.name in s.objects)
    bpy.context.window.scene = model_scene
    solids = build(root)
    model = out/'pool-authoring.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(model), check_existing=False)
    geometry = dict(modelSha256=sha(model), origin=ORIGIN, approach=[-.5,1.5,0],
                    waterHeight=.82, water=WATER, solids=solids)
    (out/'geometry.json').write_text(json.dumps(geometry,separators=(',',':')),encoding='utf8')
    inputs = [Path(__file__), BASELINE, baseline_proof, MODELS/'furniture/build_parts.py', HERE/'pool_activity_layout_v9.py',
              HERE/'pool_activity_model_v8.py', MODELS/'furniture/geometry.py']
    render(out,root,model,inputs,canvas=CANVAS,footprint=[4,3],origin_xy=ORIGIN,water_z=.82)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    export(parser.parse_args(sys.argv[sys.argv.index('--')+1:]).output.resolve())
