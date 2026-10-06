"""One frozen waist articulation experiment; never a collision-tuned source fix."""
import math

FIELD = dict(version=1, hip_full_below_z=.98, spine_full_above_z=1.12,
             anatomical_spine_waist_z=1.03, preserved_upper_back_start_z=1.12,
             interpolation='smoothstep in neutral source height', seam_extra_gap_limit=.002,
             chosen_from='neutral lower garment/waist and fixed upper-back anatomical label boundary',
             collision_feedback_used=False, source_acceptance=False)
TORSO_ATTACHMENTS = {'Overshirt body', 'Shirt lower hem', 'Shirt placket', 'Collar stand',
                    'Folded fabric collar leaf', 'Folded fabric collar leaf.001',
                    'One sewn breast pocket', 'Pocket top seam', 'Small horn button',
                    'Small horn button.001', 'Small horn button.002', 'Small horn button.003'}


def waist_weights(height):
    if not math.isfinite(height):
        raise ValueError('Anatomical field height must be finite')
    t = max(0., min(1., (height-FIELD['hip_full_below_z'])/
                          (FIELD['spine_full_above_z']-FIELD['hip_full_below_z'])))
    spine = t*t*(3-2*t)
    return {'hips':1-spine, 'spine':spine}


def attachment_weights(point):
    return waist_weights(point[2])


def transform(point, matrix):
    return tuple(sum(matrix[i][j]*point[j] for j in range(3))+matrix[i][3] for i in range(3))


def frozen_hip_matrix(parameters):
    angle = math.radians(parameters['hip_angle'])
    sine, cosine = math.sin(angle), math.cos(angle)
    return [[-1, 0, 0, 0], [0, -cosine, -sine, parameters['hip_y']+.86*sine],
            [0, -sine, cosine, parameters['hip_z']-.86*cosine], [0, 0, 0, 1]]


def blend_point(point, weights, hip_matrix, spine_matrix):
    if set(weights) != {'hips', 'spine'} or abs(sum(weights.values())-1) > 1e-12 or any(
            not math.isfinite(v) or not 0 <= v <= 1 for v in weights.values()):
        raise ValueError('Prediction requires normalized anatomical Hip/Spine weights')
    hip, spine = transform(point, hip_matrix), transform(point, spine_matrix)
    return tuple(a+weights['spine']*(b-a) for a, b in zip(hip, spine))


def seam_distance_gate(before, after, require=True):
    if len(before) != len(after) or not before or any(not math.isfinite(v) for v in (*before, *after)):
        raise ValueError('Attachment correspondence evidence must be complete and finite')
    increases = [b-a for a, b in zip(before, after)]
    passed = max(increases) <= FIELD['seam_extra_gap_limit']
    result = dict(state='passed' if passed else 'failed', max_gap_increase=max(increases),
                  original_max_distance=max(before), modified_max_distance=max(after),
                  allowed_extra_gap=FIELD['seam_extra_gap_limit'], complete_vertices=len(before))
    if require and not passed:
        raise ValueError('Derived lower garment detached an attachment seam')
    return result


def surface_orientation_gate(before, after, triangles, require=True):
    if len(before) != len(after):
        raise ValueError('Fold diagnostic vertex correspondence differs')
    def normal(points, tri):
        a, b, c = [points[i] for i in tri]
        u, v = [b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)]
        cross = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
        length = math.sqrt(sum(x*x for x in cross))
        return None if length <= 1e-12 else tuple(x/length for x in cross)
    folds, new_degenerate = [], []
    for index, tri in enumerate(triangles):
        a, b = normal(before, tri), normal(after, tri)
        if a is not None and b is None:
            new_degenerate.append(index)
        elif a is not None and b is not None and sum(x*y for x, y in zip(a, b)) <= 0:
            folds.append(index)
    passed = not folds and not new_degenerate
    result = dict(state='passed' if passed else 'failed', flipped_triangles=folds,
                  new_degenerate_triangles=new_degenerate, complete_triangles=len(triangles))
    if require and not passed:
        raise ValueError('Derived lower garment created internal orientation folds')
    return result


