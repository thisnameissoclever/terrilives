"""Replay two retained rejected scenes exactly and render six diagnostic beauties."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_grip_original_replay as book
import probe_sofa_resting_clearance as sofa


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(manifest_path, output):
    if not bpy.app.background or not output.is_absolute() or output.exists():
        raise ValueError('Require background Blender and a new absolute output directory')
    manifest = json.loads(manifest_path.read_text())
    inputs = dict(manifest['inputs'])
    inputs[str(manifest_path)] = digest(manifest_path)
    for path, expected in inputs.items():
        if digest(path) != expected:
            raise ValueError('Immutable input mismatch: ' + path)
    output.mkdir(parents=True, exist_ok=False)
    report = dict(state='running', pid=os.getpid(), inputs=inputs, renders=[], scenes=[],
                  acceptance=False, scope=manifest['scope'], blender_version=bpy.app.version_string,
                  blender_build_hash=bpy.app.build_hash.decode(), limits=manifest['limits'])
    started = time.monotonic()

    def save():
        report['elapsed_seconds'] = time.monotonic() - started
        (output / 'proof.json').write_text(json.dumps(report, indent=2) + '\n')

    def geometry_check(surfaces, cache, prefix):
        expected_names = {key[len(prefix):-len('/points')] for key in cache.files
                          if key.startswith(prefix) and key.endswith('/points')}
        if set(surfaces) != expected_names:
            raise ValueError('Visible geometry inventory differs from retained scene')
        errors = {}
        for name, surface in surfaces.items():
            key = prefix + name
            points = np.asarray(surface.points)
            if points.shape != cache[key + '/points'].shape:
                raise ValueError('Vertex count changed: ' + name)
            error = float(np.linalg.norm(points-cache[key + '/points'], axis=1).max())
            topology = bool(np.array_equal(surface.triangles, cache[key + '/triangles']))
            errors[name] = dict(maximum_error=error, ordered_triangles_equal=topology)
            if error > 1e-5 or not topology:
                raise ValueError('Retained geometry mismatch: ' + name)
        return errors

    def render(name, surfaces, camera_rotation, pixels_per_unit, close=False, source_density=16):
        if len(report['renders']) >= 6 or time.monotonic()-started > 300:
            raise TimeoutError('Six-render / 300-second diagnostic budget exhausted')
        scene = bpy.context.scene
        camera = scene.camera
        camera.data.type = 'ORTHO'
        camera.rotation_euler = camera_rotation.to_euler()
        selected = surfaces
        if close:
            selected = {n:s for n,s in surfaces.items() if n.startswith(book.ARM+book.PROP)
                        or any(t in n.lower() for t in ('head', 'eye', 'face', 'hair', 'ear', 'nose', 'mouth', 'lip', 'chin'))}
        points = np.concatenate([np.asarray(s.points) for s in selected.values()])
        inverse_rotation = np.asarray(camera_rotation).T
        projected = points @ inverse_rotation.T
        center = (projected.min(0) + projected.max(0)) / 2
        center_world = np.asarray(camera_rotation) @ center
        camera.location = Vector(center_world) + camera_rotation @ Vector((0, 0, 10))
        extent = np.ptp(projected[:, :2], axis=0)
        size = np.ceil(extent * pixels_per_unit + 12).astype(int)
        camera.data.ortho_scale = float(max(size) / pixels_per_unit)
        scene.render.resolution_x, scene.render.resolution_y = (int(v*source_density) for v in size)
        scene.render.resolution_percentage = 100
        scene.render.threads_mode = 'FIXED'
        scene.render.threads = 2
        scene.render.film_transparent = True
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.image_settings.color_depth = '8'
        bpy.context.view_layer.update()
        path = output / (name+'.png')
        scene.render.filepath = str(path)
        row = dict(name=name, kind='close diagnostic' if close else 'whole scene',
                   native_size=size.tolist(), source_density=source_density,
                   pixels_per_world_unit=pixels_per_unit,
                   framing='Diagnostic crop with six logical pixels of margin; physical pixel scale preserved',
                   reduction='float-linear premultiplied BOX then display once' if source_density==8 else 'LANCZOS then clear alpha<=4',
                   camera_matrix=[list(r) for r in camera.matrix_world],
                   camera_scale=camera.data.ortho_scale,
                   resolution=[scene.render.resolution_x, scene.render.resolution_y],
                   engine=scene.render.engine, use_freestyle=scene.render.use_freestyle,
                   view_transform=scene.view_settings.view_transform,
                   labels=report['scenes'][-1]['labels'])
        report['renders'].append(row)
        save()
        begin = time.monotonic()
        bpy.ops.render.render(write_still=True)
        row.update(seconds=time.monotonic()-begin, image=dict(path=path.name, sha256=digest(path)))
        save()

    try:
        prior = json.loads((HERE/'book-grip-reading-compare-01/proof.json').read_text())
        selected = prior['cases'][1]
        state = prior['observed_states'][1]
        bpy.ops.wm.open_mainfile(filepath=str(book.SOURCE))
        rig = bpy.data.objects['SIM_01_SHARED_RIG']
        objects = book.owned(rig)
        raw = book.rest.identity(objects, [rig])
        expected_raw = json.loads((HERE/'book-grip-alt2-replay-01/proof.json').read_text())['raw_source_identity']
        if raw != expected_raw:
            raise ValueError('Book source geometry, binding, material or skeleton changed')
        rig.animation_data.action = bpy.data.actions['read']
        bpy.context.scene.frame_set(4)
        rig.animation_data.action = None
        rig.matrix_world = Matrix(state['rig_matrix_world'])
        # Restore complete saved matrices in source bone order, including roll.
        frame_error = sofa.apply_frames(rig, {n:np.asarray(m) for n,m in state['bone_matrices'].items()})
        observed = book.frame_state(rig, objects)
        if observed['properties'] != state['properties'] or observed['visibility'] != state['visibility']:
            raise ValueError('Book visibility or expression differs from saved proposal')
        surfaces = book.visible(objects)
        with np.load(HERE/'book-grip-reading-compare-01/proposal.npz') as cache:
            errors = geometry_check(surfaces, cache, selected['actual_surface_prefix']+'/')
        report['scenes'].append(dict(name='book proposal', frame_error=frame_error,
            geometry=errors, full_state=observed, input_identity=selected['input_identity'],
            raw_identity_equal=True, geometry_gate=selected['feasible'], failures=selected['failures'],
            labels=['REJECTED GEOMETRY: sleeve folds 35/24; buried-region exception is not wired',
                    'DIAGNOSTIC ONLY: no furniture or neighbor certification',
                    'Page incidence 83.737546 degrees is an unresolved visual risk']))
        registration = json.loads((HERE.parents[1]/'assets/models/sims/sim-01/registered-canvas-proof.json').read_text())['read']
        density = registration['height']/registration['camera_ortho_scale']
        camera_receipt = json.loads((HERE/'book-grip-static-views-01/proof.json').read_text())
        directions = {}
        for facing in ('SE', 'SW'):
            old = next(r for r in camera_receipt['renders'] if r['name']=='static-'+facing)
            local = Matrix(old['rig_matrix_world']).to_3x3().inverted() @ Matrix(old['camera_matrix']).to_3x3()
            directions[facing] = local
            render('book-'+facing, surfaces, rig.matrix_world.to_3x3() @ local, density)
        for label, offset in (('front', (0, -3, .35)), ('side', (3, 0, .35))):
            rotation = (-Vector(offset)).to_track_quat('-Z', 'Y').to_matrix()
            render('book-close-'+label, surfaces, rotation, density, close=True)
        if book.rest.identity(objects, [rig]) != raw:
            raise ValueError('Book source identity changed during camera-only rendering')

        prior = json.loads((HERE/'sofa-contact-solver-patch-replay-01/proof.json').read_text())
        selected = prior['evaluations'][0]
        binding = json.loads((HERE/'sofa-derived-binding-03/proof.json').read_text())
        rigs, bodies, furniture, origins = sofa.shared.load_scene(HERE/'sofa-derived-binding-03', binding)
        sofa_scene = bpy.context.scene
        sofa_registration = dict(logical_canvas=[sofa_scene.render.resolution_x//8, sofa_scene.render.resolution_y//8],
                                 camera_matrix=[list(r) for r in sofa_scene.camera.matrix_world],
                                 camera_scale=sofa_scene.camera.data.ortho_scale, source_density=8, export_density=2)
        sofa_density = max(sofa_registration['logical_canvas'])/sofa_registration['camera_scale']
        sofa.shared.pose(rigs, origins, 'sit', 0.)
        errors, frames = [], []
        with np.load(HERE/'sofa-contact-solver-patch-replay-01/scene-00.npz') as cache:
            names = json.loads((HERE/'sofa-hand-support-01/proof.json').read_text())['bone_names']
            for seat, rig in enumerate(rigs):
                rig.matrix_world = Matrix(cache[f'scene/{seat}/rig_matrix_world'])
                exact = dict(zip(names, cache[f'scene/{seat}/bone_matrices']))
                errors.append(sofa.apply_frames(rig, exact))
                frames.append(book.frame_state(rig, book.owned(rig)))
            owners = sofa.torso.surfaces(bodies)
            checks = [geometry_check(owner, cache, f'scene/{seat}/') for seat, owner in enumerate(owners)]
        surfaces = {f'{seat}/{n}':s for seat, owner in enumerate(owners) for n,s in owner.items()}
        deps = bpy.context.evaluated_depsgraph_get()
        solids = {o.name:book.witness.Surface(o, deps) for o in furniture.all_objects if o.type=='MESH' and not o.hide_render}
        surfaces.update({'furniture/'+n:s for n,s in solids.items()})
        # Furniture is unchanged from the exact hashed derivative used by the retained evaluator.
        report['scenes'].append(dict(name='sofa common reference', frame_errors=errors,
            geometry=checks, full_states=frames, source_registration=sofa_registration,
            geometry_gate=selected['valid'], failures=selected['failures'],
            labels=['REJECTED GEOMETRY: nine retained arm/body crossing classes',
                    'DIAGNOSTIC ONLY: common sitting reference; no mixed-reading acceptance']))
        np.savez(output/'sofa-replayed-furniture.npz', **{f'{n}/{k}':np.asarray(getattr(s,k))
                 for n,s in solids.items() for k in ('points','triangles')})
        for facing in ('SE', 'SW'):
            render('sofa-'+facing, surfaces, rigs[1].matrix_world.to_3x3() @ directions[facing], sofa_density, source_density=8)
        report.update(state='complete', diagnostic_render_count=len(report['renders']))
    except BaseException as error:
        report.update(state='failed', error=repr(error))
        raise
    finally:
        report['inputs_unchanged'] = all(digest(path)==sha for path,sha in inputs.items())
        if not report['inputs_unchanged']:
            report.update(state='failed', error='Immutable input changed during diagnostic render')
        save()


if __name__ == '__main__':
    run(*(Path(v).resolve() for v in sys.argv[sys.argv.index('--')+1:]))
