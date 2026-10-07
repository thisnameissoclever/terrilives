"""Wall-backed bath torso: probe the actual head-end wall, solve one frame, measure wall support.

Runs inside hidden background Blender. Every mode writes a versioned proof journal into a new
absolute directory and never edits the immutable tub or shared rig.
"""
import hashlib
import json
from pathlib import Path
import sys
import traceback

import bpy
from mathutils import Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path[:0] = [str(BASE), str(BASE.parent), str(MODELS/'furniture'), str(MODELS/'sims/sim-01')]
from bath_contact import SOLIDS, evaluated_geometry, rear_query_surface, support_grid
from bath_pose import apply_support_frame
from bath_pose_geometry import basin_contains, recline_vector, two_link, validate_support_patch
from bath_wall_support import derive_head_end_plane, solve_translation
from build_rig import direct_bone, pose
from check_bathtub_scene import validate as validate_fixture
sys.path.insert(0, str(MODELS/'living'))
from armchair_contact import body_inventory, evaluated_surface, intersection
from animation_export import render_pass
from render_bath_use import partition
from shower_pose import apply_wardrobe
from bath_pose_geometry import basin_contour
sys.path.insert(0, str(MODELS/'furniture'))
from build_parts import material, mesh

SOURCE = MODELS/'bathroom/owner-review-pending/bathtub/candidate-02/bathtub-authoring.blend'
RIG_SOURCE = MODELS/'sims/sim-01/sim-01-rigged.blend'
EXPECTED_SOURCE = '4eb71e029fd7904cffa612fbec122831b86911f24643ff92099c8c731fc25f56'
EXPECTED_RIG = '919e8994cbf7510a4d9947f173abec8b41ac77d61f6e829bcf5981c8d2fcddce'
HEAD_END_Y_MAX = -.45
WALL_Z_WINDOW = (.16, .56)
BACK_WINDOW = (1.12, 1.31)
FLAT_WALL_MAX_NORMAL_X = .05
FLOOR_Z = .15
ANKLE_ABOVE_FLOOR = .15
ANKLE_FORWARD = .66
ANKLE_X = .159
FOOT_PITCH_DEGREES = 8.2023
WRIST_FORWARD = .22
WRIST_Z = .40
WRIST_X = .16
FACINGS = {'SE':90, 'NW':270, 'SW':0, 'NE':180}
RIM_Z = .56
SEAT_BODIES = ('Trouser hip bridge', 'Tailored trouser leg', 'Tailored trouser leg.001')
WALL_BODIES = SEAT_BODIES+('Overshirt body', 'Shirt lower hem', 'Shirt placket')
INTENDED_GAP = .001
SETTLE_TOLERANCE = 1e-4
UPPER_BACK_LEVER = .5
WATER_Z = .52
WATER_NAME = 'Bath opaque water surface'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def open_source():
    if digest(SOURCE) != EXPECTED_SOURCE or digest(RIG_SOURCE) != EXPECTED_RIG:
        raise ValueError('Immutable bath or shared-rig source hash changed')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    root, rig = bpy.data.objects['BATHTUB_MODEL_ROOT'], bpy.data.objects['SIM_01_SHARED_RIG']
    if root.location.length > 1e-7 or any(abs(v-1) > 1e-6 for v in root.scale):
        raise ValueError('Accepted tub is not the unchanged centred unit-scale source')
    root.rotation_euler.z = 0
    rig.rotation_euler.z = 0
    rig.location = (0, 0, 0)
    rig.animation_data.action = None
    scene.frame_set(1)
    bpy.context.view_layer.update()
    return scene, root, rig


def head_end_facets(shell_geometry):
    """Evaluated shell triangles on the inner head-end wall, with their raw winding normals."""
    vertices = shell_geometry['vertices_world']
    facets = []
    for index, tri in enumerate(shell_geometry['triangles']):
        a, b, c = (Vector(vertices[i]) for i in tri)
        centre = (a+b+c)/3
        normal = (b-a).cross(c-a)
        if normal.length < 1e-12:
            continue
        area = normal.length/2
        normal.normalize()
        if centre.y > HEAD_END_Y_MAX or not WALL_Z_WINDOW[0] <= centre.z <= WALL_Z_WINDOW[1]:
            continue
        if abs(normal.y) < .85 or abs(normal.x) > FLAT_WALL_MAX_NORMAL_X:
            continue
        facets.append(dict(triangle_id=index, vertex_ids=list(tri), centre=list(centre),
                           raw_normal=list(normal), area=area))
    return facets