def inspect_and_predict(objects, hip_matrix, spine_matrix):
    records = {}
    for obj in objects:
        if obj.name not in TORSO_ATTACHMENTS:
            continue
        group_names = {g.index:g.name for g in obj.vertex_groups}
        vertices = [tuple(obj.matrix_world@v.co) for v in obj.data.vertices]
        weights = [attachment_weights(v) for v in vertices]
        affected = any(w['hips'] > 0 for w in weights)
        if affected and any(len(v.groups) != 1 or group_names[v.groups[0].group] != 'spine'
                            or abs(v.groups[0].weight-1) > 1e-6 for v in obj.data.vertices):
            raise ValueError(f'Anatomically declared affected torso attachment has unexpected binding: {obj.name}')
        if not affected:
            records[obj.name]=dict(neutral_control_vertices=[list(v) for v in vertices],
                source_z_bounds=[min(v[2] for v in vertices),max(v[2] for v in vertices)],
                affected=False,original_binding_groups=sorted({group_names[g.group] for v in obj.data.vertices for g in v.groups}),
                reason='Every source vertex is above the frozen lower-garment field; original attachment retained')
            continue
        old = [transform(v, spine_matrix) for v in vertices]
        proposed = [blend_point(v, w, hip_matrix, spine_matrix) for v, w in zip(vertices, weights)]
        records[obj.name] = dict(neutral_control_vertices=[list(v) for v in vertices],
            source_z_bounds=[min(v[2] for v in vertices), max(v[2] for v in vertices)],
            affected=affected, field_weights=weights,
            original_binding_groups=sorted({group_names[g.group] for v in obj.data.vertices for g in v.groups}),
            independently_predicted_original_pose=[list(p) for p in old],
            independently_predicted_modified_pose=[list(p) for p in proposed],
            predicted_original_control_min_z=min(p[2] for p in old),
            predicted_modified_control_min_z=min(p[2] for p in proposed),
            predicted_floor_clearance_change=min(p[2] for p in proposed)-min(p[2] for p in old),
            prediction_frozen_before_binding=True)
    if set(records) != TORSO_ATTACHMENTS:
        raise ValueError('Torso attachment inspection inventory is incomplete')
    return records


def raw_invariants(objects, rig):
    from bath_contact import modifier_records
    return dict(objects={obj.name:dict(vertices=[list(v.co) for v in obj.data.vertices],
                polygons=[list(p.vertices) for p in obj.data.polygons],
                materials=[dict(name=m.name,rgba=list(m.diffuse_color)) for m in obj.data.materials],
                modifiers=modifier_records(obj),scale=list(obj.scale)) for obj in objects},
                bones={b.name:dict(head=list(b.head_local),tail=list(b.tail_local),length=b.length)
                       for b in rig.data.bones})


def attachment_distances(meshes):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from bath_rest_labels import canonical_triangles
    torso = meshes['Overshirt body']
    tree = BVHTree.FromPolygons([Vector(p) for p in torso['vertices_world']],
                               canonical_triangles(torso),all_triangles=True)
    return {name:[tree.find_nearest(Vector(p))[3] for p in mesh['vertices_world']]
            for name,mesh in meshes.items() if name != 'Overshirt body'}


def nonadjacent_self_crossings(mesh):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from bath_rest_labels import canonical_triangles
    triangles = canonical_triangles(mesh)
    tree = BVHTree.FromPolygons([Vector(p) for p in mesh['vertices_world']],triangles,all_triangles=True)
    return {(a,b) for a,b in tree.overlap(tree) if a < b and not set(triangles[a])&set(triangles[b])}


