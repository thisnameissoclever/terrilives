"""Evaluate all source variants for a rest audit, then restore exact visibility state."""
import hashlib
import json

import bpy
import numpy as np


VISIBILITY_PATHS = {'hide_render', 'hide_viewport'}


def driver_state(obj):
    result = []
    if not obj.animation_data:
        return result
    for curve in obj.animation_data.drivers:
        driver = curve.driver
        variables = []
        for variable in driver.variables:
            targets = []
            for target in variable.targets:
                values = {}
                for key in ('data_path', 'bone_target', 'transform_type', 'transform_space'):
                    if hasattr(target, key):
                        values[key] = getattr(target, key)
                values['id'] = target.id.name if target.id else None
                targets.append(values)
            variables.append(dict(name=variable.name, type=variable.type, targets=targets))
        result.append(dict(path=curve.data_path, index=curve.array_index, mute=curve.mute,
                           driver_type=driver.type, expression=driver.expression,
                           use_self=driver.use_self, variables=variables))
    return result


def array_hash(*arrays):
    digest = hashlib.sha256()
    for value in arrays:
        array = np.asarray(value)
        digest.update(str(array.shape).encode('ascii'))
        digest.update(array.dtype.str.encode('ascii'))
        digest.update(array.tobytes())
    return digest.hexdigest()


def identity(objects, rigs):
    meshes = {}
    for obj in objects:
        polygons = [list(p.vertices) for p in obj.data.polygons]
        points = np.asarray([list(v.co) for v in obj.data.vertices], dtype=np.float64)
        offsets = np.cumsum([0] + [len(p) for p in polygons], dtype=np.int32)
        indices = np.asarray([v for p in polygons for v in p], dtype=np.int32)
        weights = [[v.index, group.group, group.weight] for v in obj.data.vertices for group in v.groups]
        meshes[obj.name] = dict(geometry=array_hash(points, offsets, indices), weights=array_hash(np.asarray(weights, dtype=np.float64)),
                               groups=[g.name for g in obj.vertex_groups],
                               materials=[m.name if m else None for m in obj.data.materials],
                               material_indices=[p.material_index for p in obj.data.polygons],
                               object_basis=[list(row) for row in obj.matrix_basis],
                               parent_inverse=[list(row) for row in obj.matrix_parent_inverse])
    bones = {rig.name: [dict(name=b.name, head=list(b.head_local), tail=list(b.tail_local),
                matrix=[list(row) for row in b.matrix_local], parent=b.parent.name if b.parent else None)
                       for b in rig.data.bones] for rig in rigs}
    return dict(meshes=meshes, bones=bones)


def visibility(objects, rigs):
    return dict(objects={obj.name: dict(hide_render=obj.hide_render, hide_viewport=obj.hide_viewport,
                        hide_layer=obj.hide_get(), drivers=driver_state(obj)) for obj in objects},
                rigs={rig.name: dict(pose_position=rig.data.pose_position,
                      book_visible=rig.get('book_visible'), eyes_closed=rig.get('eyes_closed'),
                      action=rig.animation_data.action.name if rig.animation_data and rig.animation_data.action else None,
                      pose_basis={b.name: [list(row) for row in b.matrix_basis] for b in rig.pose.bones}) for rig in rigs})


class RestAudit:
    """One bounded activation, two rest snapshots, and unconditional restoration."""
    def __init__(self, objects, rigs):
        self.objects, self.rigs = list(objects), list(rigs)
        self.before_identity = identity(self.objects, self.rigs)
        self.before_visibility = visibility(self.objects, self.rigs)
        self.driver_refs = {}
        self.activated = False
        self.restoration = None

    def activate(self):
        self.activated = True
        for obj in self.objects:
            if obj.animation_data:
                for curve in obj.animation_data.drivers:
                    if curve.data_path in VISIBILITY_PATHS:
                        pointer = curve.as_pointer()
                        if pointer not in self.driver_refs:
                            self.driver_refs[pointer] = (curve, curve.mute)
                        curve.mute = True
            obj.hide_viewport = False
            obj.hide_render = False
            obj.hide_set(False)
        for rig in self.rigs:
            rig.data.pose_position = 'REST'
        # Activation makes previously excluded children part of the graph.
        bpy.context.view_layer.update()
        for rig in self.rigs:
            rig.update_tag(refresh={'OBJECT', 'DATA'})
        for obj in self.objects:
            obj.update_tag(refresh={'OBJECT', 'DATA'})
        # Complete hierarchy evaluation before any rest geometry is captured.
        bpy.context.view_layer.update()
        return self.check_hierarchy()

    def check_hierarchy(self):
        residuals = {}
        for obj in self.objects:
            if obj.hide_viewport or obj.hide_render or obj.hide_get():
                raise ValueError(f'Audited variant did not activate: {obj.name}')
            if obj.parent_type != 'OBJECT' or obj.parent is None:
                raise ValueError(f'Unhandled source parent relation: {obj.name}')
            expected = obj.parent.matrix_world @ obj.matrix_parent_inverse @ obj.matrix_basis
            residual = max(abs(obj.matrix_world[r][c] - expected[r][c]) for r in range(4) for c in range(4))
            residuals[obj.name] = residual
            if residual > 1e-5:
                raise ValueError(f'Active rest hierarchy is stale: {obj.name}, residual={residual}')
        return residuals

    def unchanged_refresh(self):
        for rig in self.rigs:
            rig.data.pose_position = 'POSE'
        bpy.context.view_layer.update()
        for rig in self.rigs:
            rig.data.pose_position = 'REST'
        for obj in self.objects:
            obj.data.update()
            obj.update_tag(refresh={'OBJECT', 'DATA'})
        bpy.context.view_layer.update()
        return self.check_hierarchy()

    def restore(self):
        if not self.activated:
            return None
        # Restore stored flags while visibility drivers are still muted, then
        # restore the exact driver mute states and evaluate the original pose.
        for obj in self.objects:
            original = self.before_visibility['objects'][obj.name]
            obj.hide_render = original['hide_render']
            obj.hide_viewport = original['hide_viewport']
            obj.hide_set(original['hide_layer'])
        for curve, muted in self.driver_refs.values():
            curve.mute = muted
        for rig in self.rigs:
            rig.data.pose_position = self.before_visibility['rigs'][rig.name]['pose_position']
        bpy.context.view_layer.update()
        current_identity = identity(self.objects, self.rigs)
        current_visibility = visibility(self.objects, self.rigs)
        self.restoration = dict(raw_identity_equal=current_identity == self.before_identity,
                                visibility_and_drivers_equal=current_visibility == self.before_visibility,
                                after_identity=current_identity, after_visibility=current_visibility)
        if not self.restoration['raw_identity_equal'] or not self.restoration['visibility_and_drivers_equal']:
            raise ValueError('Rest audit did not restore exact source identity and visibility state')
        return self.restoration