def rest_witnesses(body_objects, deps):
    """Rest-pose world points: the lowest pelvis band and the rear upper back."""
    hips = evaluated_geometry(body_objects['Trouser hip bridge'], deps)['vertices_world']
    lowest = min(p[2] for p in hips)
    hip_points = [p for p in hips if p[2] <= lowest+.005]
    torso = evaluated_geometry(body_objects['Overshirt body'], deps)['vertices_world']
    back_points = [p for p in torso if BACK_WINDOW[0] <= p[2] <= BACK_WINDOW[1] and p[1] >= .025]
    rear_most = max(p[1] for p in back_points)
    back_points = [p for p in back_points if p[1] >= rear_most-.01]
    # The pelvis and the whole torso lie parallel to the wall, so whichever rear surface
    # reaches furthest back decides the wall gap; include them in the same witness set.
    for name in ('Overshirt body', 'Trouser hip bridge'):
        rear = [p for p in evaluated_geometry(body_objects[name], deps)['vertices_world'] if p[1] >= .1]
        back_points.extend(p for p in rear if p[1] >= max(q[1] for q in rear)-.005)
    return hip_points, back_points


def fit_plane(shell, facets, proof):
    """Fit the inner skin of the head-end wall, the facets whose raw normals face the water.

    The shell is a closed solid: its outer skin also passes the pitch filter but lies further
    from the body (smaller Y) and has a different pitch, so a body solved against it ends up
    inside the wall. Only the inner facets, reversed into the helper's winding convention, count.
    """
    outward = [f for f in facets if f['raw_normal'][1] < 0]
    inward = [f for f in facets if f['raw_normal'][1] > 0]
    proof['facet_orientation'] = dict(raw_normal_toward_body=len(inward), raw_normal_away_from_body=len(outward),
                                      inner_mean_y=sum(f['centre'][1] for f in inward)/len(inward) if inward else None,
                                      outer_mean_y=sum(f['centre'][1] for f in outward)/len(outward) if outward else None)
    if inward and outward and sum(f['centre'][1] for f in inward)/len(inward) <= sum(f['centre'][1] for f in outward)/len(outward):
        raise ValueError('Inner head-end facets are not nearer the body than the outer skin')
    for name, candidate, reverse in (('inner-skin-reversed-winding', inward, True),):
        if not candidate:
            continue
        ids = sorted({i for f in candidate for i in f['vertex_ids']})
        remap = {i:k for k, i in enumerate(ids)}
        verts = [shell['vertices_world'][i] for i in ids]
        tris = [tuple(remap[i] for i in f['vertex_ids']) for f in candidate]
        if reverse:
            tris = [(t[0], t[2], t[1]) for t in tris]
        try:
            plane = derive_head_end_plane(verts, tris)
        except ValueError as failure:
            proof.setdefault('plane_attempts', []).append(dict(facet_set=name, error=str(failure)))
            continue
        plane['facet_set'] = name
        plane['facet_triangle_ids'] = [f['triangle_id'] for f in candidate]
        return plane
    return None


