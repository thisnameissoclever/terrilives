"""Render only the exact saved chain scene after a memory interruption."""
import gc
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

HERE=Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path,output):
    if not bpy.app.background or output.exists() or not output.is_absolute():
        raise ValueError('Background mode and a new absolute output directory are required')
    manifest=json.loads(manifest_path.read_text())
    inputs=dict(manifest['inputs'])
    inputs[str(manifest_path)]=digest(manifest_path)
    if any(digest(p)!=sha for p,sha in inputs.items()):
        raise ValueError('Frozen continuation input changed')
    output.mkdir(exist_ok=False)
    began=time.monotonic()
    report=dict(state='running',pid=os.getpid(),inputs=inputs,renders=[],acceptance=False,
        scope='Four exact-camera beauty views of the unchanged saved chain scene; geometry diagnostics run separately',
        blender_version=bpy.app.version_string)
    def save():
        report['elapsed_seconds']=time.monotonic()-began
        (output/'proof.json').write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        directory=HERE/'seated-pose-chain-01/raw'
        prior=json.loads((directory/'proof.json').read_text())
        cameras=json.loads((HERE/'seated-pose-mixed-02/raw/proof.json').read_text())['renders']
        if len(cameras)!=4:
            raise ValueError('Require the four frozen cameras')
        binding=json.loads((HERE/'sofa-derived-binding-03/proof.json').read_text())
        bpy.ops.wm.open_mainfile(filepath=str(directory/'authored-mixed-sofa.blend'))
        rigs=[bpy.data.objects[name] for name in binding['rest_contexts']['original']['restoration']['after_visibility']['rigs']]
        bpy.context.view_layer.update()
        report['full_frame_reload_errors']=[]
        bodies=[]
        for rig,state in zip(rigs,prior['full_states']):
            error=max(float(np.abs(np.asarray(rig.pose.bones[name].matrix)-value).max()) for name,value in state['bone_matrices'].items())
            world_error=float(np.abs(np.asarray(rig.matrix_world)-state['rig_matrix_world']).max())
            if max(error,world_error)>1e-5:
                raise ValueError('Saved full frame changed on reload')
            report['full_frame_reload_errors'].append(dict(bones=error,world=world_error))
            found=[c for c in bpy.data.collections if any(o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers) for o in c.objects)]
            if len(found)!=1:
                raise ValueError('Ambiguous saved actor ownership')
            bodies.append(found[0])
        collections=[(str(i),body) for i,body in enumerate(bodies)]+[('furniture',bpy.data.collections['Witness furniture'])]
        errors=[]
        # Verify one mesh at a time; keep no duplicate Surface objects or collision trees.
        with np.load(directory/'authored-geometry.npz') as cache:
            deps=bpy.context.evaluated_depsgraph_get()
            for prefix,collection in collections:
                expected={key[len(prefix)+1:-len('/points')] for key in cache.files if key.startswith(prefix+'/') and key.endswith('/points')}
                objects=[o for o in collection.all_objects if o.type=='MESH' and not o.hide_render]
                if {o.get('probe_source_name',o.name) for o in objects}!=expected:
                    raise ValueError('Saved visible mesh inventory changed')
                for obj in objects:
                    name=obj.get('probe_source_name',obj.name)
                    evaluated=obj.evaluated_get(deps)
                    mesh=evaluated.to_mesh()
                    try:
                        mesh.calc_loop_triangles()
                        points=np.asarray([list(evaluated.matrix_world@v.co) for v in mesh.vertices])
                        triangles=np.asarray([tuple(t.vertices) for t in mesh.loop_triangles],dtype=np.int32)
                        error=float(np.linalg.norm(points-cache[f'{prefix}/{name}/points'],axis=1).max())
                        equal=bool(np.array_equal(triangles,cache[f'{prefix}/{name}/triangles']))
                        if not np.isfinite(points).all() or error>1e-5 or not equal:
                            raise ValueError('Saved geometry changed: '+prefix+'/'+name)
                        errors.append(dict(owner=prefix,part=name,maximum_error=error,ordered_triangles_equal=equal))
                    finally:
                        evaluated.to_mesh_clear()
                    del points,triangles,mesh,evaluated
        del cache,deps,objects,collections
        gc.collect()
        report.update(geometry_reload=errors,
            inherited_source_proof=dict(path=str(directory/'proof.json'),sha256=digest(directory/'proof.json'),
                source_identity_equal=prior['source_identity_equal'],scope='Completed source/frame subset of interrupted writer, not a completed whole-scene receipt'),
            released_before_render=['Closed geometry archive','Per-mesh point and triangle arrays','Temporary evaluated meshes'],
            retained_geometry_checks='Full mesh inventory, all evaluated vertices and ordered triangles checked without retaining a second scene copy')
        save()
        scene=bpy.context.scene
        scene.render.threads_mode='FIXED'
        scene.render.threads=2
        scene.render.film_transparent=True
        scene.render.image_settings.file_format='PNG'
        scene.render.image_settings.color_mode='RGBA'
        scene.render.image_settings.color_depth='8'
        for old in cameras:
            if time.monotonic()-began>180:
                raise TimeoutError('Four-view continuation ceiling exhausted')
            camera=scene.camera
            camera.matrix_world=Matrix(old['camera_matrix'])
            camera.data.ortho_scale=old['camera_scale']
            size=old['native_size']
            scene.render.resolution_x,scene.render.resolution_y=(v*8 for v in size)
            scene.render.resolution_percentage=100
            bpy.context.view_layer.update()
            path=output/(old['name']+'.png')
            scene.render.filepath=str(path)
            start=time.monotonic()
            bpy.ops.render.render(write_still=True)
            report['renders'].append(dict(name=old['name'],native_size=size,source_density=8,
                camera_matrix=[list(r) for r in camera.matrix_world],camera_scale=camera.data.ortho_scale,
                image=dict(path=path.name,sha256=digest(path)),seconds=time.monotonic()-start,
                labels=['UNACCEPTED analytic chain comparison; known grip gap and outer sitting gestures unchanged',
                        'Source/frame evidence inherited and saved scene verified; complete geometry diagnostics are separate']))
            save()
        report.update(state='complete',diagnostic_render_count=4)
    except BaseException as error:
        report.update(state='failed',error=repr(error))
        raise
    finally:
        report['inputs_unchanged']=all(digest(p)==sha for p,sha in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed',error='Continuation input changed')
        save()


if __name__=='__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
