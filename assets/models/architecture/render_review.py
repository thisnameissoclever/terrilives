"""Export an isolated architecture candidate through the accepted Blender scene."""
import hashlib
import json
import math
from pathlib import Path
import sys
import time
import traceback

import bpy
import bmesh
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0,str(Path(__file__).resolve().parent))
from geometry import (wall,window_wall,doorway,corner,floor,room_wall,rotate,clip,
                      CUT_HEIGHT,VERTICAL_UNIT,box)

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[2]
SIM=BASE.parent/'sims/sim-01'
DENSITY=2
PALETTE={'plaster':(.69,.62,.50),'trim':(.80,.74,.62),'cream':(.79,.74,.62),
         'steel':(.20,.235,.24),'bronze':(.31,.235,.15),'glass':(.25,.40,.49),
         'oak':(.43,.25,.12),'tile':(.69,.70,.66),'carpet':(.26,.37,.37),
         'grout':(.47,.48,.45),'oak2':(.49,.30,.15),'oak3':(.38,.215,.105)}


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def material(name,color):
    source=bpy.data.materials['Washed sage overshirt']
    result=source.copy()
    result.name='Architecture '+name
    base=tuple(source.diffuse_color)
    result.diffuse_color=(*color,1)
    for node in result.node_tree.nodes:
        if node.type == 'VALTORGB':
            for stop in node.color_ramp.elements:
                old=tuple(stop.color)
                stop.color=tuple(color[i]*old[i]/max(base[i],.0001) for i in range(3))+(1,)
    if name in ('carpet','oak','oak2','oak3','plaster','glass'):
        tree=result.node_tree
        emission=next(n for n in tree.nodes if n.type == 'EMISSION')
        old=emission.inputs['Color'].links[0].from_socket
        tex=tree.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value=95 if name=='carpet' else 35
        tex.inputs['Detail'].default_value=2
        ramp=tree.nodes.new('ShaderNodeValToRGB')
        lo=.88 if name=='carpet' else .97
        ramp.color_ramp.elements[0].color=(lo,lo,lo,1)
        ramp.color_ramp.elements[1].color=(1,1,1,1)
        mix=tree.nodes.new('ShaderNodeMixRGB'); mix.blend_type='MULTIPLY'
        mix.inputs[0].default_value=1
        tree.links.new(tex.outputs['Fac'],ramp.inputs[0])
        tree.links.new(old,mix.inputs[1]); tree.links.new(ramp.outputs[0],mix.inputs[2])
        tree.links.new(mix.outputs[0],emission.inputs['Color'])
        if name=='glass':
            coordinates=tree.nodes.new('ShaderNodeTexCoord')
            separate=tree.nodes.new('ShaderNodeSeparateXYZ')
            tree.links.new(coordinates.outputs['Generated'],separate.inputs[0])
            diagonal=tree.nodes.new('ShaderNodeMath'); diagonal.operation='ADD'
            tree.links.new(separate.outputs['X'],diagonal.inputs[0]); tree.links.new(separate.outputs['Z'],diagonal.inputs[1])
            stripe=tree.nodes.new('ShaderNodeMath'); stripe.operation='PINGPONG'; stripe.inputs[1].default_value=.7
            tree.links.new(diagonal.outputs[0],stripe.inputs[0])
            band=tree.nodes.new('ShaderNodeMath'); band.operation='GREATER_THAN'; band.inputs[1].default_value=.50
            tree.links.new(stripe.outputs[0],band.inputs[0])
            reflection=tree.nodes.new('ShaderNodeMixRGB'); reflection.blend_type='SCREEN'
            reflection.inputs[2].default_value=(.055,.07,.075,1)
            tree.links.new(band.outputs[0],reflection.inputs[0]); tree.links.new(mix.outputs[0],reflection.inputs[1])
            tree.links.new(reflection.outputs[0],emission.inputs['Color'])
    return result