def probe(output):
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender with a new absolute probe directory')
    output.mkdir(parents=True, exist_ok=False)
    inputs = {p.relative_to(MODELS).as_posix():digest(p)
              for p in (SOURCE, RIG_SOURCE, Path(__file__).resolve(), BASE/'bath_wall_support.py')}
    proof = dict(state='running', mode='wall-backed-probe', blender_version=bpy.app.version_string, inputs=inputs,
                 purpose='Read the actual head-end wall facets and rest-pose witnesses before solving a frame')
    def save():
        (output/'proof.json').write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        scene, root, rig = open_source()
        proof['fixture_validation'] = validate_fixture()
        pose(rig, 'idle', 0)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        fixtures = {obj.name:obj for obj in root.children_recursive if obj.type in ('MESH', 'CURVE')}
        shell = evaluated_geometry(fixtures['Bathtub continuous shell'], deps)
        facets = head_end_facets(shell)
        bodies = {obj.name:obj for obj in rig.children_recursive if obj.type == 'MESH'}
        hip_points, back_points = rest_witnesses(bodies, deps)
        proof.update(shell_triangle_count=len(shell['triangles']), head_end_facet_count=len(facets),
                     head_end_facets=facets,
                     head_end_vertices={str(i):shell['vertices_world'][i] for f in facets for i in f['vertex_ids']},
                     hip_rest_points=hip_points, back_rest_points=back_points,
                     hips_head_local=list(rig.data.bones['hips'].head_local),
                     hips_tail_local=list(rig.data.bones['hips'].tail_local),
                     spine_head_local=list(rig.data.bones['spine'].head_local),
                     head_head_local=list(rig.data.bones['head'].head_local),
                     bone_lengths={b.name:b.length for b in rig.data.bones})
        plane = fit_plane(shell, facets, proof)
        proof['plane'] = plane
        if plane is not None:
            proof['candidate_frame'] = solve_translation(hip_points, back_points, plane)
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


def apply_wall_frame(rig, candidate):
    """Pelvis, back and head share the wall pitch; the hips head lands on the solved translation."""
    angle = candidate['hip_angle']
    rotated = Vector(recline_vector(tuple(rig.data.bones['hips'].head_local), angle))
    hip = rotated+Vector(candidate['translation'])
    frame = apply_support_frame(rig, hip_y=hip.y, hip_z=hip.z, hip_angle=angle, back_angle=angle, head_angle=angle)
    frame['limbs_fitted'] = False
    return frame


def fit_limbs(rig):
    """Knees up with the feet forward on the basin floor; hands resting on the thighs."""
    import math
    record = {}
    for side in ('L', 'R'):
        thigh, shin, foot = [rig.data.bones[name+'.'+side] for name in ('thigh', 'shin', 'foot')]
        hip = rig.pose.bones['thigh.'+side].head.copy()
        sign = 1 if hip.x >= 0 else -1
        ankle = Vector((sign*ANKLE_X, hip.y+ANKLE_FORWARD, FLOOR_Z+ANKLE_ABOVE_FLOOR))
        knee = Vector(two_link(tuple(hip), tuple(ankle), thigh.length, shin.length, (hip.x, hip.y+.25, hip.z+.6)))
        direct_bone(rig, 'thigh.'+side, hip, knee)
        direct_bone(rig, 'shin.'+side, knee, ankle)
        pitch = math.radians(FOOT_PITCH_DEGREES)
        direct_bone(rig, 'foot.'+side, ankle, ankle+foot.length*Vector((0, math.cos(pitch), -math.sin(pitch))))
        upper, lower, hand = [rig.data.bones[name+'.'+side] for name in ('upper_arm', 'forearm', 'hand')]
        shoulder = rig.pose.bones['upper_arm.'+side].head.copy()
        sign = 1 if shoulder.x >= 0 else -1
        wrist = Vector((sign*WRIST_X, hip.y+WRIST_FORWARD, WRIST_Z))
        elbow = Vector(two_link(tuple(shoulder), tuple(wrist), upper.length, lower.length, (sign*.26, shoulder.y+.02, .30)))
        direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
        direct_bone(rig, 'forearm.'+side, elbow, wrist)
        direction = Vector((0, .95, -.31)).normalized()
        direct_bone(rig, 'hand.'+side, wrist, wrist+direction*hand.length)
        record[side] = dict(hip=list(hip), knee=list(knee), ankle=list(ankle), shoulder=list(shoulder),
                            elbow=list(elbow), wrist=list(wrist),
                            knee_inside_basin=basin_contains(*knee), ankle_inside_basin=basin_contains(*ankle))
    bpy.context.view_layer.update()
    return record


