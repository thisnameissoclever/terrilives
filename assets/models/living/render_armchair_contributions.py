"""Render the fitted chair with the unchanged Sit poses as reciprocal holdouts."""
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path[:0] = [str(BASE), str(BASE.parent/'furniture'), str(BASE.parent/'sims/sim-01')]
from animation_export import render_pass
from armchair_batch import (FACINGS, VARIANTS, OWNERS, MODELS, body_degrees, digest,
                            expected_keys, signature, validate_environment, validate_rows, write_json)
from armchair_contact import measure
from render_shirt_variants import SHIRT_COLORS, material_snapshot, set_shirt_colors


def scene_for(model, variant):
    bpy.ops.wm.open_mainfile(filepath=str(model))
    scene = bpy.context.scene
    root = bpy.data.objects['ARMCHAIR_MODEL_ROOT']
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    sim = bpy.data.collections['Preserved Sim reference - hidden']
    sim.hide_render = False
    furniture = bpy.data.collections.new('Armchair furniture contributions')
    scene.collection.children.link(furniture)
    for obj in list(root.children_recursive):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        furniture.objects.link(obj)
    rig.animation_data.action = bpy.data.actions['sit']
    rig.rotation_euler.z = -math.pi/2
    root.rotation_euler.z = 0
    assert rig.location.length < 1e-6, 'Approved Sim origin changed'
    if variant != 'green':
        set_shirt_colors(SHIRT_COLORS[variant], material_snapshot())
    assert (scene.render.resolution_x, scene.render.resolution_y) == (768, 960)
    assert scene.render.resolution_percentage == 100
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    return scene, rig, root, sim, furniture


def run(model, output):
    if not bpy.app.background or not model.is_absolute() or not output.is_absolute():
        raise ValueError('Use background Blender with absolute model and output paths')
    authored = json.loads((model.parent/'proof.json').read_text())
    if authored.get('state') != 'complete' or digest(model) != authored.get('model_sha256'):
        raise ValueError('Empty model is incomplete or changed')
    for name, expected in authored['inputs'].items():
        if digest(MODELS/name) != expected:
            raise ValueError(f'Authoring input changed: {name}')
    current = signature(model)
    output.mkdir(parents=True, exist_ok=True)
    journal = output/'raw-proof.json'
    proof = {'signature': current, 'state': 'running', 'renders': [], 'anchor': None,
             'blender_version': bpy.app.version_string,
             'blender_build_hash': bpy.app.build_hash.decode()}
    if journal.exists():
        proof = json.loads(journal.read_text())
        if proof['signature'] != current:
            raise ValueError('Render inputs changed; use a new output directory')
        validate_environment(proof, bpy.app.version_string, bpy.app.build_hash.decode())
    validate_rows(proof['renders'])
    existing = {}
    for row in proof['renders']:
        path = (output/row['path']).resolve()
        if path.parent != output.resolve() or digest(path) != row['sha256']:
            raise ValueError('Render checkpoint path or bytes changed')
        existing[row['path']] = row
    proof['state'] = 'running'
    write_json(journal, proof)
    try:
        for variant in VARIANTS:
            scene, rig, root, sim, furniture = scene_for(model, variant)
            contacts = []
            for frame in range(1, 5):
                scene.frame_set(frame)
                contacts.append(measure(root, sim, frame))
            if variant == 'green':
                proof['contact_samples'] = contacts
            elif contacts != proof['contact_samples']:
                raise ValueError('Shirt palette changed evaluated geometry or support')
            for facing, degrees in FACINGS.items():
                root.rotation_euler.z = math.radians(degrees)
                rig.rotation_euler.z = math.radians(body_degrees(facing))
                for index in range(4):
                    scene.frame_set(index+1)
                    bpy.context.view_layer.update()
                    p = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
                    anchor = [p.x*96, (1-p.y)*120+21]
                    if max(abs(a-b) for a, b in zip(anchor, (48, 116.00044))) > .002:
                        raise ValueError('Armchair camera registration drift')
                    if proof['anchor'] is not None and proof['anchor'] != anchor:
                        raise ValueError('Registration changed between samples')
                    proof['anchor'] = anchor
                    owners = (('empty',)+OWNERS if variant == 'green' and index == 0 else OWNERS)
                    for owner in owners:
                        filename = f'armchair-{variant}-{facing}-{index}-{owner}.png'
                        if filename in existing:
                            continue
                        path = output/filename
                        if path.exists():
                            raise ValueError(f'Unjournaled output exists: {filename}')
                        sim.hide_render = owner == 'empty'
                        render_pass(scene, sim, furniture, 'beauty' if owner == 'empty' else owner,
                                    path, separate_lines=True)
                        sim.hide_render = False
                        row = {'path': filename, 'facing': facing, 'frame': index,
                               'variant': variant, 'owner': owner, 'sha256': digest(path)}
                        proof['renders'].append(row)
                        existing[filename] = row
                        write_json(journal, proof)
                        write_json(output/'status.json', {'state': 'running', 'completed': len(existing),
                                                         'total': len(expected_keys()), 'last': filename})
        validate_rows(proof['renders'], complete=True)
        if signature(model) != current:
            raise ValueError('Render dependencies changed during generation')
        proof['state'] = 'complete'
        write_json(journal, proof)
        write_json(output/'status.json', {'state': 'complete', 'completed': len(existing)})
    except Exception:
        proof.update(state='failed', error=traceback.format_exc())
        write_json(journal, proof)
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if len(args) != 2:
        raise ValueError('Pass absolute model and output paths')
    run(*map(Path, args))
