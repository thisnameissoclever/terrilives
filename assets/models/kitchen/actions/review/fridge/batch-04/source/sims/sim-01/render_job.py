"""Apply the complete serialized action and camera state for one render."""
import bpy
import hashlib
import math
import numpy as np

FACINGS={'SE':90,'SW':0,'NW':270,'NE':180}


def apply_render_job(scene,rig,registration,action,facing,index):
    clip=registration[action]
    scene.render.resolution_x=clip['width']*16
    scene.render.resolution_y=clip['height']*16
    scene.render.resolution_percentage=100
    scene.camera.data.ortho_scale=clip['camera_ortho_scale']
    scene.camera.location=clip['camera_location']
    rig.location=(0,0,0)
    rig.rotation_euler=(0,0,math.radians(FACINGS[facing]))
    rig.animation_data.action=bpy.data.actions[action]
    scene.frame_set(index+1)
    bpy.context.view_layer.update()
    # Keyed rig properties and their saved drivers are the sole visibility owner.
    graph=bpy.context.evaluated_depsgraph_get()
    geometry=hashlib.sha256()
    visibility={}
    for obj in sorted(bpy.data.objects,key=lambda item:item.name):
        visibility[obj.name]=bool(obj.hide_render)
        if obj.type!='MESH' or obj.hide_render:
            continue
        evaluated=obj.evaluated_get(graph)
        mesh=evaluated.to_mesh()
        coords=np.empty(len(mesh.vertices)*3,dtype=np.float32)
        mesh.vertices.foreach_get('co',coords)
        geometry.update(obj.name.encode())
        geometry.update(coords.tobytes())
        geometry.update(np.array(evaluated.matrix_world,dtype=np.float32).tobytes())
        evaluated.to_mesh_clear()
    return {'geometry_sha256':geometry.hexdigest(),'visibility':visibility,
            'eyes_closed':rig['eyes_closed'],'book_visible':rig['book_visible'],
            'camera_matrix':[list(row) for row in scene.camera.matrix_world],
            'camera_scale':scene.camera.data.ortho_scale,
            'resolution':[scene.render.resolution_x,scene.render.resolution_y]}
