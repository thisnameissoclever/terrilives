"""Diagnose retained trouser deformation without changing a pose or accepting it."""
import json
import math
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from render_toilet_use import SOURCE, RIG_SOURCE, MODELS, digest, partition, validate_fixture
from toilet_pose import apply
from toilet_contact import modifier_inventory
from armchair_contact import evaluated_surface, intersection
from skinning_math import weighted_point


def examine(obj, rig, seat):
    modifiers = modifier_inventory(obj)
    if ([m['type'] for m in modifiers] != ['ARMATURE', 'SUBSURF']
            or modifiers[0]['use_deform_preserve_volume']
            or not modifiers[0]['use_vertex_groups']
            or modifiers[0]['use_bone_envelopes']):
        raise ValueError('Probe supports only the declared linear-armature then subdivision chain')
    subdivisions = [m for m in obj.modifiers if m.type == 'SUBSURF']
    flags = [(m.show_viewport, m.show_render) for m in subdivisions]
    groups = {group.index: group.name for group in obj.vertex_groups}
    rows = []
    try:
        for modifier in subdivisions:
            modifier.show_viewport = modifier.show_render = False
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        evaluated = obj.evaluated_get(deps)
        data = evaluated.to_mesh()
        try:
            if (len(data.vertices) != len(obj.data.vertices)
                    or [tuple(p.vertices) for p in data.polygons] != [tuple(p.vertices) for p in obj.data.polygons]):
                raise ValueError('Pre-subdivision topology does not preserve original vertex indices')
            for vertex in obj.data.vertices:
                influences, weights = [], {}
                for group in vertex.groups:
                    if group.weight == 0:
                        continue
                    name = groups[group.group]
                    if name not in rig.data.bones or not rig.data.bones[name].use_deform:
                        raise ValueError('Unaccounted nonzero bone influence: '+name)
                    transform = (rig.matrix_world @ rig.pose.bones[name].matrix
                        @ rig.data.bones[name].matrix_local.inverted()
                        @ rig.matrix_world.inverted() @ obj.matrix_world)
                    influences.append((group.weight, [list(row) for row in transform]))
                    weights[name] = group.weight
                expected = Vector(weighted_point(tuple(vertex.co), influences))
                actual = evaluated.matrix_world @ data.vertices[vertex.index].co
                rows.append(dict(original_vertex_id=vertex.index, rest=list(vertex.co), weights=weights,
                    independent_world=list(expected), blender_world=list(actual), error=(expected-actual).length))
        finally:
            evaluated.to_mesh_clear()
        before = evaluated_surface(obj, deps)
        pre_collision = intersection(before, evaluated_surface(seat, deps))
    finally:
        for modifier, (viewport, render) in zip(subdivisions, flags):
            modifier.show_viewport, modifier.show_render = viewport, render
        bpy.context.view_layer.update()
    if modifier_inventory(obj) != modifiers:
        raise ValueError('Diagnostic did not restore source modifier settings')
    after = evaluated_surface(obj, bpy.context.evaluated_depsgraph_get())
    post_collision = intersection(after, evaluated_surface(seat, bpy.context.evaluated_depsgraph_get()))
    maximum = max(row['error'] for row in rows)
    if not math.isfinite(maximum) or maximum > 1e-5:
        raise ValueError('Independent linear skinning differs from actual indexed deformation')
    return dict(modifiers=modifiers, original_vertices=len(rows), final_vertices=len(after[0]),
        index_preserved_before_subdivision=True, independent_max_error=maximum,
        indexed_vertices=rows, pre_subdivision_ring_intersection=pre_collision,
        final_ring_intersection=post_collision, source_modifier_settings_restored=True)


def run(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use background Blender and a new absolute output directory')
    output.mkdir(parents=True, exist_ok=False)
    prior_path = BASE/'review/toilet/prototype-07-diagnostics/proof.json'
    prior = json.loads(prior_path.read_text())
    inputs = dict(prior['inputs'])
    inputs.update({path.relative_to(MODELS).as_posix(): digest(path)
                   for path in (Path(__file__), BASE/'skinning_math.py', prior_path)})
    receipt = dict(state='running', mode='indexed-deformation-diagnostic-not-pose-acceptance', inputs=inputs)
    def save():
        (output/'proof.json').write_text(json.dumps(receipt, indent=2, allow_nan=False)+'\n')
    save()
    try:
        if any(digest(MODELS/name) != value for name, value in inputs.items()):
            raise ValueError('Retained pose inputs changed')
        bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
        root, rig = bpy.data.objects['TOILET_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
        root.rotation_euler.z = rig.rotation_euler.z = 0
        rig.animation_data.action = None
        bpy.context.scene.frame_set(1)
        body, _ = partition(bpy.context.scene, root, rig)
        receipt['fixture_validation'] = validate_fixture()
        apply(rig, hip_z=prior['fitted_hip_z'])
        targets = {bone.name:dict(head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones}
        expected = prior['fitted_diagnostics']['joint_targets']
        if set(targets) != set(expected) or any(abs(a-b) > 1e-7 for name in targets
                for field in ('head', 'tail') for a, b in zip(targets[name][field], expected[name][field])):
            raise ValueError('Indexed diagnostic changed the retained rejected pose')
        receipt['same_rejected_pose'] = True
        receipt['objects'] = {name: examine(body.objects[name], rig, bpy.data.objects['Toilet open seat ring'])
                             for name in ('Tailored trouser leg', 'Tailored trouser leg.001')}
        receipt['immutable_inputs_preserved'] = all(digest(MODELS/name) == value for name, value in inputs.items())
        if not receipt['immutable_inputs_preserved']:
            raise ValueError('Diagnostic changed an input file')
        receipt['state'] = 'complete'
        save()
    except BaseException:
        receipt.update(state='failed', error=traceback.format_exc())
        save()
        raise


if __name__ == '__main__':
    run(Path(sys.argv[sys.argv.index('--')+1]))
