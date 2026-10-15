"""Author reusable character parts against the accepted rig's rest surfaces."""
import json
import math
import random

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from author_long_sleeves import continuous_sleeve_geometry, sleeve_weights


def rules(obj, *conditions, density=None):
    obj['creator_conditions'] = json.dumps(conditions)
    if density is not None:
        obj['creator_density'] = density
    return obj


def surface_tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        mesh.calc_loop_triangles()
        points = [obj.matrix_world @ v.co for v in mesh.vertices]
        return BVHTree.FromPolygons(points, [tuple(t.vertices) for t in mesh.loop_triangles], all_triangles=True)
    finally:
        evaluated.to_mesh_clear()


def bind(obj, rig, bone='head', region=1):
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(obj.data.vertices))), 1., 'REPLACE')
    obj.modifiers.new('Creator shared rig', 'ARMATURE').object = rig
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj['creator_region'] = region
    return obj


def mesh_object(name, vertices, faces, material, rig, bone='head', region=1):
    if not faces:
        raise ValueError(f'Empty authored part: {name}')
    used=sorted({index for face in faces for index in face})
    mapping={old:new for new,old in enumerate(used)}
    vertices=[vertices[index] for index in used]
    faces=[tuple(mapping[index] for index in face) for face in faces]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return bind(obj, rig, bone, region)