def verify_raw_prediction(objects, prediction):
    import bpy
    from bath_contact import evaluated_geometry, modifier_records
    records = {}
    for obj in objects:
        if obj.name not in prediction or not prediction[obj.name]['affected']:
            continue
        before = modifier_records(obj)
        subdivisions = [(m,m.show_viewport) for m in obj.modifiers if m.type == 'SUBSURF']
        try:
            for modifier,_ in subdivisions:
                modifier.show_viewport = False
            bpy.context.view_layer.update()
            mesh = evaluated_geometry(obj,bpy.context.evaluated_depsgraph_get())
            if len(mesh['vertices_world']) != len(obj.data.vertices) or mesh['polygons'] != [list(p.vertices) for p in obj.data.polygons]:
                records[obj.name] = dict(state='unverified-other-topology-modifier',accepted_clearance=False)
                continue
            expected = prediction[obj.name]['independently_predicted_modified_pose']
            errors = [math.dist(a,b) for a,b in zip(expected,mesh['vertices_world'])]
            records[obj.name] = dict(state='passed' if max(errors)<=1e-6 else 'failed',
                raw_control_vertices=len(errors),max_position_error=max(errors),declared_bound=1e-6,
                complete_prediction_errors=errors,pre_subdivision_only=True,
                used_for_final_clearance_acceptance=False)
        finally:
            for modifier,shown in subdivisions:
                modifier.show_viewport = shown
            bpy.context.view_layer.update()
        if modifier_records(obj) != before:
            raise ValueError('Prediction replay changed original modifier flags')
    return records


