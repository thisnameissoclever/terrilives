"""Place authored ink footprint samples on their owner's actual pixel-center surface."""
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from bpy_extras.object_utils import world_to_camera_view


def pixelize(scene,owner,ink):
    graph=bpy.context.evaluated_depsgraph_get()
    evaluated=owner.evaluated_get(graph)
    mesh=evaluated.to_mesh()
    tree=BVHTree.FromPolygons([evaluated.matrix_world@vertex.co for vertex in mesh.vertices],[list(face.vertices) for face in mesh.polygons],all_triangles=False)
    mesh.calc_loop_triangles()
    triangles=[]
    for tri in mesh.loop_triangles:
        points=[evaluated.matrix_world@mesh.vertices[i].co for i in tri.vertices]
        projected=[world_to_camera_view(scene,scene.camera,v) for v in points]
        xy=np.array([[v.x*scene.render.resolution_x,(1-v.y)*scene.render.resolution_y] for v in projected])
        triangles.append((xy,points))
    evaluated.to_mesh_clear()
    width,height=scene.render.resolution_x,scene.render.resolution_y
    toward=scene.camera.matrix_world.to_3x3().col[2].normalized()
    inverse=scene.camera.calc_matrix_camera(graph,x=width,y=height).inverted()
    def world(x,y,z):
        clip=inverse@Vector((2*x/width-1,1-2*y/height,z,1))
        return scene.camera.matrix_world@Vector((clip.x/clip.w,clip.y/clip.w,clip.z/clip.w))
    painted={}
    ink.data.calc_loop_triangles()
    for triangle in ink.data.loop_triangles:
        points=[ink.matrix_world@ink.data.vertices[index].co for index in triangle.vertices]
        projected=[world_to_camera_view(scene,scene.camera,point) for point in points]
        xy=np.array([[point.x*width,(1-point.y)*height] for point in projected],np.float64)
        x0,y0=np.floor(xy.min(axis=0)).astype(int)
        x1,y1=np.ceil(xy.max(axis=0)).astype(int)
        x0,y0=max(0,x0),max(0,y0)
        x1,y1=min(width,x1),min(height,y1)
        if x0>=x1 or y0>=y1:
            continue
        xs,ys=np.meshgrid(np.arange(x0,x1)+.5,np.arange(y0,y1)+.5)
        a,b,c=xy
        denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(denominator)<1e-10:
            continue
        u=((b[1]-c[1])*(xs-c[0])+(c[0]-b[0])*(ys-c[1]))/denominator
        v=((c[1]-a[1])*(xs-c[0])+(a[0]-c[0])*(ys-c[1]))/denominator
        inside=(u>=-1e-7)&(v>=-1e-7)&(u+v<=1+1e-7)
        yy,xx=np.nonzero(inside)
        for iy,ix in zip(yy,xx):
            x,y=x0+int(ix),y0+int(iy)
            barycentric=points[0]*float(u[iy,ix])+points[1]*float(v[iy,ix])+points[2]*float(1-u[iy,ix]-v[iy,ix])
            previous=painted.get((x,y))
            if previous is None or barycentric.dot(toward)>previous.dot(toward):
                painted[x,y]=barycentric
    bins={key:[] for key in painted}
    painted_keys=list(painted)
    coordinates=np.asarray(painted_keys,dtype=np.int32).reshape(-1,2)
    for xy,points in triangles:
        lo=np.floor(xy.min(axis=0)).astype(int);hi=np.ceil(xy.max(axis=0)).astype(int)
        relevant=np.nonzero(np.all((coordinates>=lo)&(coordinates<hi),axis=1))[0]
        for index in relevant:
            bins[painted_keys[int(index)]].append((xy,points))
    def clipped(triangle,x,y):
        polygon=[v.copy() for v in triangle]
        for axis,bound,sign in ((0,x,1),(0,x+1,-1),(1,y,1),(1,y+1,-1)):
            result=[]
            for i,a in enumerate(polygon):
                b=polygon[(i+1)%len(polygon)]
                da=(a[axis]-bound)*sign;db=(b[axis]-bound)*sign
                if da>=-1e-9:result.append(a)
                if (da>=0)!=(db>=0):result.append(a+(b-a)*(da/(da-db)))
            polygon=result
            if len(polygon)<3:return []
        return polygon
    vertices,faces=[],[]
    clearance=4*scene.camera.data.ortho_scale/height*.01
    for (x,y),edge in painted.items():
        origin=world(x+.5,y+.5,-1)
        hit=tree.ray_cast(origin,-toward)[0]
        if hit is not None:
            for xy,points in bins[x,y]:
                polygon=clipped(xy,x,y)
                if not polygon:continue
                a,b,c=xy
                denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
                if abs(denominator)<1e-10:continue
                start=len(vertices)
                for px,py in polygon:
                    u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/denominator
                    v=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/denominator
                    point=points[0]*float(u)+points[1]*float(v)+points[2]*float(1-u-v)+toward*clearance
                    vertices.append(tuple(point))
                faces.append(tuple(range(start,len(vertices))))
            continue
        center=edge+toward*clearance
        center_depth=center.dot(toward)
        start=len(vertices)
        for px,py in ((x,y),(x+1,y),(x+1,y+1),(x,y+1)):
            corner=world(px,py,-1)
            corner+=toward*(center_depth-corner.dot(toward))
            vertices.append(tuple(corner))
        faces.append((start,start+1,start+2,start+3))
    data=bpy.data.meshes.new('__SampledInkMesh:'+owner.name)
    data.from_pydata(vertices,[],faces)
    for material in ink.data.materials:
        data.materials.append(material)
    ink.data=data
    return dict(owner=owner.name,pixels=len(faces),clearance=clearance,sourcePixelGrid=[width,height])
