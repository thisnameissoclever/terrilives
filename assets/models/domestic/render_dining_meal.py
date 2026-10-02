"""Render geometry coverage for seated tabletop depth without splitting colours."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import traceback

import bpy

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE.parent / 'sims/sim-01'))

OUT = BASE / 'seated-meal'
FACINGS = {'SE': 90, 'SW': 0, 'NW': 270, 'NE': 180}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert bpy.app.background
    OUT.mkdir(parents=True, exist_ok=True)
    inputs = {name: digest(BASE / name) for name in
              ('render_dining_meal.py', 'seated-dining.blend', 'seated-dining/proof.json')}
    proof = dict(state='running', inputs=inputs, renders=[])
    journal = OUT / 'proof.json'
    if journal.exists():
        proof = json.loads(journal.read_text())
        assert proof['inputs'] == inputs, 'Meal producer changed during checkpoint'
        proof['state'] = 'running'
    def save():
        checkpoints = OUT / '.checkpoints'
        checkpoints.mkdir(exist_ok=True)
        snapshot = checkpoints / f'{time.time_ns():020}.json'
        snapshot.write_text(json.dumps(proof, indent=2) + '\n')
        if proof['state'] in ('complete', 'failed'):
            journal.write_text(snapshot.read_text())
    try:
        bpy.ops.wm.open_mainfile(filepath=str(BASE / 'seated-dining.blend'))
        scene = bpy.context.scene
        rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
        chair = bpy.data.objects['Seated dining chair']
        body = bpy.data.collections['Seated dining body']
        furniture = bpy.data.collections['Seated dining furniture']
        meal = bpy.data.collections.new('Seated tabletop geometry')
        scene.collection.children.link(meal)
        names = {name + suffix for name in ('Relaxed palm', 'Resting thumb',
                 'Forearm with elbow and wrist sections', 'Turned sleeve cuff') for suffix in ('', '.001')}
        names.update(obj.name for root in ('Dinner on table', 'Eating spoon')
                     for obj in bpy.data.objects[root].children_recursive if obj.type in ('MESH', 'CURVE'))
        proof['support_objects'] = sorted(names)
        for name in names:
            obj = bpy.data.objects[name]
            assert obj.type in ('MESH', 'CURVE') and obj.name in body.objects
            body.objects.unlink(obj)
            meal.objects.link(obj)
        assert len(meal.objects) > 0
        layer = bpy.context.view_layer
        collections = {'body': body, 'furniture': furniture, 'meal': meal}
        existing = {(r['facing'], r['frame'], r['variant'], r['owner']): r for r in proof['renders']}
        for row in existing.values():
            assert digest(OUT / row['path']) == row['sha256']
        for variant in ('green',):
            for facing, degrees in FACINGS.items():
                angle = math.radians(degrees)
                rig.rotation_euler.z = angle - math.pi / 2
                chair.rotation_euler.z = angle
                for frame in range(8):
                    scene.frame_set(frame + 1)
                    owners = ('meal', 'meal_lines')
                    for owner in owners:
                        key = (facing, frame, variant, owner)
                        if key in existing:
                            continue
                        ink = owner.endswith('_lines')
                        for role, collection in collections.items():
                            layer.layer_collection.children[collection.name].exclude = False
                            layer.layer_collection.children[collection.name].holdout = not ink and role != owner
                        scene.render.use_freestyle = ink
                        layer.freestyle_settings.as_render_pass = ink
                        for lines in layer.freestyle_settings.linesets:
                            lines.select_by_collection = owner == 'meal_lines'
                            lines.collection = meal
                            lines.collection_negation = 'INCLUSIVE' if owner == 'meal_lines' else 'EXCLUSIVE'
                        scene.use_nodes = ink
                        if ink:
                            tree = scene.node_tree
                            tree.nodes.clear()
                            source = tree.nodes.new('CompositorNodeRLayers')
                            output = tree.nodes.new('CompositorNodeComposite')
                            tree.links.new(source.outputs['Freestyle'], output.inputs['Image'])
                        path = OUT / f'{variant}-{facing}-{frame}-{owner}.png'
                        scene.render.filepath = str(path)
                        bpy.ops.render.render(write_still=True)
                        proof['renders'].append(dict(facing=facing, frame=frame, variant=variant,
                                                     owner=owner, path=path.name, sha256=digest(path)))
                        save()
        assert len(proof['renders']) == 64
        assert all(digest(BASE / name) == sha for name, sha in inputs.items())
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    main()