def run_experiment(root,rig,body,parameters,spine_matrix,record):
    import bpy
    from build_rig import pose
    from bath_pose import apply_support_frame
    from bath_contact import body_inventory, measure_support, measure_complete_clearance
    from bath_rest_labels import (capture_neutral,capture_evaluated,canonical_triangles,
                                  verified_topology,verify_neutral_fidelity)
    objects = [obj for obj in body.all_objects if obj.name in body_inventory()]
    if {obj.name for obj in objects} != body_inventory():
        raise ValueError('Original conservative 54-body experiment inventory changed')
    pose(rig,'idle',0)
    neutral_before = capture_neutral(objects)
    invariants = raw_invariants(objects,rig)
    inspections = {obj.name:dict(source_z_bounds=[min(v.co.z for v in obj.data.vertices),
                    max(v.co.z for v in obj.data.vertices)],
                    groups=sorted({obj.vertex_groups[g.group].name for v in obj.data.vertices for g in v.groups}),
                    anatomically_torso_attached=obj.name in TORSO_ATTACHMENTS) for obj in objects}
    prediction = inspect_and_predict(objects,frozen_hip_matrix(parameters),spine_matrix)
    affected = [obj for obj in objects if obj.name in prediction and prediction[obj.name]['affected']]
    record('frozen_field',FIELD)
    record('neutral_source_attachment_inspection',inspections)
    record('independent_prediction_before_binding',prediction)
    record('neutral_evaluated_label_reference',neutral_before)
    apply_support_frame(rig,**parameters)
    before_meshes = capture_evaluated(affected,'baseline fixed-pose evaluated modifier output')
    before_distances = attachment_distances(before_meshes)
    before_support = measure_support(root,rig,body,neutral_before)
    before_clearance = measure_complete_clearance(root,rig,body,neutral_before)
    record('baseline_fixed_pose',dict(parameters=parameters,support=before_support,
                                    clearance=before_clearance,affected_geometry=before_meshes))
    pose(rig,'idle',0)
    applied = apply_field(objects,prediction)
    bpy.context.view_layer.update()
    neutral_after = capture_neutral(objects)
    fidelity = {name:verify_neutral_fidelity(neutral_before[name],neutral_after[name]) for name in neutral_before}
    if raw_invariants(objects,rig) != invariants:
        raise ValueError('Field experiment changed original source vertices/topology/materials/modifiers/bones')
    record('applied_derived_binding',applied)
    record('neutral_fidelity',fidelity)
    record('raw_vertices_topology_materials_modifiers_17bones_unchanged',True)
    apply_support_frame(rig,**parameters)
    prediction_replay = verify_raw_prediction(affected,prediction)
    after_meshes = capture_evaluated(affected,'derived fixed-pose evaluated modifier output')
    after_distances = attachment_distances(after_meshes)
    seams,quality = {},{}
    for name in before_meshes:
        verified_topology(before_meshes[name],after_meshes[name])
        tri = canonical_triangles(before_meshes[name])
        orientation = surface_orientation_gate(before_meshes[name]['vertices_world'],after_meshes[name]['vertices_world'],tri,require=False)
        before_pairs,after_pairs = nonadjacent_self_crossings(before_meshes[name]),nonadjacent_self_crossings(after_meshes[name])
        orientation.update(original_self_crossings=[list(p) for p in sorted(before_pairs)],
            derived_self_crossings=[list(p) for p in sorted(after_pairs)],
            new_nonadjacent_self_crossings=[list(p) for p in sorted(after_pairs-before_pairs)])
        if after_pairs-before_pairs:
            orientation['state']='failed'
        quality[name]=orientation
        if name != 'Overshirt body':
            seams[name]=seam_distance_gate(before_distances[name],after_distances[name],require=False)
            seams[name].update(baseline_distances=before_distances[name],derived_distances=after_distances[name])
    after_support = measure_support(root,rig,body,neutral_before)
    after_clearance = measure_complete_clearance(root,rig,body,neutral_before)
    if after_support['joint_targets'] != before_support['joint_targets']:
        raise ValueError('Binding-only experiment changed the fixed rejected pose')
    record('complete_derived_measurement',dict(prediction_replay=prediction_replay,support=after_support,
        clearance=after_clearance,affected_geometry=after_meshes,attachment_seams=seams,
        internal_fold_quality=quality,source_acceptance=False,angles_tuned=False,
        water_present=False,limbs_fitted=False,beauty_rendered=False,
        exact_joint_targets_preserved=True))
    return dict(torso_floor_penetration_removed=after_clearance['torso_floor_triangle_pairs']==0,
        attachment_seams_pass=all(s['state']=='passed' for s in seams.values()),
        internal_folds_pass=all(q['state']=='passed' for q in quality.values()),
        actual_upper_back_support_pass=after_support['support']['back']['state']=='passed',
        conservative_full_body_clearance_pass=not after_clearance['collisions'],
        full_source_acceptance=False,binding_field_tuning_authorized=False,
        next_architecture_if_failed='Original-rig actual wall-backed support solve; do not tune V1 weights')


def apply_field(objects, prediction):
    records = {}
    for obj in objects:
        if obj.name not in prediction or not prediction[obj.name]['affected']:
            continue
        if len(obj.data.vertices) != len(prediction[obj.name]['field_weights']):
            raise ValueError('Raw control-vertex field inventory changed')
        spine = obj.vertex_groups['spine']
        hip = obj.vertex_groups.get('hips')
        if hip is None:
            hip = obj.vertex_groups.new(name='hips')
        for vertex, weights in zip(obj.data.vertices, prediction[obj.name]['field_weights']):
            for group, key in ((hip, 'hips'), (spine, 'spine')):
                if weights[key] > 0:
                    group.add([vertex.index], weights[key], 'REPLACE')
                elif any(g.group == group.index for g in vertex.groups):
                    group.remove([vertex.index])
        names = {g.index:g.name for g in obj.vertex_groups}
        actual = [{names[g.group]:g.weight for g in v.groups} for v in obj.data.vertices]
        if any(abs(sum(w.values())-1) > 1e-6 or not set(w) <= {'hips','spine'} for w in actual):
            raise ValueError('Applied field is not normalized Hip/Spine articulation')
        records[obj.name] = dict(affected_control_vertices=len(actual), actual_weights=actual,
                                source_vertices_topology_materials_unchanged=True)
    return records
