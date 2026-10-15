"""Reopen the staged model and independently compare support and canonical shape."""
from pathlib import Path
import json
import math

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parents[4]
FOLDER=ROOT/'.scratch/book-preservation/dropped-book'
OUTPUT=Path(__file__).parent
manifest=json.loads((FOLDER/'manifest.json').read_text(encoding='utf-8'))
names=[row['name'] for row in manifest['sourceParts']]
bpy.ops.wm.open_mainfile(filepath=str(FOLDER/manifest['model']['path']),load_ui=False,use_scripts=False)
model=bpy.data.objects['RECONSTRUCTED_DROPPED_BOOK_MODEL_ROOT']
assert tuple(model.scale)==(1.,1.,1.)
assert {obj.name for obj in bpy.data.objects if obj.type=='MESH'}=={'Dropped '+name for name in names}
parts=[bpy.data.objects['Dropped '+name] for name in names]


def extract(objects):
    graph=bpy.context.evaluated_depsgraph_get()
    vertices,topology,materials=[],{},{}
    for name,obj in zip(names,objects):
        evaluated=obj.evaluated_get(graph)
        mesh=evaluated.to_mesh()
        mesh.calc_loop_triangles()
        vertices.extend([list(evaluated.matrix_world@vertex.co) for vertex in mesh.vertices])
        topology[name]=[list(triangle.vertices) for triangle in mesh.loop_triangles]
        materials[name]=[material.name for material in mesh.materials]
        evaluated.to_mesh_clear()
    return np.asarray(vertices),topology,materials


reconstructed,topology,materials=extract(parts)
facings=[]
for facing,degrees in {'SE':90,'NW':270,'SW':0,'NE':180}.items():
    model.rotation_euler.z=math.radians(manifest['placement']['yawDegrees']+degrees)
    bpy.context.view_layer.update()
    vertices,_,_=extract(parts)
    minimum=float(vertices[:,2].min())
    assert abs(minimum-.0005)<1e-6,(facing,minimum)
    cover=bpy.data.objects['Dropped Reading book cover']
    cover.data.calc_loop_triangles()
    triangle=cover.data.loop_triangles[manifest['placement']['supportTriangle']]
    a,b,c=[cover.matrix_world@cover.data.vertices[index].co for index in triangle.vertices]
    support_area=float(abs((b-a).cross(c-a).z)/2)
    assert support_area>.0017 and max(abs(point.z-.0005) for point in (a,b,c))<1e-6
    facings.append(dict(facing=facing,minimumFloorGap=minimum,supportArea=support_area,
                       supportTrianglePoints=[list(point) for point in (a,b,c)],belowFloorVertices=int((vertices[:,2]<0).sum())))
bpy.ops.wm.open_mainfile(filepath=str(ROOT/manifest['source']['path']),load_ui=False,use_scripts=False)
rig=bpy.data.objects['SIM_01_SHARED_RIG']
rig.animation_data.action=bpy.data.actions['read']
rig['book_visible']=1.
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
canonical,source_topology,source_materials=extract([bpy.data.objects[name] for name in names])
assert topology==source_topology
assert materials==source_materials
error=float(np.abs(np.linalg.norm(canonical[:,None,:]-canonical[None,:,:],axis=2)-
                   np.linalg.norm(reconstructed[:,None,:]-reconstructed[None,:,:],axis=2)).max())
assert error<1e-6,error
report=dict(state='complete',background=bpy.app.background,blenderVersion=bpy.app.version_string,
            sourcePartCount=len(names),onlyCanonicalBookMeshes=True,scale=1,
            orderedTrianglesEqual=True,materialsEqual=True,maximumPairwiseDistanceError=error,
            facings=facings,originalSurfaceRecovered=False)
(OUTPUT/'physical-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
