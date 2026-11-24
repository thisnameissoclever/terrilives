"""Build the below-grade rectangular pool and its fitted interior ladder."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
MODELS = HERE.parent
sys.path[:0] = [str(HERE), str(MODELS/'furniture')]
from build_parts import material, mesh, cylinder
from pool_activity_layout_v9 import corners, shell
from registered_pool_art import evaluated, render, ripple_surface, sha

APRON = (-2.45, 2.45, -3.45, 3.45)
APERTURE = (-1.94, 1.94, -2.96, 2.96)
FLOOR_Z = -1.20
WATER_Z = -.18
CANVAS = (416, 352)
RAIL_X = .405
RAIL_RADIUS = .024
CONTACTS = MODELS/'sims/character-creator/clips/pool/contacts-v12.json'


def apron(root):
    palette = [material('Pool apron '+name, rgb) for name, rgb in (
        ('sandstone',(.66,.61,.49)), ('limestone',(.71,.66,.55)),
        ('pale stone',(.68,.65,.54)), ('warm stone',(.63,.57,.46)),
        ('joints',(.37,.35,.29)))]
    verts, original, _ = shell(APRON, APERTURE, -.035, 0.)
    faces = [f for index,f in enumerate(original) if index%4!=2]
    ids = [0]*len(faces)

    def tiles(x0,x1,y0,y1,along_x):
        start,end = (x0,x1) if along_x else (y0,y1)
        count = round((end-start)/.65)
        for i in range(count):
            a = start + i*(end-start)/count
            b = start + (i+1)*(end-start)/count
            for lo, hi, mat in ((a,a+.009,4),(a+.009,b,i%4)):
                rectangle = (lo,hi,y0,y1) if along_x else (x0,x1,lo,hi)
                first = len(verts)
                verts.extend(corners(rectangle,0))
                faces.append(tuple(range(first,first+4)))
                ids.append(mat)
    tiles(*APRON[:2],APRON[2],APERTURE[2],True)
    tiles(*APRON[:2],APERTURE[3],APRON[3],True)
    tiles(APRON[0],APERTURE[0],*APERTURE[2:],False)
    tiles(APERTURE[1],APRON[1],*APERTURE[2:],False)
    deck = mesh('Pool stone apron',verts,faces,palette[0],root)
    for stone in palette[1:]:
        deck.data.materials.append(stone)
    for face,index in zip(deck.data.polygons,ids):
        face.material_index=index


def pool_water():
    mat = bpy.data.materials.new('Clear pool water')
    mat.use_nodes = True
    mat.surface_render_method = 'BLENDED'
    mat.use_transparent_shadow = False
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    blend = nodes.new('ShaderNodeMixShader')
    blend.inputs[0].default_value = .32
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    tint = nodes.new('ShaderNodeEmission')
    tint.inputs['Color'].default_value = (.035,.40,.43,1)
    mat.node_tree.links.new(transparent.outputs[0],blend.inputs[1])
    mat.node_tree.links.new(tint.outputs[0],blend.inputs[2])
    mat.node_tree.links.new(blend.outputs[0],output.inputs['Surface'])
    return mat


def tiled_floor(root):
    tile = material('Pool deep turquoise floor', (.025,.24,.30))
    joint = material('Underwater tile joints', (.021,.205,.256))
    def edges(start, end, count):
        result = [start]
        for i in range(1,count):
            center = start + i*(end-start)/count
            result.extend((center-.005,center+.005))
        return [*result,end]
    xs = edges(*APERTURE[:2],8)
    ys = edges(*APERTURE[2:],12)
    vertices = [(x,y,FLOOR_Z) for y in ys for x in xs]
    faces, materials = [], []
    for j in range(len(ys)-1):
        for i in range(len(xs)-1):
            k = j*len(xs)+i
            faces.append((k,k+1,k+1+len(xs),k+len(xs)))
            materials.append(int(i%2==1 or j%2==1))
    floor = mesh('Pool basin floor',vertices,faces,tile,root)
    floor.data.materials.append(joint)
    for f,index in zip(floor.data.polygons,materials):
        f.material_index=index


def basin(root):
    apron(root)
    liner = material('Pool liner above water',(.40,.61,.59))
    wet_liner = material('Pool liner below water',(.039,.278,.315))
    for name,low,high,finish in [('Pool submerged liner',FLOOR_Z,WATER_Z,wet_liner),
                                 ('Pool waterline tiles',WATER_Z,-.035,liner)]:
        outer = (-1.99,1.99,-3.01,3.01)
        v,f,_ = shell(outer, APERTURE,low,high)
        mesh(name,v,f,finish,root)
    tiled_floor(root)
    water = mesh('Pool water surface',corners(APERTURE,WATER_Z),[(0,1,2,3)],pool_water(),root)
    water.data.materials.append(material('Pool surface reflections',(.21,.55,.54)))
    ripple_surface(water,APERTURE,WATER_Z,9,13)


def ladder(root):
    prior = {s['id']:s for s in json.loads(CONTACTS.read_bytes())['solids']}
    tread_colors = ((.080,.20,.22),(.14,.29,.31),(.24,.39,.40))
    handrail = material('Pool polished steel handrail',(.75,.78,.74))
    socket_finish = material('Pool ladder socket',(.48,.50,.46))
    for index in (1,2,3):
        name = f'Pool inside ladder tread {index}'
        solid = prior[name]
        v = [(x+.5,y+3,z-1) for x,y,z in solid['vertices']]
        steel = material('Submerged tread '+str(index),tread_colors[index-1])
        mesh(name,v,solid['triangles'],steel,root)
        top = solid['bounds'][1][2]-1
        center_y = (solid['bounds'][1][1]+solid['bounds'][0][1])/2+3
        for side,sign in [('left',-1),('right',1)]:
            cylinder(f'Pool {side} tread {index} mount',
                     (sign*.333,center_y,top-.018),(sign*RAIL_X,center_y,top-.018),
                     .011,steel,root)

    # The entire flight stays on the water side of the wall. Only the arch at
    # the top crosses the coping to reach the socket in the dry stone apron.
    path = [(2.479,-.83),(2.53,-.75),(2.69,-.5),(2.85,-.25),(2.85,.21)]
    arc_center, radius = 3.03,.18
    path.extend((arc_center-radius*math.cos(math.pi*i/24), .21+radius*math.sin(math.pi*i/24))
                for i in range(1,25))
    path.append((3.21,.008))
    for side,x in [('left',-RAIL_X),('right',RAIL_X)]:
        vertices,faces = [],[]
        for index,(y,z) in enumerate(path):
            prev = Vector(path[max(index-1,0)])
            following = Vector(path[min(index+1,len(path)-1)])
            dy,dz = (following-prev).normalized()
            for n in range(16):
                angle = 2*math.pi*n/16
                vertices.append((x+RAIL_RADIUS*math.cos(angle),y+RAIL_RADIUS*math.sin(angle)*dz,
                                 z-RAIL_RADIUS*math.sin(angle)*dy))
        for i in range(len(path)-1):
            for j in range(16):
                start = i*16
                faces.append((start+j,start+(j+1)%16,start+16+(j+1)%16,start+16+j))
        faces += [tuple(reversed(range(16))),tuple(range(len(vertices)-16,len(vertices)))]
        rail = mesh(f'Pool {side} interior rail',vertices,faces,handrail,root)
        for face in list(rail.data.polygons)[:-2]:
            face.use_smooth=True
        cylinder(f'Pool {side} deck socket',(x,3.21,.001),(x,3.21,.018),.072,socket_finish,root)
    return path


def export(out):
    out.mkdir(parents=True,exist_ok=False)
    rig = MODELS/'sims/sim-01/sim-01-rigged.blend'
    bpy.ops.wm.open_mainfile(filepath=str(rig),load_ui=False,use_scripts=False)
    scene = bpy.data.scenes.new('In-ground swimming pool')
    bpy.context.window.scene = scene
    root = bpy.data.objects.new('POOL_MODEL_ROOT',None)
    scene.collection.objects.link(root)
    basin(root)
    rail_path = ladder(root)
    bpy.context.view_layer.update()
    solids = evaluated(root)
    # Freestyle draws after the terrain holdout and can ink edges that are
    # physically buried. Only the coping, rail and sockets contribute ink.
    ink = bpy.data.collections.new('Pool contours visible from above ground')
    scene.collection.children.link(ink)
    for obj in root.children_recursive:
        if obj.name == 'Pool stone apron' or obj.name.endswith(('interior rail','deck socket')):
            ink.objects.link(obj)
    registered_scene, = [candidate for candidate in bpy.data.scenes if candidate.camera]
    for lines in registered_scene.view_layers[0].freestyle_settings.linesets:
        lines.select_by_collection = True
        lines.collection_negation = 'INCLUSIVE'
        lines.collection = ink
    for s in solids:
        a,b = s['bounds']
        if min(a[0]+2.5,a[1]+3.5,2.5-b[0],3.5-b[1])<0:
            raise ValueError(f"Pool solid leaves footprint: {s['id']}")
    model = out/'pool-authoring.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(model),check_existing=False)
    geo = dict(modelSha256=sha(model),origin=[0,0],approach=[0,4,0],waterHeight=WATER_Z,
               floorHeight=FLOOR_Z,water=APERTURE,apron=APRON,rails=[
                   dict(x=x,radius=RAIL_RADIUS,points=[[x,y,z] for y,z in rail_path]) for x in (-RAIL_X,RAIL_X)],
               solids=solids)
    (out/'geometry.json').write_text(json.dumps(geo,separators=(',',':')),encoding='utf8')
    inputs = [Path(__file__),rig,CONTACTS,MODELS/'furniture/build_parts.py',MODELS/'furniture/geometry.py',
              HERE/'pool_activity_layout_v9.py',HERE/'pool_activity_model_v8.py']
    render(out,root,model,inputs,canvas=CANVAS,footprint=[7,5],origin_xy=(0,0),water_z=WATER_Z,cutaway=APRON)


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,type=Path)
    export(parser.parse_args(sys.argv[sys.argv.index('--')+1:]).output.resolve())