def curve(name, points, radius, material, rig, closed=False, bone='head', region=1):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 8
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points)-1)
    for point, value in zip(spline.bezier_points, points):
        point.co = value
        point.handle_left_type = point.handle_right_type = 'AUTO'
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(material)
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = bpy.data.meshes.new_from_object(evaluated)
    bpy.data.objects.remove(obj, do_unlink=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return bind(obj, rig, bone, region)


def sphere(name, point, radius, material, rig, bone='head', region=1):
    sectors,bands=12,8
    center=Vector(point);vertices=[tuple(center+Vector((0,0,radius)))];faces=[]
    for j in range(1,bands):
        theta=math.pi*j/bands
        for i in range(sectors):
            phi=math.tau*i/sectors
            vertices.append(tuple(center+radius*Vector((math.sin(theta)*math.cos(phi),math.sin(theta)*math.sin(phi),math.cos(theta)))))
    bottom=len(vertices);vertices.append(tuple(center-Vector((0,0,radius))))
    for i in range(sectors):
        faces.append((0,1+i,1+(i+1)%sectors))
        a=1+(bands-2)*sectors+i;b=1+(bands-2)*sectors+(i+1)%sectors
        faces.append((a,bottom,b))
    for j in range(bands-2):
        for i in range(sectors):
            a=1+j*sectors+i;b=1+j*sectors+(i+1)%sectors
            faces.append((a,a+sectors,b+sectors,b))
    return mesh_object(name,vertices,faces,material,rig,bone,region)


def copy_part(source, name, material=None, *, region):
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = name
    bpy.context.collection.objects.link(obj)
    obj['creator_region']=region
    if material:
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0
    return obj


def warp(obj, transform):
    world = obj.matrix_world.copy()
    inverse = world.inverted()
    for vertex in obj.data.vertices:
        vertex.co = inverse @ Vector(transform(world @ vertex.co))
    obj.data.update()


def trim_at_height(obj, height, keep_below):
    mesh=bmesh.new()
    try:
        mesh.from_mesh(obj.data)
        bmesh.ops.transform(mesh,matrix=obj.matrix_world,verts=list(mesh.verts))
        cut=bmesh.ops.bisect_plane(mesh,geom=list(mesh.verts)+list(mesh.edges)+list(mesh.faces),
            plane_co=(0,0,height),plane_no=(0,0,1),clear_outer=keep_below,clear_inner=not keep_below,dist=1e-6)
        edges=[edge for edge in cut['geom_cut'] if isinstance(edge,bmesh.types.BMEdge) and edge.is_boundary]
        bmesh.ops.holes_fill(mesh,edges=edges,sides=0)
        bmesh.ops.recalc_face_normals(mesh,faces=list(mesh.faces))
        bmesh.ops.transform(mesh,matrix=obj.matrix_world.inverted(),verts=list(mesh.verts))
        mesh.to_mesh(obj.data)
    finally:
        mesh.free()
    obj.data.update()


def flat_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    shader = nodes.new('ShaderNodeEmission')
    shader.inputs['Color'].default_value = (*color, 1)
    output = nodes.new('ShaderNodeOutputMaterial')
    mat.node_tree.links.new(shader.outputs[0], output.inputs['Surface'])
    return mat


def front_point(tree, x, z, offset=0.004):
    hit, normal, _, _ = tree.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
    if hit is None:
        raise ValueError(f'No head surface at {x}, {z}')
    return hit + normal * offset


def hair_cap(name, style, tree, material, rig):
    sectors, bands = 48, 20
    vertices, faces = [], []
    center = Vector((0, .0059, 1.6974))
    layer_size = sectors*bands+1
    for inner in (False, True):
        top, normal, _, _ = tree.ray_cast(center, Vector((0, 0, 1)))
        vertices.append(tuple(top+normal*(-.002 if inner else .018)))
        for j in range(1, bands+1):
            for i in range(sectors):
                phi = math.tau*i/sectors
                front = max(0., math.cos(phi))
                limit = 2.38-1.30*front**.45 if style=='wave' else 2.02-.90*front**1.5
                theta = limit*j/bands
                direction = Vector((math.sin(theta)*math.sin(phi), -math.sin(theta)*math.cos(phi), math.cos(theta)))
                hit, normal, _, _ = tree.ray_cast(center, direction)
                if hit is None:
                    raise ValueError('Hair cap ray missed the accepted head')
                offset = .018
                if style=='wave':
                    offset = .032 + .023*math.sin(theta)**2 + .011*math.cos(phi*9+theta*7)*math.sin(theta)
                if style=='quiff':
                    angle = (phi+.35+math.pi)%math.tau-math.pi
                    offset += .15*math.exp(-((theta-.60)/.38)**2-(angle/.7)**2)*min(1,theta/.18)
                if inner:
                    offset = -.002
                vertices.append(tuple(hit+normal*offset))
        start = int(inner)*layer_size
        for i in range(sectors):
            triangle = (start, start+1+i, start+1+(i+1)%sectors)
            faces.append(tuple(reversed(triangle)) if inner else triangle)
        for j in range(bands-1):
            for i in range(sectors):
                a=start+1+j*sectors+i
                b=start+1+j*sectors+(i+1)%sectors
                face=(a,a+sectors,b+sectors,b)
                faces.append(tuple(reversed(face)) if inner else face)
    for i in range(sectors):
        a=1+(bands-1)*sectors+i
        b=1+(bands-1)*sectors+(i+1)%sectors
        faces.append((a,a+layer_size,b+layer_size,b))
    obj=mesh_object(name,vertices,faces,material,rig,region=8)
    return rules(obj, {'bald':[False],'hairstyle':[style]})


def hair_and_details(rig):
    head=surface_tree(bpy.data.objects['Sculpted head'])
    hair=bpy.data.materials['Chestnut hair planes']
    facial=hair.copy();facial.name='Creator facial hair'
    rules(bpy.data.objects['HAIR_01_TRIPO_CURL'],{'bald':[False],'hairstyle':['curl']})
    rules(bpy.data.objects['PROOF_BOB'],{'bald':[False],'hairstyle':['bob']})
    for style in ['crop','wave','quiff']:
        hair_cap('Creator hair '+style,style,head,hair,rig)
    # Individual stubble points leave the actual skin visible between hairs.
    randomizer=random.Random(8417)
    for i in range(80):
        x=randomizer.uniform(-.15,.15);z=randomizer.uniform(1.47,1.615)
        if abs(x)<.055 and z>1.52:
            continue
        hit,normal,_,_=head.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
        if hit is None:continue
        obj=sphere(f'Creator stubble {i}',hit+normal*.0015,.0022,facial,rig)
        obj['creator_outline']=False
        rules(obj,{'facial_hair':['stubble']})
    for side in [-1,1]:
        points=[front_point(head,side*x,z,.005) for x,z in [(.012,1.576),(.032,1.578),(.052,1.564)]]
        rules(curve(f'Creator moustache {side}',points,.0065,facial,rig),{'facial_hair':['moustache','beard']})
    vertices,inner,faces,mapping=[],[],[],{}
    columns,rows=18,16
    for j in range(rows+1):
        z=1.45+j*.17/rows
        for i in range(columns+1):
            x=-.17+i*.34/columns
            hit,normal,_,_=head.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
            if hit is None:continue
            mapping[(i,j)]=len(vertices)
            vertices.append(tuple(hit+normal*(.006+.015*max(0,1-(z-1.45)/.08))))
            inner.append(tuple(hit-normal*.001))
    for j in range(rows):
        for i in range(columns):
            x=-.17+(i+.5)*.34/columns;z=1.45+(j+.5)*.17/rows
            if abs(x)<.058 and z>1.515 or abs(x)>.13 and z<1.48:
                continue
            keys=[(i,j),(i+1,j),(i+1,j+1),(i,j+1)]
            if all(key in mapping for key in keys):faces.append(tuple(mapping[key] for key in keys))
    from collections import Counter
    edges=Counter(tuple(sorted((face[i],face[(i+1)%len(face)]))) for face in faces for i in range(len(face)))
    size=len(vertices);outer=list(faces);vertices.extend(inner)
    faces.extend(tuple(index+size for index in reversed(face)) for face in outer)
    for face in outer:
        for i,a in enumerate(face):
            b=face[(i+1)%len(face)]
            if edges[tuple(sorted((a,b)))]==1:faces.append((a,a+size,b+size,b))
    rules(mesh_object('Creator beard',vertices,faces,facial,rig),{'facial_hair':['beard']})
    scar=flat_material('Creator soft scar',(.52,.31,.23))
    # Freckles are a rest-surface shader mask, so they cannot intersect the skin.
    for name,points in [('brow',[(.10,1.774),(.11,1.750),(.12,1.732)]),('cheek',[(.14,1.616),(.15,1.592),(.148,1.574)])]:
        obj=curve('Creator scar '+name,[front_point(head,x,z,.002) for x,z in points],.0025,scar,rig)
        obj['creator_outline']=False
        rules(obj,{'scar':[name]})


def accessories(rig):
    head=surface_tree(bpy.data.objects['Sculpted head'])
    frame=flat_material('Creator charcoal frames',(.027,.023,.024))
    metal=flat_material('Creator warm metal',(.56,.34,.095))
    for style in ['round','rectangular']:
        for side in [-1,1]:
            if style=='round':
                points=[(side*.091+.055*math.cos(t),1.689+.043*math.sin(t)) for t in [math.tau*i/16 for i in range(16)]]
            else:
                points=[(side*.091+x,1.689+z) for x,z in [(-.044,-.034),(.044,-.034),(.054,-.024),(.054,.024),(.044,.034),(-.044,.034),(-.054,.024),(-.054,-.024)]]
            rules(curve(f'Creator glasses {style} {side}',[front_point(head,x,z,.021) for x,z in points],.0043,frame,rig,closed=True),
                  {'glasses':[True],'glasses_style':[style]})
    bridge=[front_point(head,x,z,.023) for x,z in [(-.036,1.688),(0,1.692),(.036,1.688)]]
    rules(curve('Creator glasses bridge',bridge,.0038,frame,rig),{'glasses':[True]})
    for side in [-1,1]:
        points=[front_point(head,side*.145,1.700,.020),Vector((side*.219,-.047,1.702)),Vector((side*.238,.023,1.685))]
        rules(curve(f'Creator glasses temple {side}',points,.0034,frame,rig),{'glasses':[True]})
        rules(sphere(f'Creator ear stud {side}',(side*.235,-.017,1.613),.010,metal,rig),{'earrings':['studs']})
        points=[(side*.237+.014*math.cos(t),-.015,1.588+.022*math.sin(t)) for t in [math.tau*i/16 for i in range(16)]]
        rules(curve(f'Creator ear hoop {side}',points,.0027,metal,rig,closed=True),{'earrings':['hoops']})


def clothing(rig):
    skin=bpy.data.materials['Warm ochre skin']
    cloth=bpy.data.materials['Washed sage overshirt']
    seam=bpy.data.materials['Sage seam and cuff']
    torso=bpy.data.objects['Overshirt body']
    rules(torso,{'wear':['clothed']})
    bare=copy_part(torso,'Creator bare torso',skin,region=2)
    warp(bare,lambda p:(p.x*.91,p.y*.88,p.z))
    rules(bare,{'wear':['bare']})
    trims=['Collar stand','Folded fabric collar leaf','Shirt placket','Small horn button','One sewn breast pocket','Pocket top seam']
    for obj in list(bpy.data.objects):
        if obj.type!='MESH':continue
        if any(obj.name==prefix or obj.name.startswith(prefix+'.') for prefix in trims):
            rules(obj,{'wear':['clothed'],'top':['overshirt']})
        if obj.name=='Shirt lower hem':rules(obj,{'wear':['clothed']})
    for side in ['L','R']:
        # Source object suffixes are verified by their rest-space centroid below.
        sleeve=next(obj for obj in bpy.data.objects if obj.name.startswith('Relaxed shirt sleeve') and
                    (sum((obj.matrix_world@v.co).x for v in obj.data.vertices)<0)==(side=='L'))
        rules(sleeve,{'wear':['clothed'],'sleeves':['rolled']})
        upper=rig.data.bones['upper_arm.'+side]
        start=upper.head_local;axis=(upper.tail_local-start).normalized()
        short=copy_part(sleeve,'Creator short sleeve '+side,region=4)
        warp(short,lambda p:p-axis*max(0,(p-start).dot(axis))*.43)
        rules(short,{'wear':['clothed'],'sleeves':['short']})
        # Skin needs a rounded shoulder, not the flat cap of a garment sleeve.
        arm_length=(upper.tail_local-start).length
        x=Vector(upper.matrix_local.col[0][:3]).normalized();z=x.cross(axis).normalized()
        rings=[(-.045,.001),(-.035,.045),(-.012,.070),(.020,.077),
               (arm_length*.50,.069),(arm_length*.85,.057),(arm_length+.015,.045),(arm_length+.035,.001)]
        vertices=[tuple(start+axis*along+x*(radius*math.cos(math.tau*i/16))+z*(radius*math.sin(math.tau*i/16)))
                  for along,radius in rings for i in range(16)]
        faces=[(j*16+i,j*16+(i+1)%16,(j+1)*16+(i+1)%16,(j+1)*16+i)
               for j in range(len(rings)-1) for i in range(16)]
        faces.extend([tuple(reversed(range(16))),tuple((len(rings)-1)*16+i for i in range(16))])
        faces=[tuple(reversed(face)) for face in faces]
        volume=sum(Vector(vertices[face[0]]).dot(Vector(vertices[face[i]]).cross(Vector(vertices[face[i+1]])))/6
                   for face in faces for i in range(1,len(face)-1))
        if volume<=0:raise ValueError('Upper arm skin must have outward winding: '+side)
        bare_arm=mesh_object('Creator upper arm skin '+side,vertices,faces,skin,rig,bone='upper_arm.'+side,region=4)
        rules(bare_arm,{'wear':['bare']},{'wear':['clothed'],'sleeves':['short']})
        forearm=next(obj for obj in bpy.data.objects if obj.name.startswith('Forearm with elbow') and
                    (sum((obj.matrix_world@v.co).x for v in obj.data.vertices)<0)==(side=='L'))
        # The long garment owns this complete surface; exposed variants keep skin.
        rules(forearm,{'wear':['bare']},{'wear':['clothed'],'sleeves':['rolled','short']})
        lower=rig.data.bones['forearm.'+side];start2=lower.head_local;axis2=(lower.tail_local-start2).normalized()
        def cover_forearm(p):
            center=start2+axis2*(p-start2).dot(axis2)
            return center+(p-center)*1.12
        vertices,faces=continuous_sleeve_geometry(
            [tuple(sleeve.matrix_world@vertex.co) for vertex in sleeve.data.vertices],
            [tuple(face.vertices) for face in sleeve.data.polygons],
            [tuple(cover_forearm(forearm.matrix_world@vertex.co)) for vertex in forearm.data.vertices],
            [tuple(face.vertices) for face in forearm.data.polygons])
        long=mesh_object('Creator long sleeve '+side,vertices,faces,cloth,rig,region=4)
        long.vertex_groups.clear()
        groups={bone:long.vertex_groups.new(name=bone if bone=='spine' else bone+'.'+side)
                for bone in ['spine','upper_arm','forearm','hand']}
        for vertex in long.data.vertices:
            for bone,weight in sleeve_weights(vertex.co.z).items():
                if weight:groups[bone].add([vertex.index],weight,'REPLACE')
        # Subdivide after skinning, matching the source's deformation contract.
        for source_modifier in sleeve.modifiers:
            if source_modifier.type=='SUBSURF':
                modifier=long.modifiers.new('Creator continuous sleeve surface','SUBSURF')
                modifier.subdivision_type=source_modifier.subdivision_type
                modifier.levels=source_modifier.levels
                modifier.render_levels=source_modifier.render_levels
        rules(long,{'wear':['clothed'],'sleeves':['long']})
    for obj in list(bpy.data.objects):
        if obj.type!='MESH' or obj.name.endswith('_source_curve'):continue
        if obj.name.startswith('Turned sleeve cuff'):rules(obj,{'wear':['clothed'],'sleeves':['rolled']})
        if obj.name.startswith('Tailored trouser leg'):
            rules(obj,{'wear':['clothed'],'bottoms':['trousers']})
            side='L' if sum((obj.matrix_world@v.co).x for v in obj.data.vertices)<0 else 'R'
            sign=-1 if side=='L' else 1
            bare=copy_part(obj,'Creator bare leg '+side,skin,region=3)
            warp(bare,lambda p:(sign*.124+(p.x-sign*.124)*.84,p.y*.82,p.z))
            rules(bare,{'wear':['bare']})
            lower_leg=copy_part(bare,'Creator shorts bare leg '+side,skin,region=3)
            trim_at_height(lower_leg,.64,True)
            rules(lower_leg,{'wear':['clothed'],'bottoms':['shorts']})
            shorts=copy_part(obj,'Creator shorts '+side,region=3)
            trim_at_height(shorts,.60,False)
            shorts.vertex_groups.clear()
            thigh=shorts.vertex_groups.new(name='thigh.'+side);hip=shorts.vertex_groups.new(name='hips')
            for vertex in shorts.data.vertices:
                z=(shorts.matrix_world@vertex.co).z
                weight=max(0.,min(1.,(z-.78)/.12))*.7
                thigh.add([vertex.index],1-weight,'REPLACE')
                if weight:hip.add([vertex.index],weight,'REPLACE')
            rules(shorts,{'wear':['clothed'],'bottoms':['shorts']})
        if obj.name.startswith('Trouser hem'):rules(obj,{'wear':['clothed'],'bottoms':['trousers']})
        if obj.name=='Trouser hip bridge':
            rules(obj,{'wear':['clothed']})
            bare=copy_part(obj,'Creator bare hips',skin,region=3)
            warp(bare,lambda p:(p.x*.91,p.y*.88,p.z))
            rules(bare,{'wear':['bare']})
    points=[(.093*math.cos(t),.065*math.sin(t),1.372) for t in [math.tau*i/24 for i in range(24)]]
    rules(curve('Creator crew neck',points,.010,seam,rig,closed=True,bone='spine',region=2),{'wear':['clothed'],'top':['tshirt']})
    for sign in [-1,1]:
        vertices=[(sign*.052,-.086,1.38),(sign*.143,-.135,1.265),(sign*.063,-.157,1.17),(sign*.026,-.128,1.27)]
        if sign>0:vertices.reverse()
        normal=(Vector(vertices[1])-Vector(vertices[0])).cross(Vector(vertices[2])-Vector(vertices[0]))
        assert normal.y<0, 'Jacket lapel must face away from the chest'
        rules(mesh_object('Creator jacket lapel '+str(sign),vertices,[(0,1,2,3)],seam,rig,bone='spine',region=2),{'wear':['clothed'],'top':['jacket']})
    zipper=[(0,-.14,z) for z in [.98,1.08,1.18,1.27]]
    rules(curve('Creator jacket zip',zipper,.003,seam,rig,bone='spine',region=2),{'wear':['clothed'],'top':['jacket']})


def footwear(rig):
    skin=bpy.data.materials['Warm ochre skin']
    rubber=flat_material('Creator pale rubber',(.63,.61,.55))
    laces=flat_material('Creator shoe laces',(.68,.65,.58))
    for obj in list(bpy.data.objects):
        if obj.type!='MESH' or obj.name.endswith('_source_curve'):continue
        if not obj.name.startswith(('Shaped shoe','Fitted rounded shoe sole','Shoe apron stitch')):continue
        rules(obj,{'wear':['clothed'],'footwear':['loafers','laceups']})
        side='L' if sum((obj.matrix_world@v.co).x for v in obj.data.vertices)<0 else 'R'
        sign=-1 if side=='L' else 1
        if obj.name.startswith('Shaped shoe'):
            trainer=copy_part(obj,'Creator trainer '+side,region=6)
            warp(trainer,lambda p:(sign*.124+(p.x-sign*.124)*1.06,p.y, .019+(p.z-.019)*1.08))
            rules(trainer,{'wear':['clothed'],'footwear':['trainers']})
            bare=copy_part(obj,'Creator bare foot '+side,skin,region=6)
            foot_z=[(bare.matrix_world@v.co).z for v in bare.data.vertices]
            low,high=min(foot_z),max(foot_z)
            warp(bare,lambda p:(sign*.124+(p.x-sign*.124)*.83,p.y*.78,.0191481+(p.z-low)/(high-low)*(.165-.0191481)))
            rules(bare,{'wear':['bare']})
            shoe=surface_tree(obj)
            for n in range(3):
                points=[]
                for x in [sign*.124-.034,sign*.124,sign*.124+.034]:
                    hit,normal,_,_=shoe.ray_cast(Vector((x,-.055-n*.025,1)),Vector((0,0,-1)))
                    if hit is None:raise ValueError('Shoe lace ray missed its upper')
                    points.append(hit+normal*.003)
                rules(curve(f'Creator laces {side} {n}',points,.0025,laces,rig,bone='foot.'+side,region=6),{'wear':['clothed'],'footwear':['laceups']})
        if obj.name.startswith('Fitted rounded shoe sole'):
            sole=copy_part(obj,'Creator trainer sole '+side,rubber,region=6)
            warp(sole,lambda p:(sign*.124+(p.x-sign*.124)*1.065,p.y,p.z))
            rules(sole,{'wear':['clothed'],'footwear':['trainers']})


def author(rig):
    hair_and_details(rig)
    accessories(rig)
    clothing(rig)
    footwear(rig)
    open_eyes=('Eye white','Hazel iris','Dark pupil','Small eye catchlight','Upper lid outline')
    for obj in bpy.data.objects:
        if obj.type!='MESH':continue
        if obj.name.startswith(open_eyes):rules(obj,{'eyes_closed':[False]})
        if obj.name.startswith('Sleep closed eyelid'):rules(obj,{'eyes_closed':[True]})
        if obj.name.startswith(('Reading book','Printed book')):rules(obj,{'prop':['book']})