def joined_mesh(parts,zscale,materials,seam_axis=None):
    """Cancel coincident cell faces, then dissolve coplanar edges before beveling."""
    by_material={}
    for part in parts: by_material.setdefault(part.material,[]).append(part)
    objects=[]
    for key,group in by_material.items():
        vertices=[]; faces={}; indices={}
        for part in group:
            a,b=part.lower,part.upper
            coords=[(x,-y,z*zscale) for z in (a[2],b[2]) for y in (a[1],b[1]) for x in (a[0],b[0])]
            ids=[]
            for point in coords:
                point=tuple(round(v,8) for v in point)
                if point not in indices:
                    indices[point]=len(vertices); vertices.append(point)
                ids.append(indices[point])
            for face in ((0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3)):
                polygon=tuple(ids[i] for i in face)
                canonical=tuple(sorted(polygon))
                if canonical in faces: del faces[canonical]
                else: faces[canonical]=polygon
        mesh=bpy.data.meshes.new('Joined '+key)
        mesh.from_pydata(vertices,[],list(faces.values())); mesh.update()
        bm=bmesh.new(); bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bmesh.ops.dissolve_limit(bm,angle_limit=.001,verts=list(bm.verts),edges=list(bm.edges),delimit={'NORMAL'})
        bm.to_mesh(mesh); bm.free()
        obj=bpy.data.objects.new('Architecture '+key,mesh)
        bpy.context.scene.collection.objects.link(obj); obj.data.materials.append(materials[key])
        # Plaster's coordinates remain exact; only true external corners bevel.
        bevel=max(p.bevel for p in group)
        if key=='plaster': bevel=.007
        if bevel:
            mod=obj.modifiers.new('Restrained edge bevel','BEVEL'); mod.width=bevel
            mod.segments=2; mod.limit_method='ANGLE'
            if seam_axis is not None:
                # Only edges running along a segment bevel. Shared end faces
                # remain on their authored plane with no notch between tiles.
                weights=mesh.attributes.new('bevel_weight_edge','FLOAT','EDGE')
                for edge in mesh.edges:
                    delta=mesh.vertices[edge.vertices[1]].co-mesh.vertices[edge.vertices[0]].co
                    parallel=abs(delta[seam_axis])>.001 and all(abs(delta[i])<.0001 for i in range(3) if i!=seam_axis)
                    weights.data[edge.index].value=1 if parallel else 0
                mod.limit_method='WEIGHT'
            # Keep geometric face normals. Weighted normals pull segment end
            # normals into flat caps and bake a repeating shade band at joins.
        objects.append(obj)
    return objects


def floor_parts(name):
    if name=='carpet': return floor(name)
    if name=='tile':
        result=floor('tile')
        result[0]=box('Grout bed',-.5,.5,-.5,.5,-.012,-.002,'grout')
        for x in (-.5,0):
            for y in (-.5,0): result.append(box('Ceramic',x+.005,x+.495,y+.005,y+.495,-.002,0,'tile',.001))
        return result
    result=[box('Board gaps',-.5,.5,-.5,.5,-.012,-.002,'oak3')]
    for row in range(4):
        ends=(-.5,0,.5) if row%2 else (-.5,.5)
        for index,(x0,x1) in enumerate(zip(ends,ends[1:])):
            result.append(box('Oak board',x0+.003,x1-.003,-.5+row*.25+.003,-.25+row*.25-.003,-.002,0,
                              ('oak','oak2','oak3')[(row+index)%3],.001))
    return result


def bvh_for(objects):
    vertices=[]; faces=[]; normal_checks=0
    graph=bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated=obj.evaluated_get(graph); mesh=evaluated.to_mesh(); offset=len(vertices)
        for poly in mesh.polygons:
            # Pin planar caps and sides; tiny bevel slivers have unstable
            # polygon normals and are outside this shading invariant.
            if max(abs(v) for v in poly.normal) < .9999: continue
            for loop in poly.loop_indices:
                assert mesh.corner_normals[loop].vector.dot(poly.normal) > .9999, 'Architecture face normal is blended across an edge'
                normal_checks+=1
        vertices.extend(evaluated.matrix_world@v.co for v in mesh.vertices)
        faces.extend(tuple(offset+i for i in poly.vertices) for poly in mesh.polygons)
        evaluated.to_mesh_clear()
    return BVHTree.FromPolygons(vertices,faces),normal_checks


