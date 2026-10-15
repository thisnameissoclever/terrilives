"""Reconstruct a floor-supported book from retained canonical source geometry."""
from pathlib import Path
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tomllib
import traceback

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[3]
MODELS=ROOT/'assets/models'
OUT=BASE/'dropped-book'
sys.path.insert(0,str(BASE))
from depth_geometry import Pages,digest,geometry,sample
from export_components import image_bytes


def main():
    global OUT
    arguments=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if arguments:
        if len(arguments)!=2 or arguments[0]!='--output':raise ValueError('Expected --output DIRECTORY')
        OUT=Path(arguments[1]).resolve()
    OUT.mkdir(exist_ok=True,parents=True)
    source=MODELS/'sims/sim-01/sim-01-rigged.blend'
    accepted=MODELS/'reading/dropped/export/manifest.json'
    reference=json.loads(accepted.read_text())
    receipt_path=MODELS/'reading/dropped/pose-complete-dropped-renders-01/physical-proof.json'
    receipt=json.loads(receipt_path.read_text())
    atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    rows={row['name']:(index,row) for index,row in enumerate(atlas['sprite'])}
    report=dict(version=1,state='running',representation='reconstructed-source-geometry',
                colorPreservation='exact-published-rgba',originalSurfaceRecovered=False,
                reconstructionReason='Published dropped-book scene is absent from the worktree and reachable Git source history.',
                unavailableOriginalSceneSha256=receipt['scene']['sha256'],
                source=dict(path=source.relative_to(ROOT).as_posix(),sha256=digest(source)),
                comparison=dict(path=accepted.relative_to(ROOT).as_posix(),sha256=digest(accepted)),
                physicalReceipt=dict(path=receipt_path.relative_to(ROOT).as_posix(),sha256=digest(receipt_path)),
                encoding='rg-u16-unorm-x-minus-y-range-minus2-plus2',states=[],
                producerHashes={p.name:digest(p) for p in [Path(__file__),BASE/'fit_dropped_book.py',BASE/'depth_geometry.py',BASE/'color_pixels.py']})
    def save():
        (OUT/'manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    try:
        bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False)
        rig=bpy.data.objects['SIM_01_SHARED_RIG']
        rig.animation_data.action=bpy.data.actions['read']
        rig['book_visible']=1.
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        graph=bpy.context.evaluated_depsgraph_get()
        parts=[]
        source_parts=[]
        for name in receipt['source_parts']:
            obj=bpy.data.objects[name]
            evaluated=obj.evaluated_get(graph)
            mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=graph)
            mesh.transform(evaluated.matrix_world)
            copy=bpy.data.objects.new('Dropped '+name,mesh)
            bpy.context.scene.collection.objects.link(copy)
            parts.append(copy)
            source_parts.append(dict(name=name,vertices=len(mesh.vertices),polygons=len(mesh.polygons),materials=[mat.name for mat in mesh.materials]))
        vertices=np.array([list(vertex.co) for obj in parts for vertex in obj.data.vertices])
        canonical_vertices=vertices.copy()
        cover=next(obj for obj in parts if obj.name=='Dropped Reading book cover')
        cover.data.calc_loop_triangles()
        selected=None
        # A real cover triangle must support all retained book geometry.
        for index,tri in enumerate(cover.data.loop_triangles):
            a,b,c=[cover.data.vertices[i].co for i in tri.vertices]
            normal=(b-a).cross(c-a)
            if normal.length<1e-8:continue
            area=normal.length
            normal.normalize()
            distances=(vertices-np.array(a))@np.array(normal)
            if distances.min()>=-1e-6:
                candidate=(area,index,normal,a)
            elif distances.max()<=1e-6:
                candidate=(area,index,-normal,a)
            else:continue
            if selected is None or candidate[0]>selected[0]:selected=candidate
        if selected is None:raise ValueError('No retained cover face supports the complete book')
        area,triangle,normal,point=selected
        rotation=normal.rotation_difference(Vector((0,0,1))).to_matrix().to_4x4()
        for obj in parts:obj.data.transform(rotation)
        vertices=np.array([list(vertex.co) for obj in parts for vertex in obj.data.vertices])
        translation=Matrix.Translation(Vector((-(vertices[:,0].min()+vertices[:,0].max())/2,
                                                -(vertices[:,1].min()+vertices[:,1].max())/2,
                                                .0005-vertices[:,2].min())))
        for obj in parts:obj.data.transform(translation)
        placed_vertices=np.array([list(vertex.co) for obj in parts for vertex in obj.data.vertices])
        shape_error=float(np.abs(np.linalg.norm(canonical_vertices[:,None,:]-canonical_vertices[None,:,:],axis=2)-
                                  np.linalg.norm(placed_vertices[:,None,:]-placed_vertices[None,:,:],axis=2)).max())
        if shape_error>1e-6:raise ValueError('Rigid reconstruction changed canonical book dimensions')
        root=bpy.data.objects.new('RECONSTRUCTED_DROPPED_BOOK_MODEL_ROOT',None)
        bpy.context.scene.collection.objects.link(root)
        for obj in parts:obj.parent=root
        for obj in list(bpy.data.objects):
            if obj not in parts and obj!=root and obj.type not in ('CAMERA','LIGHT'):
                bpy.data.objects.remove(obj,do_unlink=True)
        scene=bpy.context.scene
        camera_path=MODELS/'living/owner-review-pending/armchair/candidate-03/proof.json'
        camera_proof=json.loads(camera_path.read_text())
        report['cameraSource']=dict(path=camera_path.relative_to(ROOT).as_posix(),sha256=digest(camera_path))
        scene.camera.matrix_world=Matrix(camera_proof['camera_matrix'])
        scene.camera.data.ortho_scale=camera_proof['ortho_scale']
        scene.camera.data.shift_x=scene.camera.data.shift_y=0
        scene.render.resolution_x,scene.render.resolution_y=768,960
        scene.render.resolution_percentage=100
        scene.render.threads_mode='FIXED'
        scene.render.threads=2
        scene.render.film_transparent=True
        scene.render.image_settings.file_format='PNG'
        scene.render.image_settings.color_mode='RGBA'
        stroke_width=max((line.linestyle.thickness for line in bpy.context.view_layer.freestyle_settings.linesets),default=0)
        source_density=scene.render.resolution_y/240
        outline_half_width=stroke_width*scene.render.line_thickness/source_density/2
        outline_support=3+math.sqrt(.5)+outline_half_width
        def project(point):
            projected=world_to_camera_view(scene,scene.camera,Vector(point))
            return np.array([projected.x*192,(1-projected.y)*240])
        origin=project((0,0,0))
        vertices,triangles,_=geometry(parts)
        fit_geometry=dict(vertices=[list(point) for point in vertices],triangles=triangles,origin=origin.tolist(),
                          basis=[(project(point)-origin).tolist() for point in [(1,0,0),(0,1,0),(0,0,1)]],
                          canvas=[192,240],outlineHalfWidthPixels=outline_half_width)
        geometry_path=OUT/'fit-geometry.json'
        geometry_path.write_text(json.dumps(fit_geometry),encoding='utf-8')
        subprocess.run([shutil.which('python'),str(BASE/'fit_dropped_book.py'),str(geometry_path),str(accepted),str(OUT)],
                       check=True,capture_output=True)
        fit=json.loads((OUT/'fit-result.json').read_text(encoding='utf-8'))
        report['fitGeometry']=dict(path=geometry_path.name,sha256=digest(geometry_path))
        report['fitResult']=dict(path='fit-result.json',sha256=digest(OUT/'fit-result.json'))
        facings={'SE':90,'NW':270,'SW':0,'NE':180}
        yaw=fit['yawDegrees']
        report['placement']=dict(yawDegrees=yaw,floorGap=.0005,supportPart='Reading book cover',supportTriangle=triangle,
                                  twiceSupportArea=area,scale=1.,maximumShapeError=shape_error,
                                  minimumFloorGap=float(placed_vertices[:,2].min()),
                                  maximumHeight=float(placed_vertices[:,2].max()))
        report['fit']=fit
        report['outlineSupport']=dict(sourceStrokeWidth=stroke_width,sourceLineThickness=scene.render.line_thickness,
                                     sourceDensity=source_density,halfStrokePixels=outline_half_width,
                                     lanczosRadiusPixels=3,pixelCenterRadius=math.sqrt(.5),maximumDistancePixels=outline_support)
        report['camera']=dict(matrix=[list(row) for row in scene.camera.matrix_world],orthoScale=scene.camera.data.ortho_scale,
                              originPixels=origin.tolist(),canvas=[192,240])
        report['environment']=dict(blenderVersion=bpy.app.version_string,background=bpy.app.background,threads=scene.render.threads)
        report['sourceParts']=source_parts
        root.rotation_euler.z=math.radians(yaw)
        bpy.context.view_layer.update()
        bpy.context.preferences.filepaths.save_version=0
        model=OUT/'reconstructed-dropped-book.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        report['model']=dict(path=model.name,sha256=digest(model))
        colors,depths=Pages(OUT,'color'),Pages(OUT,'depth')
        for facing,degrees in facings.items():
            root.rotation_euler.z=math.radians(degrees+yaw)
            bpy.context.view_layer.update()
            path=OUT/f'{facing}-source.png'
            scene.render.filepath=str(path)
            bpy.ops.render.render(write_still=True)
            target=next(row for row in reference['records'] if row['facing']==facing)
            original=target['sprite']
            original_path=accepted.parent/original['path']
            if digest(original_path)!=original['sha256']:raise ValueError('Published source PNG changed')
            pixels=image_bytes('resize',original_path,OUT/f'{facing}.rgba',[original['width'],original['height']])
            if hashlib.sha256(pixels.tobytes()).hexdigest()!=original['pixelsSha256']:raise ValueError('Published pixels changed')
            color=np.zeros((240,192,4),dtype=np.uint8)
            x0,y0,x1,y1=original['rawCrop']
            color[y0:y1,x0:x1]=pixels
            depth,proof,_,_=sample(parts,192,240,color[:,:,3]>0,max_edge_distance=outline_support)
            index,sprite=rows['ownedDroppedBook'+facing]
            atlas_pixels=image_bytes('crop',ROOT/'web/public'/atlas['pages'][sprite.get('page',0)],OUT/f'{facing}-atlas.rgba',
                                     [sprite['x'],sprite['y'],sprite['w'],sprite['h']])
            if not np.array_equal(atlas_pixels,pixels):raise ValueError('Published atlas differs from its source PNG')
            report['states'].append(dict(id='dropped-book-'+facing,family='dropped-book',facing=facing,atlasIndex=index,
                pixelDensity=2,anchorOffset=target['sprite']['trim'][:2],color=colors.add(color),depth=depths.add(depth),
                replacementColor=False,actorFree=True,publishedColor=dict(path=original_path.relative_to(ROOT).as_posix(),
                sha256=original['sha256'],pixelsSha256=original['pixelsSha256'],rawCrop=original['rawCrop']),
                publishedColorMaxDifference=0,**proof))
            save()
        report['colorPages']=colors.save()
        report['depthPages']=depths.save()
        for key in ['source','comparison','physicalReceipt','cameraSource']:
            if digest(ROOT/report[key]['path'])!=report[key]['sha256']:raise ValueError('Published input changed: '+key)
        report['state']='complete'
        save()
    except Exception:
        report['state']='failed'
        report['error']=traceback.format_exc()
        save()
        raise


if __name__=='__main__':main()
