"""Read-only audit of a saved door scene; never renders or saves it."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def run(source,output):
    assert bpy.app.background
    assert not output.exists(), 'Never overwrite a scene audit receipt'
    before=digest(source)
    receipt={'state':'running','background':True,'sceneSha256Before':before,
             'auditScriptSha256':digest(Path(__file__)),'blenderVersion':bpy.app.version_string}
    def save(): output.write_text(json.dumps(receipt,indent=2)+'\n')
    try:
        bpy.ops.wm.open_mainfile(filepath=str(source))
        scene=bpy.context.scene
        root=bpy.data.objects['DOOR_MODEL'];frame=bpy.data.objects['FIXED_CASING'];leaf=bpy.data.objects['HINGED_LEAF']
        assert frame.parent==leaf.parent==root
        assert max(abs(v) for v in root.rotation_euler)<1e-8 and max(abs(v) for v in leaf.rotation_euler)<1e-8
        casing=bpy.data.objects['Continuous joined casing']; slab=bpy.data.objects['Solid door slab']
        threshold=bpy.data.objects['Flush floor threshold']
        bpy.context.view_layer.update()
        graph=bpy.context.evaluated_depsgraph_get()
        def bounds(obj):
            evaluated=obj.evaluated_get(graph); mesh=evaluated.to_mesh()
            points=[evaluated.matrix_world@v.co for v in mesh.vertices]
            result=[[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]
            evaluated.to_mesh_clear();return result
        casing_bounds=bounds(casing);slab_bounds=bounds(slab);threshold_bounds=bounds(threshold)
        faces=[casing_bounds[0][0],casing_bounds[1][0]]
        close=lambda actual,want: abs(actual-want)<1e-6
        assert close(faces[0],.43) and close(faces[1],.57)
        assert close(faces[1]-faces[0],.14)
        assert close(leaf.location.x-faces[0],.035)
        zscale=38/(32*math.sqrt(2)*math.cos(math.asin(21/32)))
        aperture_width=abs(casing.data.vertices[4].co.y-casing.data.vertices[7].co.y)
        aperture_height=casing.data.vertices[5].co.z/zscale
        assert close(aperture_width,.78) and close(aperture_height,1.8)
        assert close(slab_bounds[1][1]-slab_bounds[0][1],.73)
        assert threshold.get('floor_surface') is True
        assert close(threshold_bounds[0][0],faces[0]) and close(threshold_bounds[1][0],faces[1])
        assert close(threshold_bounds[1][2],0) and close(threshold_bounds[1][1]-threshold_bounds[0][1],.78)
        def project(point):
            q=world_to_camera_view(scene,scene.camera,Vector(point));return [q.x*112,(1-q.y)*120]
        origin=project((0,0,0));basis=[]
        for point,want in (((1,0,0),(32,21)),((0,-1,0),(-32,21)),((0,0,zscale),(0,-38))):
            projected=project(point);actual=[projected[i]-origin[i] for i in range(2)]
            assert max(abs(actual[i]-want[i]) for i in range(2))<.002
            basis.append(actual)
        assert max(abs(origin[i]-[56,99][i]) for i in range(2))<.002
        assert [scene.render.resolution_x,scene.render.resolution_y]==[336,360]
        assert scene.camera.data.type=='ORTHO' and scene.render.resolution_percentage==100
        meshes=[obj for obj in scene.objects if obj.type in ('MESH','CURVE')]
        descendants=set(root.children_recursive)
        assert all(obj in descendants for obj in meshes), 'reference geometry leaked into editable scene'
        assert not any('Preserved' in collection.name for collection in scene.collection.children)
        receipt.update(state='complete',evaluatedCasingFaces=faces,evaluatedCasingDepth=faces[1]-faces[0],
            leafHinge=list(leaf.location),leafFrontSeating=leaf.location.x-faces[0],
            apertureWidth=aperture_width,apertureHeight=aperture_height,
            evaluatedSlabBounds=slab_bounds,slabWidth=slab_bounds[1][1]-slab_bounds[0][1],
            evaluatedThresholdBounds=threshold_bounds,thresholdFloor=True,
            logicalOrigin=origin,gameBasis=basis,physicalCanvas=[336,360],density=3,
            referenceCollectionAbsent=True,modelMeshCount=len(meshes),allMeshesOwnedByDoor=True)
    except Exception:
        receipt.update(state='failed',error=traceback.format_exc());raise
    finally:
        receipt['sceneSha256After']=digest(source)
        assert receipt['sceneSha256After']==before, 'read-only scene audit changed source'
        save()


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    run(Path(args[0]).resolve(),Path(args[1]).resolve())
