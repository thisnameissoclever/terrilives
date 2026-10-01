"""Render a bounded, resumable offline batch from the fitted additive action."""
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT/'assets/models'
sys.path[:0] = [str(ROOT/'output'), str(MODELS/'furniture'), str(MODELS/'sims/sim-01')]
from animation_export import render_pass
from render_shirt_variants import SHIRT_COLORS, material_snapshot, set_shirt_colors
from surface_volume import boundary_edges

CHECKER = ROOT/'output/check-ottoman-sit-candidate-02.py'
spec = importlib.util.spec_from_file_location('ottoman_contact', CHECKER)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
DIRECTORY = ROOT/'output/ottoman-sit-candidate-02'
MODEL = DIRECTORY/'ottoman-sit-authoring.blend'
OUTPUT = DIRECTORY/'contributions'
FACINGS = {'SE': 90, 'NW': 270, 'SW': 0, 'NE': 180}
VARIANTS = ('green', 'blue', 'red')
OWNERS = ('beauty', 'sim', 'furniture', 'lines')
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2)+'\n')
    temporary.replace(path)


def expected_keys():
    return {(facing, index, variant, owner) for facing in FACINGS for index in range(4)
            for variant in VARIANTS for owner in OWNERS} | {
                (facing, 0, 'green', 'empty') for facing in FACINGS}


def source_signature():
    names = ('living/armchair_contact.py', 'living/armchair_support.py',
             'bedroom/bunk_contact.py', 'bathroom/check_toilet_scene.py',
             'kitchen/check_stove_scene.py', 'kitchen/render_static.py',
             'furniture/animation_export.py', 'furniture/build_parts.py',
             'furniture/geometry.py', 'furniture/preview.py',
             'sims/sim-01/sim-01-rigged.blend', 'sims/sim-01/registered-canvas-proof.json',
             'sims/sim-01/render_shirt_variants.py', 'sims/sim-01/shirt_colors.py',
             'sims/sim-01/render_job.py', 'sims/sim-01/build_rig.py',
             'sims/sim-01/rig_math.py', 'sims/sim-01/food_depth.py')
    paths = [MODELS/name for name in names] + [MODEL, DIRECTORY/'status.json',
             DIRECTORY/'strict-contact-proof-02.json', CHECKER, Path(__file__),
             ROOT/'output/build-ottoman-sit-refined.py', ROOT/'output/surface_volume.py']
    return {str(path.relative_to(ROOT)): digest(path) for path in paths}


def scene_for(variant):
    bpy.ops.wm.open_mainfile(filepath=str(MODEL))
    scene = bpy.context.scene
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    root = bpy.data.objects['OTTOMAN_MODEL_ROOT']
    sim = bpy.data.collections['Preserved Sim reference - hidden']
    sim.hide_render = False
    furniture = bpy.data.collections.new('Ottoman furniture contributions')
    scene.collection.children.link(furniture)
    for obj in list(root.children_recursive):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        furniture.objects.link(obj)
    root.rotation_euler.z = 0
    rig.rotation_euler.z = -math.pi/2
    assert rig.animation_data.action.name == 'ottoman_sit'
    if variant != 'green':
        set_shirt_colors(SHIRT_COLORS[variant], material_snapshot())
    assert (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage) == (768, 960, 100)
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    return scene, rig, root, sim, furniture


