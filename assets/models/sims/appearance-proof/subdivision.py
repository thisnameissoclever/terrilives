"""Extract Blender's linear subdivision operator instead of changing deformation order."""
import bpy
import numpy as np


def evaluated_positions(obj):
    bpy.context.view_layer.update()
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        values = np.empty(len(mesh.vertices)*3, dtype=np.float32)
        mesh.vertices.foreach_get('co', values)
        return values.reshape((-1, 3)).copy()
    finally:
        evaluated.to_mesh_clear()


def extract(obj):
    """Three coordinate basis vectors per evaluation yield exact sparse cage weights."""
    original = np.empty(len(obj.data.vertices)*3, dtype=np.float32)
    obj.data.vertices.foreach_get('co', original)
    reference = evaluated_positions(obj)
    count = len(obj.data.vertices)
    dense = np.zeros((len(reference), count), dtype=np.float32)
    try:
        for start in range(0, count, 3):
            basis = np.zeros((count, 3), dtype=np.float32)
            for axis in range(min(3, count-start)):
                basis[start+axis, axis] = 1.
            obj.data.vertices.foreach_set('co', basis.ravel())
            obj.data.update()
            result = evaluated_positions(obj)
            if len(result) != len(reference):
                raise ValueError('Subdivision topology changed with coordinates: '+obj.name)
            for axis in range(min(3, count-start)):
                dense[:, start+axis] = result[:, axis]
    finally:
        obj.data.vertices.foreach_set('co', original)
        obj.data.update()
        bpy.context.view_layer.update()
    error = float(np.max(np.abs(dense @ original.reshape((-1, 3)) - reference)))
    row_error = float(np.max(np.abs(dense.sum(axis=1)-1)))
    if error > 2e-6 or row_error > 2e-6:
        raise ValueError(f'Subdivision operator does not reproduce rest surface: {obj.name}, {error}, {row_error}')
    rows = [[(int(i), float(weights[i])) for i in np.flatnonzero(np.abs(weights)>1e-9)] for weights in dense]
    return dict(rows=rows, restError=error, rowSumError=row_error, cageVertices=count, surfaceVertices=len(reference))


def source_pose_parity(obj, stencil, rig, actions):
    """Compare the operator's skinned cage with Blender's actual evaluated pose."""
    from mathutils import Vector
    arm = next(mod for mod in obj.modifiers if mod.type == 'ARMATURE')
    original_action = rig.animation_data.action
    rows = []
    try:
        arm.show_viewport = True
        for action, frame in actions:
            rig.animation_data.action = bpy.data.actions[action]
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            transforms = {b.name: rig.pose.bones[b.name].matrix @ b.matrix_local.inverted() for b in rig.data.bones}
            cage = []
            for vertex in obj.data.vertices:
                point = obj.matrix_world @ vertex.co
                cage.append(tuple(sum((transforms[obj.vertex_groups[g.group].name] @ point * g.weight
                                       for g in vertex.groups if g.weight > 0), Vector())))
            cage = np.asarray(cage, dtype=np.float64)
            expected = evaluated_positions(obj)
            matrix = np.asarray(obj.matrix_world, dtype=np.float64)
            expected = expected @ matrix[:3, :3].T + matrix[:3, 3]
            actual = np.array([sum((cage[index]*weight for index, weight in row), np.zeros(3)) for row in stencil['rows']])
            error = float(np.max(np.linalg.norm(actual-expected, axis=1)))
            rows.append(dict(part=obj.name, action=action, frame=frame, maxError=error))
            if error > 2e-5:
                raise ValueError(f'Skinned subdivision differs from source: {rows[-1]}')
    finally:
        arm.show_viewport = False
        rig.animation_data.action = original_action
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
    return rows
