"""Check evaluated, saved hand meshes against the actual mop shaft in every view."""
import hashlib,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE=Path(__file__).resolve().parent
SIM=BASE.parent/'sims/sim-01';sys.path.insert(0,str(SIM))
from render_job import apply_render_job


def main():
    bpy.ops.wm.open_mainfile(filepath=str(BASE/'cleaning.blend'))
    scene=bpy.context.scene;rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    proof=json.loads((BASE/'export/proof.json').read_text())
    assert hashlib.sha256((BASE/'cleaning.blend').read_bytes()).hexdigest()==proof['model_sha256']
    registration=json.loads((BASE/'export/green/manifest.json').read_text())['clips']
    results=[]
    for facing in ['SE','NW','SW','NE']:
        for frame in [0,2,4,6]:
            apply_render_job(scene,rig,registration,'mop',facing,frame)
            graph=bpy.context.evaluated_depsgraph_get()
            shaft=bpy.data.objects['Mop shaft'].matrix_world
            axis=(shaft.to_3x3()@Vector((0,0,1))).normalized()
            radial=(Vector((1,0,0))-axis*axis.x).normalized();across=axis.cross(radial)
            witness=next(row for row in proof['contacts'] if row['action']=='mop' and row['frame']==frame)
            for side,label,radius in [('L','left_hand',.014),('R','right_hand',.023)]:
                parts=[obj for obj in bpy.data.objects if obj.type=='MESH' and obj.name.startswith('Mop ') and obj.vertex_groups.get('hand.'+side)]
                assert len(parts)==7 and all(not obj.hide_render for obj in parts)
                vertices=[];faces=[]
                for obj in parts:
                    evaluated=obj.evaluated_get(graph);mesh=evaluated.to_mesh();offset=len(vertices)
                    vertices.extend(evaluated.matrix_world@v.co for v in mesh.vertices)
                    faces.extend(tuple(offset+index for index in face.vertices) for face in mesh.polygons)
                    evaluated.to_mesh_clear()
                surface=BVHTree.FromPolygons(vertices,faces)
                center=rig.matrix_world@Vector(witness[label])
                offset=center-shaft.translation
                assert (offset-axis*offset.dot(axis)).length<.00001,'Hand center is off the shaft'
                distances=[]
                for degrees in range(0,360,5):
                    angle=math.radians(degrees);direction=radial*math.cos(angle)+across*math.sin(angle)
                    hit,_,_,distance=surface.ray_cast(center+axis*.012,direction,.15)
                    assert hit is not None,(facing,frame,side,degrees,'open grip')
                    distances.append(distance)
                assert min(distances)>=radius-.001,(facing,frame,side,'skin inside handle')
                assert max(distances)<=radius+.016,(facing,frame,side,'grip too loose')
                results.append({'facing':facing,'frame':frame,'hand':side,'covered_degrees':360,
                                'minimum_skin_radius':min(distances),'maximum_skin_radius':max(distances)})
    (BASE/'grip-validation.json').write_text(json.dumps({'state':'complete','model_sha256':proof['model_sha256'],'checks':results},indent=2)+'\n')


if __name__=='__main__':main()
