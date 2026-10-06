"""Render one independently checked profile with registered visible owner contributions."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import bpy
from mathutils import Matrix,Vector
from bpy_extras.object_utils import world_to_camera_view

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path.insert(0,str(ROOT/'assets/models/sims/sim-01'))
from render_shirt_variants import material_snapshot,set_shirt_colors,SHIRT_COLORS


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path,output):
    manifest=json.loads(manifest_path.read_text());inputs=dict(manifest['inputs'])
    inputs[str(manifest_path)]=digest(manifest_path)
    if not bpy.app.background or output.exists() or any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Reader subset requires background mode, new output and unchanged inputs')
    output.mkdir(exist_ok=False);began=time.monotonic()
    report=dict(state='running',pid=os.getpid(),inputs=inputs,renders=[],acceptance=False,
        scope='Independently checked center-reader contact seed; canonical one-body owner layers; four explicit static phase aliases')
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=manifest['source_scene'])
        rig=bpy.data.objects[manifest['rig']];body=bpy.data.collections[manifest['body_collection']]
        furniture=bpy.data.collections['Witness furniture']
        scene=bpy.context.scene;layer=bpy.context.view_layer
        rotation=Matrix.Rotation(manifest['facing_radians'],4,'Z')
        rig.matrix_world=rotation@rig.matrix_world
        for obj in furniture.all_objects:
            if obj.type in('MESH','CURVE'):
                obj.matrix_world=rotation@obj.matrix_world
        scene.camera.matrix_world=Matrix(manifest['camera_matrix'])
        scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=manifest['ortho_scale']
        scene.render.resolution_x,scene.render.resolution_y=(v*8 for v in manifest['canvas'])
        scene.render.resolution_percentage=100;scene.render.threads_mode='FIXED';scene.render.threads=2
        scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG'
        scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8'
        bpy.context.view_layer.update()
        marker=world_to_camera_view(scene,scene.camera,rig.matrix_world@rig.pose.bones['head'].head+Vector((0,0,.34)))
        report.update(content=manifest['content'],stableSeatIds=['seat_1'],stage=manifest['stage'],
            occupiedSeat='seat_1',facing=manifest['facing'],canvas=manifest['canvas'],anchor=manifest['anchor'],
            camera_matrix=manifest['camera_matrix'],ortho_scale=manifest['ortho_scale'],source_density=8,
            marker=[marker.x*manifest['canvas'][0],(1-marker.y)*manifest['canvas'][1]],
            phase_aliases=[0,0,0,0],physical_receipt=manifest['physical_receipt'])
        materials=material_snapshot()
        def render(owner,palette):
            if time.monotonic()-began>180:
                raise TimeoutError('Reader subset source ceiling exhausted')
            fill=owner in('body','furniture')
            layer.layer_collection.children[body.name].holdout=fill and owner!='body'
            layer.layer_collection.children[furniture.name].holdout=fill and owner!='furniture'
            for lines in layer.freestyle_settings.linesets:
                lines.select_by_collection=owner=='bodyInk'
                if owner=='bodyInk':
                    lines.collection=body;lines.collection_negation='INCLUSIVE'
            scene.render.use_freestyle=not fill
            ink=owner in('sharedInk','bodyInk')
            layer.freestyle_settings.as_render_pass=ink;scene.use_nodes=ink
            if ink:
                tree=scene.node_tree;tree.nodes.clear()
                source=tree.nodes.new('CompositorNodeRLayers');target=tree.nodes.new('CompositorNodeComposite')
                tree.links.new(source.outputs['Freestyle'],target.inputs['Image'])
            path=output/(palette+'-'+owner+'.png');scene.render.filepath=str(path)
            start=time.monotonic();bpy.ops.render.render(write_still=True)
            report['renders'].append(dict(palette=palette,owner=owner,path=path.name,sha256=digest(path),seconds=time.monotonic()-start))
            save()
        for palette in('green','blue','red'):
            if palette!='green':
                set_shirt_colors(SHIRT_COLORS[palette],materials)
            for owner in (('beauty','body','furniture','sharedInk','bodyInk') if palette=='green' else ('beauty','body')):
                render(owner,palette)
        report.update(state='complete',render_count=9)
    except BaseException as error:
        report.update(state='failed',error=repr(error));raise
    finally:
        report['inputs_unchanged']=all(digest(p)==sha for p,sha in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed',error='Reader source input changed')
        save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