def wall_facing_surface(obj, rig, bone_name, low_z, high_z, n, deps):
    """Rear body triangles in the rest window whose evaluated normals face the wall (against +n)."""
    from mathutils.bvhtree import BVHTree
    groups = {group.index:group.name for group in obj.vertex_groups}
    if any(len(vertex.groups) != 1 or groups[vertex.groups[0].group] != bone_name
           or abs(vertex.groups[0].weight-1) > 1e-6 for vertex in obj.data.vertices):
        raise ValueError('Wall support query requires a verified rigid single-bone body surface')
    deform = rig.matrix_world@rig.pose.bones[bone_name].matrix@rig.data.bones[bone_name].matrix_local.inverted()
    inverse = deform.inverted()
    evaluated = obj.evaluated_get(deps)
    data = evaluated.to_mesh()
    try:
        data.calc_loop_triangles()
        points = [evaluated.matrix_world@v.co for v in data.vertices]
        triangles, retained = [], []
        for index, tri in enumerate(data.loop_triangles):
            tri = tuple(tri.vertices)
            rest = [inverse@points[v] for v in tri]
            if not all(low_z <= p.z <= high_z and p.y >= .025 for p in rest):
                continue
            a, b, c = [points[v] for v in tri]
            normal = (b-a).cross(c-a).normalized()
            if normal.dot(n) > -.5:
                continue
            triangles.append(tri)
            retained.append(dict(triangle_id=index, world_vertices=[list(p) for p in (a, b, c)],
                                 rest_vertices=[list(p) for p in rest], world_normal=list(normal),
                                 label_source='verified-single-rigid-bone-inverse', selection='faces the wall normal'))
    finally:
        evaluated.to_mesh_clear()
    if not triangles:
        raise ValueError('No evaluated wall-facing rear triangles in the declared anatomical region')
    selected = [points[v] for tri in triangles for v in tri]
    return BVHTree.FromPolygons(points, triangles, all_triangles=True), selected, retained


def world_vertices(obj, deps):
    return [Vector(v) for v in evaluated_geometry(obj, deps)['vertices_world']]


def settle(rig, body, plane, frame, lean=0.):
    """Move the whole frame until the seat rests on the floor and the rear rests on the wall.

    The posed thighs swing their rear below the pelvis, so the seat contact is the actual trouser
    surface rather than the solved hip witness. Each pass refits the limbs, measures the lowest
    seat point and the smallest wall gap below the rim over the seat and torso surfaces, and
    shifts the hips head to put both at the intended gap. `lean` adds degrees to the back and
    head so the upper back meets the wall when the pelvis would otherwise touch first.
    """
    n = Vector(plane['normal'])
    angle = frame['hip_angle']
    hip_y, hip_z = frame['hip_y'], frame['hip_z']
    history = []
    visible = {obj.name:obj for obj in body.all_objects if not obj.hide_render}
    for iteration in range(8):
        apply_support_frame(rig, hip_y=hip_y, hip_z=hip_z, hip_angle=angle, back_angle=angle+lean, head_angle=angle+lean)
        limbs = fit_limbs(rig)
        deps = bpy.context.evaluated_depsgraph_get()
        seat = [v for name in SEAT_BODIES for v in world_vertices(visible[name], deps)]
        rear = [v for name in WALL_BODIES for v in world_vertices(visible[name], deps) if v.z <= RIM_Z]
        floor_min = min(v.z for v in seat)
        wall_min = min((v-Vector(plane['point'])).dot(n) for v in rear)
        dz = FLOOR_Z+INTENDED_GAP-floor_min
        dn = INTENDED_GAP-wall_min
        history.append(dict(iteration=iteration, hip_y=hip_y, hip_z=hip_z, seat_floor_min_z=floor_min,
                            rear_wall_min_gap=wall_min, shift_z=dz, shift_normal=dn))
        if abs(dz) < SETTLE_TOLERANCE and abs(dn) < SETTLE_TOLERANCE:
            break
        hip_z += dz
        hip_y += (dn-n.z*dz)/n.y
    else:
        raise ValueError('Seat and wall contact did not settle within eight passes')
    return dict(hip_y=hip_y, hip_z=hip_z, hip_angle=angle, back_angle=angle+lean, head_angle=angle+lean,
                lean_degrees=lean, passes=history, limbs=limbs)


