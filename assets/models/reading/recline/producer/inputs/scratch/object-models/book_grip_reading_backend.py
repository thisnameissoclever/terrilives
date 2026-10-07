"""Bounded original-source Blender backend for the shared complete reading gate."""
import time
import numpy as np
import bpy

import book_grip_original_replay as source
from book_grip_reading_geometry import Mesh
from probe_sofa_resting_clearance import apply_frames


class BlenderReadingBackend:
    def __init__(self,context,maximum_evaluations=2):
        self.context=context;self.calls=0;self.maximum_evaluations=maximum_evaluations
        expected=context.receipt['opened_original']
        if source.digest(source.SOURCE)!=expected['sha256']:raise ValueError('Original source hash differs from the selected input')
        bpy.ops.wm.open_mainfile(filepath=str(source.SOURCE))
        if bpy.data.filepath.replace('\\','/').lower()!=str(source.SOURCE).replace('\\','/').lower():raise ValueError('Opened source path mismatch')
        self.rig=bpy.data.objects['SIM_01_SHARED_RIG'];self.objects=source.owned(self.rig)
        self.raw=source.rest.identity(self.objects,[self.rig]);self.actions=source.action_identity()
        if self.raw!=context.raw:raise ValueError('Actual raw source geometry, binding, materials or bones differ from the context')
        self.action=bpy.data.actions['read'];self.last_snapshot=None;self.states=[]
        bpy.context.scene.render.threads_mode='FIXED';bpy.context.scene.render.threads=2

    def evaluate_frames(self,frames,deadline):
        if self.calls>=self.maximum_evaluations:raise ValueError('Two actual reading evaluations exhausted; no candidate loop is permitted')
        if deadline is not None and time.monotonic()>=deadline:raise TimeoutError('Shared reading comparison deadline exhausted')
        self.calls+=1;rig=self.rig;rig.animation_data.action=self.action;bpy.context.scene.frame_set(4);rig.animation_data.action=None
        changed={n:np.asarray(m) for n,m in frames.items() if not np.array_equal(np.asarray(m),self.context.source_frames[n])}
        error=apply_frames(rig,changed) if changed else 0.
        observed=source.frame_state(rig,self.objects);surfaces=source.visible(self.objects)
        meshes={n:Mesh(s.points,s.triangles,native_tree=s.tree) for n,s in surfaces.items()}
        length=max(abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones)
        scale=max(abs(v-1) for b in rig.pose.bones for v in b.scale)
        joins=max((rig.pose.bones[a+'.'+s].tail-rig.pose.bones[b+'.'+s].head).length for s in ('L','R') for a,b in (('upper_arm','forearm'),('forearm','hand')))
        rest_error=max(float(np.max(np.abs(np.asarray(b.matrix_local)-self.context.rest_frames[b.name]))) for b in rig.data.bones)
        snapshot=dict(surfaces=meshes,frames={n:np.asarray(v) for n,v in observed['bone_matrices'].items()},rig_matrix_world=np.asarray(rig.matrix_world),
            identity_rows=[dict(kind='raw_source_identity',valid=source.rest.identity(self.objects,[rig])==self.raw),
                           dict(kind='original_actions_unchanged',valid=source.action_identity()==self.actions),
                           dict(kind='selected_visibility_inventory',valid=set(meshes)==set(self.context.source),source_properties=observed['properties'])],
            joint_row=dict(kind='joints_and_frames',valid=max(length,scale,joins,rest_error,error)<=1e-5,
                length_error=length,scale_error=scale,join_error=joins,rest_matrix_error=rest_error,frame_error=error))
        self.last_snapshot=snapshot;self.states.append(observed);return snapshot