def main():
    assert bpy.app.background
    accepted = json.loads((DIRECTORY/'strict-contact-proof-02.json').read_text())
    assert accepted['state'] == 'complete' and accepted['accepted']
    assert len(accepted['samples']) == 4
    for name, expected in accepted['inputs'].items():
        assert digest(ROOT/name) == expected, f'Changed accepted input: {name}'
    signature = source_signature()
    OUTPUT.mkdir(exist_ok=True)
    journal = OUTPUT/'raw-proof.json'
    proof = {'state': 'running', 'pid': os.getpid(), 'background': bpy.app.background,
             'blender_version': bpy.app.version_string, 'blender_build_hash': bpy.app.build_hash.decode(),
             'signature': signature, 'scope': 'Offline renders awaiting full-clip/compositing review',
             'renders': [], 'anchor': None, 'contact_samples': {}}
    if journal.exists():
        proof = json.loads(journal.read_text())
        assert proof['signature'] == signature, 'Checkpoint inputs changed'
        assert proof['blender_version'] == bpy.app.version_string
        assert proof['blender_build_hash'] == bpy.app.build_hash.decode()
    expected = expected_keys()
    existing = set()
    for row in proof['renders']:
        key = tuple(row[name] for name in ('facing', 'frame', 'variant', 'owner'))
        assert key in expected and key not in existing
        filename = f'ottoman-sit-{key[2]}-{key[0]}-{key[1]}-{key[3]}.png'
        assert row['path'] == filename and digest(OUTPUT/filename) == row['sha256']
        existing.add(key)
    proof.update(state='running', pid=os.getpid())
    write_json(journal, proof)
    try:
        bpy.ops.wm.open_mainfile(filepath=str(checker.author.RIG))
        neck = checker.Surface(bpy.data.objects['Overshirt body'], bpy.context.evaluated_depsgraph_get())
        edges = {tuple(sorted(edge)) for edge in boundary_edges(neck.triangles)}
        assert len(edges) == 96
        checker.SOURCE_NECK = {'edges': edges, 'points': neck.points}
        for variant in VARIANTS:
            scene, rig, root, sim, furniture = scene_for(variant)
            contacts = [checker.check_frame(scene, rig, root, sim, frame) for frame in range(1, 5)]
            assert contacts == accepted['samples'], 'Palette or export setup changed physical fit'
            proof['contact_samples'][variant] = contacts
            for facing, degrees in FACINGS.items():
                root.rotation_euler.z = math.radians(degrees)
                rig.rotation_euler.z = math.radians(degrees-90)
                for index in range(4):
                    scene.frame_set(index+1)
                    bpy.context.view_layer.update()
                    point = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
                    anchor = [point.x*96, (1-point.y)*120+21]
                    assert max(abs(a-b) for a, b in zip(anchor, (48, 116.00044))) < .002
                    if proof['anchor'] is not None:
                        assert anchor == proof['anchor'], 'Camera registration drift'
                    proof['anchor'] = anchor
                    owners = (('empty',)+OWNERS if variant == 'green' and index == 0 else OWNERS)
                    for owner in owners:
                        key = (facing, index, variant, owner)
                        if key in existing:
                            continue
                        filename = f'ottoman-sit-{variant}-{facing}-{index}-{owner}.png'
                        path = OUTPUT/filename
                        assert not path.exists(), f'Unjournaled output exists: {filename}'
                        sim.hide_render = owner == 'empty'
                        render_pass(scene, sim, furniture, 'beauty' if owner == 'empty' else owner,
                                    path, separate_lines=True)
                        sim.hide_render = False
                        proof['renders'].append({'facing': facing, 'frame': index, 'variant': variant,
                                                'owner': owner, 'path': filename, 'sha256': digest(path)})
                        existing.add(key)
                        write_json(journal, proof)
                        write_json(OUTPUT/'status.json', {'state': 'running', 'pid': os.getpid(),
                                   'completed': len(existing), 'total': len(expected), 'last': filename})
        assert existing == expected and source_signature() == signature
        proof.update(state='complete', source_bytes_unchanged=True)
        write_json(journal, proof)
        write_json(OUTPUT/'status.json', {'state': 'complete', 'completed': len(existing), 'total': len(expected)})
    except Exception:
        proof.update(state='failed', error=traceback.format_exc())
        write_json(journal, proof)
        write_json(OUTPUT/'status.json', {'state': 'failed', 'error': proof['error']})
        raise


if __name__ == '__main__':
    main()
