"""Export complete architecture with immutable originals and paired surface roles."""
import hashlib
import json
from pathlib import Path
import sys
import time
import traceback

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
sys.path.insert(0,str(BASE))
from render_review import material, joined_mesh, bvh_for, SIM, DENSITY
from windows import Prism, window_cases, model_parts, MODELS
from walls import wall_cases, owner_arm
from floors import floor_cases, pattern_rgb, PATTERN_SIZE
from materials import COLORS, ROLES, catalogue
from check_scene import validate_case, part_record


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    names=('geometry.py','render_review.py','windows.py','walls.py','floors.py',
           'materials.py','render_batch.py','check_scene.py')
    paths=[BASE/name for name in names]+[SIM/'sim-01-rigged.blend',SIM/'registered-canvas-proof.json']
    return {p.relative_to(ROOT).as_posix():digest(p) for p in paths}


def mesh_objects(parts,zscale,materials,seam_axis=None):
    boxes=[p for p in parts if not isinstance(p,Prism)]
    objects=joined_mesh(boxes,zscale,materials,seam_axis)
    for p in parts:
        if not isinstance(p,Prism): continue
        n=len(p.polygon)
        vertices=[(x,-y,z*zscale) for x,y,z in p.vertices]
        faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh=bpy.data.meshes.new(p.name); mesh.from_pydata(vertices,[],faces); mesh.update()
        import bmesh
        bm=bmesh.new(); bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
        obj=bpy.data.objects.new('Architecture '+p.material,mesh)
        bpy.context.scene.collection.objects.link(obj); mesh.materials.append(materials[p.material]); objects.append(obj)
    return objects


def role_for(obj):
    key=obj.name.split('Architecture ',1)[1].split('.')[0]
    return ROLES['wall' if key=='plaster' else 'floor' if key.startswith('floor-') else
                 'glazing' if key=='glass' else 'trim' if key=='trim' else 'frame']