def seat_support_grid(bodies, shell, deps, step=.006):
    """Finite floor support under the actual downward-facing seat surface near the floor."""
    import math
    from mathutils.bvhtree import BVHTree
    points, triangles, retained = [], [], []
    for obj in bodies:
        geometry = evaluated_geometry(obj, deps)
        base = len(points)
        verts = [Vector(v) for v in geometry['vertices_world']]
        points.extend(verts)
        for index, tri in enumerate(geometry['triangles']):
            a, b, c = (verts[i] for i in tri)
            normal = (b-a).cross(c-a)
            if normal.length < 1e-12:
                continue
            normal.normalize()
            if normal.z > -.3 or max(a.z, b.z, c.z) > FLOOR_Z+.08:
                continue
            triangles.append(tuple(base+i for i in tri))
            retained.append(dict(body=obj.name, triangle_id=index, world_vertices=[list(a), list(b), list(c)], world_normal=list(normal)))
    if not triangles:
        raise ValueError('No downward-facing seat triangles near the basin floor')
    tree = BVHTree.FromPolygons(points, triangles, all_triangles=True)
    selected = [points[i] for tri in triangles for i in tri]
    surface = shell.evaluated_get(deps)
    inverse = surface.matrix_world.inverted()
    xs = range(math.ceil(min(p.x for p in selected)/step), math.floor(max(p.x for p in selected)/step)+1)
    ys = range(math.ceil(min(p.y for p in selected)/step), math.floor(max(p.y for p in selected)/step)+1)
    grid = []
    for ix in xs:
        for iy in ys:
            x, y = round(ix*step, 6), round(iy*step, 6)
            hit, basin, normal, _ = surface.ray_cast(inverse@Vector((x, y, 1.5)), inverse.to_3x3()@Vector((0, 0, -1)))
            if not hit:
                continue
            basin = surface.matrix_world@basin
            if basin.z >= RIM_Z or not basin_contains(x, y, max(FLOOR_Z, basin.z)):
                continue
            body, body_normal, _, _ = tree.ray_cast(Vector((x, y, -.2)), Vector((0, 0, 1)), 2)
            if body is None:
                continue
            grid.append(dict(x=x, y=y, body_z=body.z, basin_z=basin.z, gap=body.z-basin.z,
                             actual_basin_normal=list(normal), actual_body_normal=list(body_normal)))
    if not grid:
        raise ValueError('No actual seat to basin floor ray hits')
    near = {(p['x'], p['y']):p for p in grid if 0 <= p['gap'] <= .01}
    patch = None
    for x, y in sorted(near, key=lambda key:near[key]['gap']):
        proposed = [near.get((round(x+i*step, 6), round(y+j*step, 6))) for i in range(7) for j in range(9)]
        if all(p is not None for p in proposed):
            patch = validate_support_patch(proposed)
            break
    return dict(bodies=[obj.name for obj in bodies], query='vertical rays under downward-facing seat triangles within 80 mm of the floor',
                grid_step=step, actual_surface_ray_hits=len(grid), min_gap=min(p['gap'] for p in grid),
                max_gap=max(p['gap'] for p in grid), finite_patch=patch, complete_actual_grid=grid,
                evaluated_seat_triangles=retained,
                state='passed' if patch is not None and 0 <= min(p['gap'] for p in grid) <= .003 else 'failed')