def depth_surface(scene,objects,width,height,zscale):
    tree,normal_checks=bvh_for(objects)
    matrix=scene.camera.matrix_world
    right=matrix.to_quaternion()@Vector((1,0,0)); up=matrix.to_quaternion()@Vector((0,1,0))
    forward=matrix.to_quaternion()@Vector((0,0,-1))
    pitch=scene.camera.data.ortho_scale/max(width,height)
    depth=np.full((height,width),np.nan,dtype=np.float32)
    witnesses=[]
    for y in range(height):
        for x in range(width):
            origin=matrix.translation+right*((x+.5-width/2)*pitch)+up*((height/2-y-.5)*pitch)
            point,normal,face,distance=tree.ray_cast(origin,forward)
            if point is None: continue
            # Blender +X/-Y are game +X/+Y, with a measured Z calibration.
            depth[y,x]=point.x-point.y
            if len(witnesses)<8 and x%7==0 and y%11==0:
                witnesses.append({'pixel':[x,y],'game_point':[point.x,-point.y,point.z/zscale],
                                  'sum':float(depth[y,x]),'normal':list(normal)})
    # At an antialiased edge the visible sample can lie just outside the center
    # ray. Nearest covered owner supplies depth, never a background-plane zero.
    for _ in range(4):
        missing=np.isnan(depth); changed=depth.copy()
        for dy,dx in ((0,-1),(0,1),(-1,0),(1,0),(-1,-1),(-1,1),(1,-1),(1,1)):
            neighbor=np.roll(depth,(dy,dx),(0,1))
            valid=missing&np.isfinite(neighbor)
            if dy<0: valid[dy:,:]=False
            if dy>0: valid[:dy,:]=False
            if dx<0: valid[:,dx:]=False
            if dx>0: valid[:,:dx]=False
            changed[valid]=neighbor[valid]; missing[valid]=False
        depth=changed
    depth=np.nan_to_num(depth)
    return depth.astype('<f2'),witnesses,normal_checks


