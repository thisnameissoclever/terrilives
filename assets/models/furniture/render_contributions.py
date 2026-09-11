"""Render registered interaction contributions from the reviewed physical scene."""
import json
import math
from pathlib import Path
import sys
import traceback

import bpy

BASE = Path(__file__).resolve().parent
SIM = BASE.parent/'sims/sim-01'
sys.path[:0] = [str(BASE),str(SIM)]
from animation_export import scene_for, render_pass, digest
from build_parts import set_crank_phase
from geometry import FACINGS
from preview import rider_pose, project
from render_shirt_variants import SHIRT_COLORS, material_snapshot, set_shirt_colors

OUTPUT = BASE/'review/contributions-01'


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value,indent=2))
    temporary.replace(path)


def run():
    assert bpy.app.background
    OUTPUT.mkdir(parents=True,exist_ok=True)
    source = SIM/'sim-01-rigged.blend'
    signature = {'source_sha256':digest(source), 'density':8, 'logical_canvas':[96,120],
                 'scripts':{name:digest(BASE/name) for name in
                 ('render_contributions.py','animation_export.py','build_parts.py','geometry.py','preview.py')}}
    proof_path = OUTPUT/'raw-proof.json'
    proof = {'signature':signature,'state':'running','renders':[],'anchor':None}
    if proof_path.exists():
        previous = json.loads(proof_path.read_text())
        if previous['signature'] != signature:
            raise ValueError('Render sources changed; use a new batch directory')
        proof = previous
    existing = {row['path']:row for row in proof['renders']}
    for name,row in existing.items():
        if digest(OUTPUT/name) != row['sha256']:
            raise ValueError(f'Render checkpoint changed: {name}')
    total = 584
    def render(scene, sim, furniture, kind, facing, variant, index, owner):
        filename = f'{kind}-{variant}-{facing}-{index}-{owner}.png'
        if filename in existing:
            return
        render_pass(scene,sim,furniture,'beauty' if owner=='empty' else owner,
                    OUTPUT/filename,separate_lines=True)
        row = {'path':filename,'object':kind,'facing':facing,'variant':variant,
               'frame':index,'owner':owner,'sha256':digest(OUTPUT/filename)}
        proof['renders'].append(row)
        existing[filename] = row
        write_json(proof_path,proof)
        write_json(OUTPUT/'status.json',{'state':'running','completed':len(existing),'total':total,'last':filename})
    write_json(OUTPUT/'status.json',{'state':'running','completed':len(existing),'total':total})
    for kind,count in (('bike',8),('chair',4)):
        for variant in ('green','blue','red'):
            scene,rig,root,movable,sim,furniture = scene_for(kind)
            scene.render.resolution_x,scene.render.resolution_y = 768,960
            if variant != 'green':
                set_shirt_colors(SHIRT_COLORS[variant],material_snapshot())
            bpy.context.view_layer.update()
            origin = project(scene,(0,0,0))
            anchor = [origin[0]/8,origin[1]/8+21]
            if proof['anchor'] is not None and max(abs(a-b) for a,b in zip(anchor,proof['anchor'])) > 1e-5:
                raise ValueError('Camera registration changed across render groups')
            proof['anchor'] = anchor
            for facing,degrees in FACINGS.items():
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
                    if variant == 'green' and index == 0:
                        sim.hide_render = True
                        render(scene,sim,furniture,kind,facing,variant,index,'empty')
                        sim.hide_render = False
                    for owner in ('beauty','sim','furniture','lines'):
                        render(scene,sim,furniture,kind,facing,variant,index,owner)
    if len(existing) != total or digest(source) != signature['source_sha256']:
        raise ValueError('Incomplete batch or changed accepted source')
    proof['state'] = 'complete'
    write_json(proof_path,proof)
    write_json(OUTPUT/'status.json',{'state':'complete','completed':len(existing),'total':total})


if __name__ == '__main__':
    try:
        run()
    except Exception:
        OUTPUT.mkdir(parents=True,exist_ok=True)
        write_json(OUTPUT/'status.json',{'state':'failed','traceback':traceback.format_exc()})
        raise