def surfaces(scene,objects,width,height,zscale,case):
    _,normal_checks=bvh_for(objects)
    graph=bpy.context.evaluated_depsgraph_get()
    vertices=[]; faces=[]; roles=[]
    for obj in objects:
        evaluated=obj.evaluated_get(graph); mesh=evaluated.to_mesh(); offset=len(vertices)
        vertices.extend(evaluated.matrix_world@v.co for v in mesh.vertices)
        for p in mesh.polygons:
            faces.append(tuple(offset+i for i in p.vertices)); roles.append(role_for(obj))
        evaluated.to_mesh_clear()
    tree=BVHTree.FromPolygons(vertices,faces)
    matrix=scene.camera.matrix_world; rotation=matrix.to_quaternion()
    right=rotation@Vector((1,0,0)); up=rotation@Vector((0,1,0)); forward=rotation@Vector((0,0,-1))
    pitch=scene.camera.data.ortho_scale/max(width,height)
    depth=np.full((height,width),np.nan,dtype=np.float32)
    role=np.zeros((height,width),dtype=np.uint8)
    owner=np.zeros((height,width),dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            ray=matrix.translation+right*((x+.5-width/2)*pitch)+up*((height/2-y-.5)*pitch)
            point,normal,face,distance=tree.ray_cast(ray,forward)
            if point is None: continue
            gx,gy=point.x,-point.y
            depth[y,x]=gx+gy; role[y,x]=roles[face]
            if case['kind']=='junction': owner[y,x]=owner_arm(gx,gy,case['armHeights'])+1
            elif case['kind']=='window':
                along=gx if case['direction'].startswith('x') else gy
                owner[y,x]=min(case['width']-1,max(0,int(np.floor(along+case['width']/2))))+1
            else: owner[y,x]=1
    # Carry exactly the same nearest owner through all paired fringe channels.
    for _ in range(4):
        missing=np.isnan(depth)
        changed=depth.copy(); changed_role=role.copy(); changed_owner=owner.copy()
        for dy,dx in ((0,-1),(0,1),(-1,0),(1,0),(-1,-1),(-1,1),(1,-1),(1,1)):
            neighbor=np.roll(depth,(dy,dx),(0,1)); valid=missing&np.isfinite(neighbor)
            if dy<0: valid[dy:,:]=False
            if dy>0: valid[:dy,:]=False
            if dx<0: valid[:,dx:]=False
            if dx>0: valid[:,:dx]=False
            changed[valid]=neighbor[valid]
            changed_role[valid]=np.roll(role,(dy,dx),(0,1))[valid]
            changed_owner[valid]=np.roll(owner,(dy,dx),(0,1))[valid]
            missing[valid]=False
        depth,role,owner=changed,changed_role,changed_owner
    return np.nan_to_num(depth).astype('<f2'),role,owner,normal_checks


def floor_material(name,neutral):
    result=neutral.copy(); result.name='Architecture floor-'+name
    image=bpy.data.images.new('Pattern '+name,width=PATTERN_SIZE,height=PATTERN_SIZE,alpha=True)
    values=[]
    for y in range(PATTERN_SIZE):
        for x in range(PATTERN_SIZE): values.extend((*pattern_rgb(name,x,y),1))
    image.colorspace_settings.name='Non-Color'; image.pixels[:]=values
    tree=result.node_tree; emission=next(n for n in tree.nodes if n.type=='EMISSION')
    shade=emission.inputs['Color'].links[0].from_socket
    geometry=tree.nodes.new('ShaderNodeNewGeometry'); separate=tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(geometry.outputs['Position'],separate.inputs[0])
    combine=tree.nodes.new('ShaderNodeCombineXYZ')
    for axis,index,scale in (('X',0,.25),('Y',1,-.25)):
        mul=tree.nodes.new('ShaderNodeMath'); mul.operation='MULTIPLY_ADD'
        tree.links.new(separate.outputs[axis],mul.inputs[0]); mul.inputs[1].default_value=scale; mul.inputs[2].default_value=.125
        tree.links.new(mul.outputs[0],combine.inputs[index])
    texture=tree.nodes.new('ShaderNodeTexImage'); texture.image=image; texture.interpolation='Closest'; texture.extension='REPEAT'
    tree.links.new(combine.outputs[0],texture.inputs['Vector'])
    mix=tree.nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'; mix.inputs[0].default_value=1
    tree.links.new(shade,mix.inputs[1]); tree.links.new(texture.outputs['Color'],mix.inputs[2]); tree.links.new(mix.outputs[0],emission.inputs['Color'])
    return result


def run(directory):
    assert bpy.app.background, 'Use hidden background Blender'
    directory.mkdir(parents=True,exist_ok=False)
    receipt={'schema':1,'state':'running','background':True,'blender_version':bpy.app.version_string,
             'inputs':inputs(),'renders':[],'catalogue':catalogue(),
             'models':{str(i):{'key':key,'width':width,'parts':[part_record(p) for p in model_parts(i)]} for i,(key,width) in MODELS.items()}}
    def save(): (directory/'proof.json').write_text(json.dumps(receipt,indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM/'sim-01-rigged.blend'))
        scene=bpy.context.scene
        hidden=bpy.data.collections.new('Preserved reference geometry'); scene.collection.children.link(hidden)
        for obj in list(bpy.data.objects):
            if obj.type in ('MESH','CURVE'):
                for collection in list(obj.users_collection): collection.objects.unlink(obj)
                hidden.objects.link(obj)
        hidden.hide_render=True
        registration=json.loads((SIM/'registered-canvas-proof.json').read_text())['idle']
        scene.camera.location=registration['camera_location']; scene.camera.data.ortho_scale=registration['camera_ortho_scale']
        scene.render.resolution_x=38; scene.render.resolution_y=88; scene.render.resolution_percentage=100
        bpy.context.view_layer.update()
        def project(point):
            q=world_to_camera_view(scene,scene.camera,Vector(point)); return (q.x*38,(1-q.y)*88)
        origin=project((0,0,0)); pz=project((0,0,1)); zscale=38/(origin[1]-pz[1])
        for point,expected in (((1,0,0),(32,21)),((0,-1,0),(-32,21))):
            actual=project(point); assert max(abs(actual[i]-origin[i]-expected[i]) for i in (0,1))<.01, 'camera basis changed'
        receipt['registration']={'game_basis':[[32,21],[-32,21],[0,-38]],'architecture_z_scale':zscale,'pixel_density':2}
        scene.render.film_transparent=True; scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
        scene.render.threads_mode='FIXED'; scene.render.threads=2; scene.render.use_freestyle=False
        if scene.render.engine=='BLENDER_EEVEE_NEXT': scene.eevee.taa_render_samples=32
        materials={key:material(key,color) for key,color in COLORS.items()}
        for name in ('boards','tiles','carpet','neutral','grass','street'): materials['floor-'+name]=floor_material(name,materials['neutral'])
        initial=scene.camera.location.copy(); rotation=scene.camera.matrix_world.to_quaternion()
        right=rotation@Vector((1,0,0)); up=rotation@Vector((0,1,0))
        cases=list(window_cases())+list(wall_cases())+list(floor_cases())
        receipt['expected_count']=len(cases)
        for case in cases:
            started=time.perf_counter(); geometry=validate_case(case)
            name=case['geometryKey']; floor=case['kind']=='floor-patch'
            width,height=(280,208) if floor else (160,192)
            target=(140,34) if floor else (80,128)
            seam=(0 if case['direction'].startswith('x') else 1) if case['kind']=='straight' else None
            objects=mesh_objects(case['parts'],zscale,materials,seam)
            scene.render.resolution_x=width*2; scene.render.resolution_y=height*2
            scene.camera.data.ortho_scale=registration['camera_ortho_scale']*max(width,height)/88
            scene.camera.location=initial; bpy.context.view_layer.update()
            q=world_to_camera_view(scene,scene.camera,Vector((0,0,0))); ppu=88/registration['camera_ortho_scale']
            scene.camera.location+=right*((q.x*width-target[0])/ppu)+up*((target[1]-(1-q.y)*height)/ppu)
            bpy.context.view_layer.update()
            q=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
            assert max(abs(a-b) for a,b in zip((q.x*width,(1-q.y)*height),target))<.002, 'origin registration changed'
            scene.render.filepath=str(directory/(name+'.png')); bpy.ops.render.render(write_still=True)
            depth,roles,owners,normal_checks=surfaces(scene,objects,width*2,height*2,zscale,case)
            depth.tofile(directory/(name+'.r16f')); roles.tofile(directory/(name+'.roles')); owners.tofile(directory/(name+'.owners'))
            for obj in objects:
                if role_for(obj) in (1,2): obj.data.materials[0]=materials['neutral']
            scene.render.filepath=str(directory/(name+'.carrier.png')); bpy.ops.render.render(write_still=True)
            record={k:v for k,v in case.items() if k!='parts'}
            record.update(widthPixels=width*2,heightPixels=height*2,origin=list(target),pixelDensity=2,
                          physicalBounds=geometry['bounds'],logicalBounds=[0,0,width,height],
                          color=name+'.png',carrier=name+'.carrier.png',depth=name+'.r16f',
                          roles=name+'.roles',owners=name+'.owners',normalChecks=normal_checks,
                          seconds=time.perf_counter()-started)
            record['hashes']={key:digest(directory/record[key]) for key in ('color','carrier','depth','roles','owners')}
            receipt['renders'].append(record); save()
            for obj in objects: bpy.data.objects.remove(obj,do_unlink=True)
        assert receipt['inputs']==inputs(), 'render source changed'
        receipt['state']='complete'; save()
    except Exception:
        receipt['state']='failed'; receipt['error']=traceback.format_exc(); save(); raise


if __name__=='__main__': run(Path(sys.argv[sys.argv.index('--')+1]).resolve())