def wall_support_grid(torso, rig, plane, shell, deps, step=.006):
    """Finite support against the sloped wall: rays along the wall normal, grid in the wall plane."""
    import math
    n = Vector(plane['normal'])
    tree, selected, triangles = wall_facing_surface(torso, rig, 'spine', *BACK_WINDOW, n, deps)
    u = Vector((1, 0, 0))
    v = Vector((0, -n.z, n.y))
    origin = Vector(plane['point'])
    surface = shell.evaluated_get(deps)
    inverse = surface.matrix_world.inverted()
    xs = range(math.ceil(min(p.x for p in selected)/step), math.floor(max(p.x for p in selected)/step)+1)
    ss = [(p-origin).dot(v) for p in selected]
    srange = range(math.ceil(min(ss)/step), math.floor(max(ss)/step)+1)
    grid = []
    for ix in xs:
        for iy in srange:
            x, s = round(ix*step, 6), round(iy*step, 6)
            q = origin+x*u+s*v
            start = q+n*.25
            hit, local, wall_normal, _ = surface.ray_cast(inverse@start, inverse.to_3x3()@(-n))
            if not hit:
                continue
            wall = surface.matrix_world@local
            wall_n = (wall-q).dot(n)
            body, body_normal, _, _ = tree.ray_cast(wall, n, .3)
            if body is None:
                continue
            body_n = (body-q).dot(n)
            grid.append(dict(x=x, y=s, body_z=body_n, basin_z=wall_n, gap=body_n-wall_n,
                             wall_point=list(wall), body_point=list(body),
                             actual_wall_normal=list(wall_normal), actual_body_normal=list(body_normal)))
    if not grid:
        raise ValueError('No actual rear-body to head-end wall ray hits')
    near = {(p['x'], p['y']):p for p in grid if 0 <= p['gap'] <= .01}
    patch = None
    for x, s in sorted(near, key=lambda key:near[key]['gap']):
        proposed = [near.get((round(x+i*step, 6), round(s+j*step, 6))) for i in range(7) for j in range(9)]
        if all(p is not None for p in proposed):
            patch = validate_support_patch(proposed)
            break
    return dict(body=torso.name, anatomical_region=dict(bone='spine', source_z_window=list(BACK_WINDOW)),
                query='normal-directed rays in the wall tangent frame; y is distance up the wall',
                grid_step=step, actual_surface_ray_hits=len(grid), min_gap=min(p['gap'] for p in grid),
                max_gap=max(p['gap'] for p in grid), finite_patch=patch, complete_actual_grid=grid,
                evaluated_rear_query_triangles=triangles,
                state='passed' if patch is not None and 0 <= min(p['gap'] for p in grid) <= .003 else 'failed')


def containment_review(point, tree):
    """Ray parity along +Z and -Z through one body surface, to review a nearest-normal containment hit.

    The trouser legs are open tubes, so the shared nearest-normal test can call a point inside
    when its nearest surface is a boundary. A point truly inside a surface sees an odd number of
    crossings in both directions; a point in free space sees an even number in both.
    """
    counts, nearest = {}, None
    for label, direction in (('+z', Vector((0, 0, 1))), ('-z', Vector((0, 0, -1))), ('+x', Vector((1, 0, 0))),
                             ('-x', Vector((-1, 0, 0))), ('+y', Vector((0, 1, 0))), ('-y', Vector((0, -1, 0)))):
        origin, hits = Vector(point), 0
        for _ in range(64):
            location, _, _, distance = tree.ray_cast(origin, direction, 5)
            if location is None:
                break
            hits += 1
            if nearest is None or distance < nearest:
                nearest = distance if hits == 1 and origin == Vector(point) else nearest
            origin = location+direction*1e-5
        counts[label] = hits
    first_up = tree.ray_cast(Vector(point), Vector((0, 0, 1)), 5)[3]
    return dict(crossings=counts, parity_inside=all(c % 2 == 1 for c in counts.values()),
                first_surface_above=first_up, verdict='inside' if all(c % 2 == 1 for c in counts.values())
                else 'outside by ray parity; nearest-normal hit on an open mesh boundary')


def build_bath_water(root, furniture, z=WATER_Z):
    """One opaque water surface at `z`, inset from the actual basin contour, owned by the fixture."""
    points = [tuple(p) for p in basin_contour(z)]
    mat = material('Bath opaque water', (.46, .70, .78))
    obj = mesh(WATER_NAME, points, [list(range(len(points)))], mat, root)
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    furniture.objects.link(obj)
    obj['collision_solid'] = False
    obj['structural_support'] = False
    obj['occluder_only'] = True
    bpy.context.view_layer.update()
    return dict(name=obj.name, height=z, contour_points=len(points), inset=.006, material=mat.name,
                collision_solid=False, structural_support=False)