def run(directory):
    assert bpy.app.background,'Use hidden background Blender'
    directory.mkdir(parents=True,exist_ok=False)
    inputs=[Path(__file__),BASE/'geometry.py',SIM/'sim-01-rigged.blend',SIM/'registered-canvas-proof.json']
    hashes={str(p.relative_to(ROOT)):digest(p) for p in inputs}
    proof={'state':'running','background':bpy.app.background,'blender_version':bpy.app.version_string,
           'source_density':DENSITY,'inputs':hashes,'renders':[],'approval':'Owner room review pending'}
    def save(): (directory/'proof.json').write_text(json.dumps(proof,indent=2)+'\n')
    save()
    try:
        bpy.ops.wm.open_mainfile(filepath=str(SIM/'sim-01-rigged.blend'))
        scene=bpy.context.scene
        hidden=bpy.data.collections.new('Preserved reference geometry')
        scene.collection.children.link(hidden)
        for obj in list(bpy.data.objects):
            if obj.type in ('MESH','CURVE'):
                for collection in list(obj.users_collection): collection.objects.unlink(obj)
                hidden.objects.link(obj)
        hidden.hide_render=True
        registration=json.loads((SIM/'registered-canvas-proof.json').read_text())['idle']
        scene.camera.location=registration['camera_location']
        scene.camera.data.ortho_scale=registration['camera_ortho_scale']
        scene.render.resolution_x=38; scene.render.resolution_y=88; scene.render.resolution_percentage=100
        bpy.context.view_layer.update()
        def p(point):
            v=world_to_camera_view(scene,scene.camera,Vector(point)); return [v.x*38,(1-v.y)*88]
        origin=p((0,0,0)); px=p((1,0,0)); py=p((0,-1,0)); pz=p((0,0,1))
        basis=[[q[i]-origin[i] for i in (0,1)] for q in (px,py,pz)]
        assert abs(basis[0][0]-32)<.01 and abs(basis[0][1]-21)<.01,basis
        zscale=VERTICAL_UNIT/-basis[2][1]
        proof['registration']={'source_basis':basis,'architecture_z_scale':zscale,
                               'game_basis':[[32,21],[-32,21],[0,-38]],'camera_matrix':[list(r) for r in scene.camera.matrix_world]}
        scene.render.film_transparent=True
        scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'
        scene.render.threads_mode='FIXED'; scene.render.threads=2
        scene.render.use_freestyle=False
        scene.render.engine='CYCLES' if scene.render.engine=='CYCLES' else 'BLENDER_EEVEE_NEXT'
        if scene.render.engine=='BLENDER_EEVEE_NEXT': scene.eevee.taa_render_samples=32
        materials={k:material(k,v) for k,v in PALETTE.items()}
        cases=[]
        for name,parts in [('straight',wall(1)),('corner',corner()),('doorway',doorway()),
                           ('sash',window_wall(1,'sash')),('sliding',window_wall(2,'sliding')),('picture',window_wall(3,'picture'))]:
            for axis,oriented in [('x',parts),('y',rotate(parts))]:
                for low in (False,True): cases.append((f'{name}-{axis}'+('-low' if low else ''),clip(oriented,CUT_HEIGHT) if low else oriented))
        for axis in ('x','y'): cases.append(('room-'+axis,room_wall(axis)))
        for name in ('oak','tile','carpet'): cases.append(('floor-'+name,floor_parts(name)))
        camera_rotation=scene.camera.matrix_world.to_quaternion()
        right=camera_rotation@Vector((1,0,0)); up=camera_rotation@Vector((0,1,0))
        initial_location=scene.camera.location.copy()
        for name,parts in cases:
            started=time.perf_counter()
            objects=joined_mesh(parts,zscale,materials,(0 if '-x' in name else 1) if name.startswith('straight-') else None)
            width,height=(224,224) if name.startswith('room-') else (128,192)
            if name.startswith('floor-'): width,height=72,52
            scene.render.resolution_x=width*DENSITY; scene.render.resolution_y=height*DENSITY
            scene.camera.data.ortho_scale=registration['camera_ortho_scale']*max(width,height)/88
            # Center world origin horizontally and leave twelve logical pixels below it.
            target=(width/2,26 if name.startswith('floor-') else (149 if name.startswith('room-') else 128))
            scene.camera.location=initial_location
            bpy.context.view_layer.update()
            q=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
            pixels_per_unit=88/registration['camera_ortho_scale']
            scene.camera.location+=right*((q.x*width-target[0])/pixels_per_unit)+up*((target[1]-(1-q.y)*height)/pixels_per_unit)
            bpy.context.view_layer.update()
            q=world_to_camera_view(scene,scene.camera,Vector((0,0,0)))
            measured=[q.x*width,(1-q.y)*height]
            assert max(abs(a-b) for a,b in zip(measured,target))<.002
            scene.render.filepath=str(directory/(name+'.png'))
            bpy.ops.render.render(write_still=True)
            depths,witnesses,normal_checks=depth_surface(scene,objects,width*DENSITY,height*DENSITY,zscale)
            depths.tofile(directory/(name+'.r16f'))
            proof['renders'].append({'name':name,'width':width*DENSITY,'height':height*DENSITY,'pixel_density':DENSITY,
                'origin':measured,'anchor':[measured[0],measured[1]+21],'color':name+'.png','depth':name+'.r16f',
                'color_sha256':digest(directory/(name+'.png')),'depth_sha256':digest(directory/(name+'.r16f')),
                'depth_bytes':depths.nbytes,'planar_corner_normals_checked':normal_checks,'render_seconds':time.perf_counter()-started,'witnesses':witnesses})
            save()
            for obj in objects: bpy.data.objects.remove(obj,do_unlink=True)
        assert hashes=={str(p.relative_to(ROOT)):digest(p) for p in inputs},'Render source changed'
        proof['state']='complete'; save()
    except Exception:
        proof['state']='failed'; proof['error']=traceback.format_exc(); save(); raise


if __name__=='__main__':
    run(Path(sys.argv[sys.argv.index('--')+1]).resolve())
