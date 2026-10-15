"""Registered source-surface sampling for unchanged published sprite colors."""
import hashlib
import math

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def geometry(objects):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices, triangles, owners = [], [], []
    for obj in objects:
        if obj.type not in ('MESH', 'CURVE') or obj.hide_render:
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        start = len(vertices)
        vertices.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        triangles.extend(tuple(start + index for index in tri.vertices) for tri in mesh.loop_triangles)
        owners.extend([obj.name] * len(mesh.loop_triangles))
        evaluated.to_mesh_clear()
    if not vertices or not triangles:
        raise ValueError('Source fixture has no visible evaluated geometry')
    return vertices, triangles, owners


def sample(objects, width, height, coverage, *, canvas=None, crop=(0, 0), max_edge_distance=math.sqrt(.5) + 1e-5):
    """Trace center rays; source outline texels inherit their closest authored edge."""
    scene = bpy.context.scene
    camera = scene.camera
    vertices, triangles, owners = geometry(objects)
    tree = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
    full_width, full_height = canvas or (width, height)
    frame = camera.data.view_frame(scene=scene)
    left, right = min(v.x for v in frame), max(v.x for v in frame)
    bottom, top = min(v.y for v in frame), max(v.y for v in frame)
    direction = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    values = np.full((height, width), np.nan, dtype=np.float64)
    owner_indices = np.full((height, width), -1, dtype=np.int32)
    for y, x in zip(*np.where(coverage)):
        origin = camera.matrix_world @ Vector((
            left + (x + crop[0] + .5) / full_width * (right - left),
            top - (y + crop[1] + .5) / full_height * (top - bottom), 0))
        hit, _, face, _ = tree.ray_cast(origin, direction)
        if hit is not None:
            values[y, x] = hit.x - hit.y
            owner_indices[y, x] = face
    projected = []
    for vertex in vertices:
        point = world_to_camera_view(scene, camera, vertex)
        projected.append([point.x * full_width - crop[0], (1 - point.y) * full_height - crop[1], vertex.x - vertex.y])
    projected = np.asarray(projected)
    edges = np.asarray([(a, b) for tri in triangles for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0]))])
    a, b = projected[edges[:, 0]], projected[edges[:, 1]]
    delta = b[:, :2] - a[:, :2]
    length = np.sum(delta * delta, axis=1)
    max_distance, outline_count = 0., 0
    for y, x in zip(*np.where(coverage & np.isnan(values))):
        point = np.array([x + .5, y + .5])
        t = np.clip(np.sum((point - a[:, :2]) * delta, axis=1) / np.maximum(length, 1e-20), 0, 1)
        distance = np.sum((a[:, :2] + delta * t[:, None] - point) ** 2, axis=1)
        best = distance.min()
        nearest = np.where(distance <= best + 1e-9)[0]
        edge = max(nearest, key=lambda index: a[index, 2] + t[index] * (b[index, 2] - a[index, 2]))
        values[y, x] = a[edge, 2] + t[edge] * (b[edge, 2] - a[edge, 2])
        owner_indices[y, x] = edge // 3
        max_distance = max(max_distance, float(math.sqrt(best)))
        outline_count += 1
    if max_distance > max_edge_distance:
        raise ValueError(f'Published coverage is not registered to source geometry: {max_distance:.9f} > {max_edge_distance:.9f}')
    valid = values[coverage]
    if not len(valid) or not np.isfinite(valid).all() or valid.min() < -2 or valid.max() > 2:
        raise ValueError('Physical source depth exceeds the signed [-2, 2] contract')
    encoded = np.rint((np.nan_to_num(values) + 2) / 4 * 65535).astype(np.uint16)
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[:, :, 0] = encoded >> 8
    rgba[:, :, 1] = encoded & 255
    rgba[:, :, 3] = coverage.astype(np.uint8) * 255
    proof = dict(opaquePixels=int(coverage.sum()), outlineSamples=outline_count,
                 maxOutlineDistancePixels=max_distance, minSum=float(valid.min()), maxSum=float(valid.max()),
                 vertices=len(vertices), triangles=len(triangles))
    return rgba, proof, owner_indices, owners


class Pages:
    def __init__(self, directory, prefix):
        self.directory, self.prefix = directory, prefix
        self.pages = [np.zeros((2048, 2048, 4), dtype=np.uint8)]
        self.x = self.y = self.row_height = 0

    def add(self, pixels):
        height, width = pixels.shape[:2]
        if self.x + width > 2048:
            self.x = 0
            self.y += self.row_height
            self.row_height = 0
        if self.y + height > 2048:
            self.pages.append(np.zeros((2048, 2048, 4), dtype=np.uint8))
            self.x = self.y = self.row_height = 0
        record = dict(pageIndex=len(self.pages) - 1, x=self.x, y=self.y, w=width, h=height)
        self.pages[-1][self.y:self.y + height, self.x:self.x + width] = pixels
        self.x += width
        self.row_height = max(self.row_height, height)
        return record

    def save(self):
        result = []
        for index, page in enumerate(self.pages):
            data = page.tobytes()
            sha = hashlib.sha256(data).hexdigest()
            path = self.directory / f'{self.prefix}-{sha}.rgba'
            path.write_bytes(data)
            result.append(dict(pageIndex=index, path=path.name, sha256=sha, width=2048, height=2048))
        return result