def measure_wall_pose(root, rig, body, plane):
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    visible = {obj.name:obj for obj in body.all_objects if not obj.hide_render}
    if set(visible) != body_inventory():
        raise ValueError('Original 54-object body inventory changed')
    fixtures = {obj.name:obj for obj in root.children_recursive if obj.type in ('MESH', 'CURVE')}
    if set(fixtures) != SOLIDS:
        raise ValueError('Complete immutable twelve-solid bath fixture inventory changed')
    shell = fixtures['Bathtub continuous shell']
    hip = seat_support_grid([visible[name] for name in SEAT_BODIES], shell, deps)
    back = wall_support_grid(visible['Overshirt body'], rig, plane, shell, deps)
    fixture_surfaces = {name:evaluated_surface(obj, deps) for name, obj in fixtures.items()}
    collisions, reviewed = [], []
    for name, obj in visible.items():
        surface = evaluated_surface(obj, deps)
        for other, fixture in fixture_surfaces.items():
            witness = intersection(surface, fixture)
            if not witness:
                continue
            if witness['kind'] == 'chair_inside_body':
                review = containment_review(witness['point'], surface[1])
                if not review['parity_inside'] and (review['first_surface_above'] is None or review['first_surface_above'] > .005):
                    reviewed.append(dict(body=name, fixture=other, **witness, review=review))
                    continue
                witness = dict(witness, review=review)
            collisions.append(dict(body=name, fixture=other, **witness))
    errors = {bone.name:abs((bone.tail-bone.head).length-rig.data.bones[bone.name].length) for bone in rig.pose.bones}
    if len(errors) != 17 or max(errors.values()) > 1e-5:
        raise ValueError('Wall-backed frame changed anatomical lengths')
    return dict(support=dict(hip=hip, back=back), collisions=collisions, bone_length_errors=errors,
                reviewed_open_mesh_containment_hits=reviewed,
                complete_body_fixture_pairs=len(visible)*len(fixtures),
                support_state='passed' if not collisions and hip['state'] == 'passed' and back['state'] == 'passed' else 'failed',
                joint_targets={bone.name:dict(head=list(bone.head), tail=list(bone.tail)) for bone in rig.pose.bones})


