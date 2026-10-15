"""Bake actor-free moving fixture states and preserve published static pixels."""
from pathlib import Path
import json
import math
import shutil
import subprocess
import sys
import tomllib
import traceback

import bpy
import numpy as np

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
MODELS = ROOT/'assets/models'
OUT = BASE/'components'
sys.path.insert(0, str(BASE))
from depth_geometry import Pages, digest, sample

FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}
SUPPORT = 3 + math.sqrt(.5)


def image_bytes(mode, source, target, dimensions):
    subprocess.run([shutil.which('python'), str(BASE/'color_pixels.py'), mode, str(source), str(target), *map(str, dimensions)],
                   check=True, capture_output=True)
    width, height = dimensions[-2:]
    return np.frombuffer(target.read_bytes(), dtype=np.uint8).reshape((height, width, 4)).copy()


def main():
    OUT.mkdir(exist_ok=True)
    atlas = tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    rows = {row['name']:(index,row) for index,row in enumerate(atlas['sprite'])}
    report = dict(version=1, state='running', encoding='rg-u16-unorm-x-minus-y-range-minus2-plus2',
                  sources={}, states=[], families={}, producerHashes={path.name:digest(path) for path in (Path(__file__),BASE/'depth_geometry.py',BASE/'color_pixels.py')})
    colors, depths = Pages(OUT, 'color'), Pages(OUT, 'depth')

    def save():
        (OUT/'manifest.json').write_text(json.dumps(report, indent=2), encoding='utf-8')

    def run_family(family, prefix, source, root, moving, states, apply, padding=(0,0,0,0), crop=(0,0), full_canvas=None):
        scene = bpy.context.scene
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.film_transparent = True
        scene.render.resolution_percentage = 100
        # Every capture contains only this fixture. Character poses do not
        # become baked holes or cast a fixed neutral character's shadow.
        children = set(root.children_recursive)
        fixture_collection = bpy.data.collections.new('Repair visible fixture')
        hidden_collection = bpy.data.collections.new('Repair hidden character')
        scene.collection.children.link(fixture_collection)
        scene.collection.children.link(hidden_collection)
        hidden_collection.hide_render = True
        for obj in bpy.data.objects:
            if obj.type in ('MESH','CURVE'):
                for collection in list(obj.users_collection):
                    collection.objects.unlink(obj)
                (fixture_collection if obj in children else hidden_collection).objects.link(obj)
                obj.hide_render = obj not in children
        source_hash = digest(source)
        report['sources'][family] = dict(path=source.relative_to(ROOT).as_posix(), sha256=source_hash)
        report['families'][family] = dict(prefix=prefix, movingParts=sorted(moving), states=states,
                                          colorPolicy='published-static-pixels-with-actor-free-authored-moving-surfaces')
        for facing, degrees in FACINGS.items():
            root.rotation_euler.z = math.radians(degrees)
            apply(0)
            bpy.context.view_layer.update()
            name = prefix + ('' if facing == 'SE' else facing)
            atlas_index, sprite = rows[name]
            width, height = sprite['w'] + (padding[0]+padding[2])*2, sprite['h'] + (padding[1]+padding[3])*2
            source_density = scene.render.resolution_y / (full_canvas[1] if full_canvas else height)
            stroke_width = max((line.linestyle.thickness for line in bpy.context.view_layer.freestyle_settings.linesets), default=0)
            # A Freestyle stroke extends outside its mesh before Lanczos3
            # adds its reconstruction skirt. Both contributions are authored.
            outline_support = SUPPORT + stroke_width * scene.render.line_thickness / source_density / 2
            original = image_bytes('crop', ROOT/'web/public'/atlas['pages'][sprite.get('page',0)], OUT/'source-pixels.rgba',
                                   [sprite['x'],sprite['y'],sprite['w'],sprite['h']])
            baseline = np.zeros((height,width,4),dtype=np.uint8)
            baseline[padding[1]*2:padding[1]*2+sprite['h'],padding[0]*2:padding[0]*2+sprite['w']] = original
            base_depth, _, base_ids, base_names = sample(root.children_recursive,width,height,baseline[:,:,3]>0,
                                                        canvas=full_canvas,crop=crop,max_edge_distance=outline_support)
            base_owner = np.empty((height,width), dtype=object)
            base_owner[:]=''
            valid = base_ids >= 0
            base_owner[valid] = np.asarray(base_names, dtype=object)[base_ids[valid]]
            for state in states:
                apply(state['sample'])
                bpy.context.view_layer.update()
                if state['sample'] == 0 and family in ('fridge','bike'):
                    pixels = baseline.copy()
                else:
                    render = OUT/f'{family}-{facing}-{state["id"]}-source.png'
                    scene.render.filepath = str(render)
                    bpy.ops.render.render(write_still=True)
                    if crop != (0,0):
                        resized = image_bytes('resize',render,OUT/'render-pixels.rgba',full_canvas)
                        pixels = resized[crop[1]:crop[1]+height,crop[0]:crop[0]+width].copy()
                    else:
                        pixels = image_bytes('resize',render,OUT/'render-pixels.rgba',[width,height])
                depth, proof, ids, names = sample(root.children_recursive,width,height,pixels[:,:,3]>0,
                                                 canvas=full_canvas,crop=crop,max_edge_distance=outline_support)
                owner = np.empty((height,width),dtype=object)
                owner[:]=''
                valid = ids >= 0
                owner[valid] = np.asarray(names,dtype=object)[ids[valid]]
                keep = (baseline[:,:,3]>0) & (pixels[:,:,3]>0) & (owner==base_owner) & ~np.isin(owner,list(moving))
                keep &= np.all(depth[:,:,:2] == base_depth[:,:,:2],axis=2)
                pixels[keep] = baseline[keep]
                if not np.array_equal(pixels[keep],baseline[keep]):
                    raise ValueError('Published static color bytes changed')
                color_record = colors.add(pixels)
                depth_record = depths.add(depth)
                if color_record != depth_record:
                    raise ValueError('Companion color and depth page registration diverged')
                key = family+'-'+facing+'-'+state['id']
                report['states'].append(dict(id=key,family=family,facing=facing,state=state['id'],sample=state['sample'],
                    atlasIndex=atlas_index,pixelDensity=sprite.get('pixel_density',1),
                    anchorOffset=[padding[0],padding[1]],color=color_record,depth=depth_record,
                    preservedStaticPixels=int(keep.sum()),staticColorMaxDifference=0,actorFree=True,
                    filterSupportPixels=3,sourceOutlineWidth=stroke_width,outlineSupportPixels=outline_support,
                    movingParts=sorted(moving),**proof))
                save()
                print(key,'component complete',flush=True)
        if digest(source) != source_hash:
            raise ValueError('Authored fixture source changed')

    try:
        source = MODELS/'kitchen/owner-review-pending/refrigerator/candidate-03/refrigerator-authoring.blend'
        bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
        sys.path[:0] = [str(MODELS/'kitchen/actions'),str(MODELS/'furniture'),str(MODELS/'sims/sim-01')]
        from render_fridge_reach import configure_canvas
        from fridge_reach_geometry import PADDING, DOOR_DEGREES
        configure_canvas(bpy.context.scene,PADDING)
        root=bpy.data.objects['REFRIGERATOR_MODEL_ROOT']
        hinge=bpy.data.objects['Refrigerator right hinge']
        moving={obj.name for obj in hinge.children_recursive if obj.type in ('MESH','CURVE')}
        def fridge_state(index):
            hinge.rotation_euler.z=math.radians(DOOR_DEGREES[index])
        states=[dict(id='closed',sample=0),dict(id='ajar20',sample=1),dict(id='ajar55',sample=2),dict(id='open',sample=3)]
        run_family('fridge','offlineFridge',source,root,moving,states,fridge_state,padding=PADDING)
        report['families']['fridge']['clipSamples']=['closed','ajar20','ajar55','open','open','open','open','closed']
        from animation_export import scene_for
        from build_parts import set_crank_phase
        scene,_,root,movable,_,_=scene_for('bike')
        # Match the published density-4 source render before Lanczos reduction.
        scene.render.resolution_x,scene.render.resolution_y=384,480
        moving={obj.name for _,arm,pedal in movable for obj in [arm,pedal,*pedal.children_recursive]}
        run_family('bike','offlineBike',MODELS/'sims/sim-01/sim-01-rigged.blend',root,moving,
                   [dict(id=str(index),sample=index) for index in range(8)],lambda index:set_crank_phase(movable,((-index)%8)/8))
        report['families']['bike']['clipSamples']=[str(index) for index in range(8)]
        for family,prefix,directory,root_name in [
            ('bed','offlineDoubleBed','bedroom/owner-review-pending/double-bed/candidate-02','DOUBLE-BED_MODEL_ROOT'),
            ('bunk','offlineBunk','bedroom/owner-review-pending/bunk/candidate-03','BUNK_MODEL_ROOT')]:
            source=next((MODELS/directory).glob('*.blend'))
            bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
            root=bpy.data.objects[root_name]
            moving={'Sage duvet','Folded duvet edge'}
            if family=='bunk':
                moving={obj.name for obj in root.children_recursive if 'duvet' in obj.name.lower() or 'cover' in obj.name.lower()}
            def bed_state(index):
                for obj in root.children_recursive:
                    if obj.name in moving:obj.hide_render=bool(index)
            report['families'].setdefault(family,{})
            run_family(family,prefix,source,root,moving,[dict(id='cover-removed',sample=1)],bed_state,
                       crop=(60,40) if family=='bunk' else (0,0),full_canvas=(320,352) if family=='bunk' else None)
            report['families'][family]['coverMaterials']=[dict(name=material.name,diffuse=list(material.diffuse_color),
                ramps=[[list(stop.color) for stop in node.color_ramp.elements] for node in material.node_tree.nodes if node.type=='VALTORGB'])
                for material in bpy.data.materials if 'duvet' in material.name.lower()]
        report['colorPages']=colors.save()
        report['depthPages']=depths.save()
        report['state']='complete'
        save()
    except Exception:
        report['state']='failed'
        report['error']=traceback.format_exc()
        save()
        raise


if __name__=='__main__':main()
