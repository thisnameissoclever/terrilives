"""Gathered mop yarn and closed hands fitted around its two grip diameters."""
import math
import bpy
from mathutils import Matrix,Vector
from mathutils.bvhtree import BVHTree
from build_parts import cylinder,tube
from build_rig import bind,direct_bone,arm_elbow

GRIP_RADII={'R':.023,'L':.014}
FINGER_LEVELS=(.035,.012,-.012,-.033)
BONE_AXES=Matrix.Rotation(math.pi/2,4,'Z')


def mesh_curve(obj):
    graph=bpy.context.evaluated_depsgraph_get()
    data=bpy.data.meshes.new_from_object(obj.evaluated_get(graph))
    name=obj.name;parent=obj.parent
    bpy.data.objects.remove(obj,do_unlink=True)
    result=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(result)
    result.parent=parent
    return result


def ellipsoid(name,center,scale,material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12)
    obj=bpy.context.object;obj.name=name
    for vertex in obj.data.vertices:
        vertex.co=Vector(tuple(vertex.co[i]*scale[i]+center[i] for i in range(3)))
    obj.data.materials.append(material)
    for face in obj.data.polygons:face.use_smooth=True
    return obj


def gathered_head(root,cotton,binding,rubber):
    cylinder('Mop cotton binding',(0,0,.135),(0,0,.20),.040,binding,root)
    cylinder('Mop handle socket',(0,0,.19),(0,0,.26),.025,rubber,root)
    for index in range(18):
        # Open yarn hangs in a gathered bundle, then trails unevenly on the floor.
        angle=index*2.399963229728653
        start=Vector((.029*math.cos(angle),.023*math.sin(angle),.16))
        spread=(index-8.5)/8.5
        reach=.065+.045*(.5+.5*math.sin(index*1.7))
        tip=Vector((spread*.12,-reach,.014))
        middle=Vector((spread*.055,-.028+.012*math.cos(index*2.1),.070))
        points=[start,start*.65+Vector((0,-.003,.016)),middle,
                Vector((tip.x*.85,tip.y*.78,.023)),tip,
                tip+Vector((.009*math.sin(index*2.7),-.010-.007*math.cos(index),.002))]
        obj=tube(f'Mop cut cotton strand {index}',points,.0125,cotton,root)
        mesh_curve(obj)


def closed_hands(rig):
    skin=bpy.data.objects['Relaxed palm'].data.materials[0]
    result={}
    for side,mirror in [('L',-1),('R',1)]:
        radius=GRIP_RADII[side]
        wrist=Vector((radius+.076,0,-.016))
        parts=[ellipsoid(f'Mop palm heel {side}',(radius+.029,0,0),(.028,.035,.054),skin),
               ellipsoid(f'Mop wrist transition {side}',(radius+.060,0,-.013),(.031,.026,.025),skin)]
        for index,z in enumerate(FINGER_LEVELS):
            finger_radius=.0105 if index<3 else .0095
            arc_radius=radius+finger_radius+.001
            points=[(arc_radius*math.cos(math.radians(degrees)),
                     mirror*arc_radius*math.sin(math.radians(degrees)),z)
                    for degrees in range(25,336,10)]
            parts.append(mesh_curve(tube(f'Mop curled finger {side} {index}',points,finger_radius,skin,rig)))
        thumb_radius=radius+.033
        points=[(thumb_radius*math.cos(math.radians(angle)),
                 mirror*thumb_radius*math.sin(math.radians(angle)),z)
                for angle,z in [(-25,.012),(-45,.034),(-75,.051),(-105,.048),(-130,.036)]]
        parts.append(mesh_curve(tube(f'Mop opposing thumb {side}',points,.013,skin,rig)))
        vertices=[];polygons=[]
        for obj in parts:
            offset=len(vertices);vertices.extend(v.co.copy() for v in obj.data.vertices)
            polygons.extend(tuple(offset+index for index in face.vertices) for face in obj.data.polygons)
        surface=BVHTree.FromPolygons(vertices,polygons)
        distances=[]
        for degrees in range(0,360,5):
            angle=math.radians(degrees)
            hit,_,_,distance=surface.ray_cast(Vector((0,0,.012)),Vector((math.cos(angle),math.sin(angle),0)),.15)
            assert hit is not None,('open mop grip',side,degrees)
            distances.append(distance)
        assert min(distances)>=radius-.001,('grip penetrates handle',side,min(distances),radius)
        contacts=[distances[index] for index in (0,18,36,54)]
        assert max(contacts)-radius<=.0025,('grip misses handle',side,contacts,radius)
        rest=rig.data.bones['hand.'+side].matrix_local
        to_rest=rest@BONE_AXES.inverted()@Matrix.Translation(-wrist)
        for obj in parts:
            obj.data.transform(to_rest)
            bind(obj,rig,lambda _v,side=side:{'hand.'+side:1})
        result[side]={'parts':parts,'wrist':wrist,'radius':radius,
                      'contract':{'shaft_radius':radius,'covered_degrees':360,'minimum_skin_radius':min(distances),
                                  'maximum_contact_gap':max(contacts)-radius}}
    return result


def pose_grip(rig,side,grip,axis,point,definition):
    sign=-1 if side=='L' else 1
    radial=Vector((sign*.55,.84,0))
    radial=(radial-axis*radial.dot(axis)).normalized()
    tangent=axis.cross(radial).normalized()
    orientation=Matrix((radial,tangent,axis)).transposed().to_4x4()
    transform=Matrix.Translation(grip)@orientation
    wrist=transform@definition['wrist']
    upper=rig.data.bones['upper_arm.'+side];lower=rig.data.bones['forearm.'+side]
    shoulder=point(upper.head_local)
    elbow=arm_elbow(shoulder,wrist,upper.length,lower.length,Vector((sign*.65,.08,shoulder.z-.20)))
    direct_bone(rig,'upper_arm.'+side,shoulder,elbow)
    direct_bone(rig,'forearm.'+side,elbow,wrist)
    rig.pose.bones['hand.'+side].matrix=transform@Matrix.Translation(definition['wrist'])@BONE_AXES
    return list(wrist)