def prototype(output, render=True):
    """Solve the wall-backed frame, fit limbs, measure, save an editable model and render four views."""
    if not bpy.app.background or not output.is_absolute():
        raise ValueError('Use hidden background Blender with a new absolute prototype directory')
    output.mkdir(parents=True, exist_ok=False)
    import math
    import shutil
    from bpy_extras.object_utils import world_to_camera_view
    scripts = {Path(module.__file__).resolve() for module in sys.modules.values()
               if getattr(module, '__file__', None) and str(module.__file__).endswith('.py')
               and Path(module.__file__).resolve().is_relative_to(MODELS.resolve())}
    scripts.update((SOURCE, RIG_SOURCE, SOURCE.parent/'proof.json', MODELS/'sims/sim-01/registered-canvas-proof.json',
                    MODELS/'bathroom/bathtub_geometry.py', MODELS/'bathroom/bathtub_model.py'))
    inputs = {path.relative_to(MODELS).as_posix():digest(path) for path in sorted(scripts)}
    for path in sorted(scripts):
        if path.suffix == '.py':
            target = output/'source'/path.relative_to(MODELS)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    proof = dict(state='running', mode='wall-backed-green-four-facing-prototype', inputs=inputs,
                 blender_version=bpy.app.version_string, renders=[], water_present=False, source_acceptance='unverified')
    def save():
        (output/'proof.json').write_text(json.dumps(proof, indent=2, allow_nan=False)+'\n')
    save()
    try:
        scene, root, rig = open_source()
        body, furniture = partition(scene, root, rig)
        proof['fixture_validation_before'] = validate_fixture()
        if scene.camera.data.type != 'ORTHO' or [scene.render.resolution_x, scene.render.resolution_y] != [1280, 1408]:
            raise ValueError('Accepted bath camera or original canvas changed')
        origin = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        proof.update(original_render_dimensions=[1280, 1408], origin_pixels=[origin.x*1280, (1-origin.y)*1408],
                     camera_matrix=[list(row) for row in scene.camera.matrix_world], ortho_scale=scene.camera.data.ortho_scale)
        pose(rig, 'idle', 0)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        fixtures = {obj.name:obj for obj in root.children_recursive if obj.type in ('MESH', 'CURVE')}
        shell = evaluated_geometry(fixtures['Bathtub continuous shell'], deps)
        facets = head_end_facets(shell)
        bodies = {obj.name:obj for obj in rig.children_recursive if obj.type == 'MESH'}
        hip_points, back_points = rest_witnesses(bodies, deps)
        plane = fit_plane(shell, facets, proof)
        if plane is None:
            raise ValueError('No flat head-end wall plane could be derived from the actual facets')
        proof['plane'] = plane
        candidate = solve_translation(hip_points, back_points, plane)
        proof['candidate_frame'] = candidate
        frame = apply_wall_frame(rig, candidate)
        proof['solved_frame'] = frame
        settled = settle(rig, body, plane, frame)
        proof['settled_frame'] = settled
        first = measure_wall_pose(root, rig, body, plane)
        proof['measurement_before_lean'] = dict(support_state=first['support_state'], collisions=first['collisions'],
                                                back_min_gap=first['support']['back']['min_gap'], hip_min_gap=first['support']['hip']['min_gap'])
        import math
        lean = math.degrees(math.atan2(max(first['support']['back']['min_gap']-INTENDED_GAP, 0), UPPER_BACK_LEVER))
        if lean > 0:
            settled = settle(rig, body, plane, frame, lean=lean)
            proof['settled_frame'] = settled
        proof['limbs'] = settled['limbs']
        proof['measurement'] = measure_wall_pose(root, rig, body, plane)
        save()
        proof['water'] = build_bath_water(root, furniture)
        proof['wardrobe'] = apply_wardrobe(body)
        proof['rendered_body_inventory'] = sorted(obj.name for obj in body.all_objects if not obj.hide_render)
        save()
        bpy.context.preferences.filepaths.save_version = 0
        model = output/'bath-pose-authoring.blend'
        bpy.ops.wm.save_as_mainfile(filepath=str(model))
        proof['editable_model'] = dict(path=model.name, sha256=digest(model))
        if render:
            scene.render.resolution_percentage = 100
            scene.render.threads_mode = 'FIXED'
            scene.render.threads = 2
            scene.render.film_transparent = True
            scene.render.image_settings.file_format = 'PNG'
            scene.render.image_settings.color_mode = 'RGBA'
            for facing, degrees in FACINGS.items():
                root.rotation_euler.z = math.radians(degrees)
                rig.rotation_euler.z = math.radians(degrees)
                bpy.context.view_layer.update()
                path = output/f'{facing}-green-0-beauty.png'
                render_pass(scene, body, furniture, 'beauty', path, separate_lines=True)
                proof['renders'].append(dict(facing=facing, variant='green', frame=0, owner='beauty', path=path.name, sha256=digest(path)))
                save()
        root.rotation_euler.z = 0
        rig.rotation_euler.z = 0
        bpy.context.view_layer.update()
        proof['fixture_validation_after'] = validate_fixture()
        if proof['fixture_validation_after'] != proof['fixture_validation_before']:
            raise ValueError('Fixture validation after the prototype differs from the validation before it')
        proof['water_present'] = True
        proof['immutable_sources_byte_identical'] = all(digest(MODELS/name) == expected for name, expected in inputs.items())
        if not proof['immutable_sources_byte_identical']:
            raise ValueError('Prototype changed immutable input bytes')
        proof['state'] = 'complete'
        save()
    except BaseException:
        proof['state'] = 'failed'
        proof['error'] = traceback.format_exc()
        save()
        raise


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:]
    if '--probe' in args:
        probe(Path(args[0]))
    elif '--prototype' in args:
        prototype(Path(args[0]), '--measure-only' not in args)
    else:
        raise ValueError('Choose --probe or --prototype')
