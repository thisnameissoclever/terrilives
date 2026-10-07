"""Author surface-owned ink geometry for case, books and the unchanged actor."""
import bpy
from mathutils.bvhtree import BVHTree


def author(scene, furniture, body, stocks, width_pixels, color):
    graph=bpy.context.evaluated_depsgraph_get()
    camera=scene.camera.matrix_world.to_3x3().col[2].normalized()
    world_width=width_pixels*scene.camera.data.ortho_scale/scene.render.resolution_y
    paint_depth=world_width*.01
    material=bpy.data.materials.new('__FetchAllDepthTestedWarmInk')
    material.use_nodes=True
    nodes=material.node_tree
    nodes.nodes.clear()
    emission=nodes.nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value=(*color,1)
    output=nodes.nodes.new('ShaderNodeOutputMaterial')
    nodes.links.new(emission.outputs[0],output.inputs['Surface'])
    body_names={obj.name for obj in body.all_objects}
    stock_names={obj.name for obj in stocks}
    originals={obj.name:obj for obj in list(furniture.all_objects)+list(body.all_objects)}
    ribbons,records={},[]
    for obj in originals.values():
        if obj.type!='MESH' or (obj.hide_render and obj.name not in stock_names):
            continue
        evaluated=obj.evaluated_get(graph)
        mesh=evaluated.to_mesh()
        points=[evaluated.matrix_world@vertex.co for vertex in mesh.vertices]
        faces=[list(face.vertices) for face in mesh.polygons]
        if not faces:
            evaluated.to_mesh_clear()
            continue
        tree=BVHTree.FromPolygons(points,faces,all_triangles=False)
        transform=evaluated.matrix_world.to_3x3().inverted().transposed()
        normals=[(transform@face.normal).normalized() for face in mesh.polygons]
        edge_faces={}
        for face,polygon in enumerate(mesh.polygons):
            for a,b in polygon.edge_keys:
                edge_faces.setdefault(tuple(sorted((a,b))),[]).append(face)
        external_only='HAIR_' in obj.name.upper()
        vertices,polygons,selected=[],[],[]
        for (a,b),adjacent in edge_faces.items():
            visible=[normals[index].dot(camera)>1e-7 for index in adjacent]
            feature=len(adjacent)==1 and visible[0] or len(adjacent)==2 and visible[0]!=visible[1]
            if not feature:
                continue
            side=camera.cross(points[b]-points[a])
            if side.length<1e-10:
                continue
            side.normalize()
            midpoint=(points[a]+points[b])/2
            hit,_,_,_=tree.ray_cast(midpoint+camera*10,-camera)
            hidden_by_self=hit is not None and (hit-midpoint).dot(camera)>1e-5
            if hidden_by_self:
                continue
            if external_only:
                epsilon=world_width*.01
                left=tree.ray_cast(midpoint-side*epsilon+camera*10,-camera)[0]
                right=tree.ray_cast(midpoint+side*epsilon+camera*10,-camera)[0]
                if left is not None and right is not None:
                    continue
            half=side*(world_width/2)
            strip=[]
            for base,offset in ((points[a],-half),(points[b],-half),(points[b],half),(points[a],half)):
                candidate=base+offset
                hit=tree.ray_cast(candidate+camera*10,-camera)[0]
                point=(hit if hit is not None and not hidden_by_self else candidate)+camera*paint_depth
                strip.append(tuple(point))
            start=len(vertices)
            vertices.extend(strip)
            polygons.append((start,start+1,start+2,start+3))
            selected.append([a,b])
        evaluated.to_mesh_clear()
        data=bpy.data.meshes.new('__FetchInkMesh:'+obj.name)
        data.from_pydata(vertices,[],polygons)
        data.materials.append(material)
        ink=bpy.data.objects.new('__FetchInk:'+obj.name,data)
        owner=body if obj.name in body_names else furniture
        owner.objects.link(ink)
        from pose_complete_fetch_spine_pixel_ink_v3 import pixelize
        sampled=pixelize(scene,obj,ink)
        ribbons[obj.name]=ink
        records.append(dict(sampled=sampled,owner=obj.name,collection=owner.name,edges=selected,ribbonFaces=len(polygons),stock=obj.name in stock_names,
                            selection='external contour' if external_only else 'silhouette/border'))
    scene.render.use_freestyle=False
    return ribbons,dict(policy='All ink is depth-tested owned geometry; actor and case remain unchanged; hair external contours only; Freestyle disabled',
        sourcePixelWidth=width_pixels,worldWidth=world_width,color=list(color),surfaceOffset=paint_depth,depthClearanceRule="One percent of the authored stroke width; orthographic XY unchanged",objects=records)
