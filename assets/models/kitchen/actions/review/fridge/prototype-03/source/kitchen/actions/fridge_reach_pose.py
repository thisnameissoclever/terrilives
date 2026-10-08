"""Blender posing and measurement for the fridge open-and-reach samples.

The accepted refrigerator authoring scene already carries the shared Sim rig
(hidden). `prepare` puts the rig on the front-tile stance under a pivot at the
world origin, so the four render facings can turn the fixture and the body
together, and splits the visible geometry into body and fixture collections.
`apply_sample` sets the refrigerator door's hinge angle and poses the
seventeen bones for one sample; it never moves a fixture part other than the
refrigerator door assembly.
"""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
sys.path[:0] = [str(BASE), str(MODELS/'sims/sim-01'), str(MODELS/'living'), str(MODELS/'bathroom/actions')]
from build_rig import direct_bone, pose
from armchair_contact import body_inventory, evaluated_surface
from toilet_pose_geometry import two_link
import fridge_reach_geometry as geo

ROOT = 'REFRIGERATOR_MODEL_ROOT'
RIG = 'SIM_01_SHARED_RIG'
PIVOT = 'FRIDGE_REACH_PIVOT'
DOOR_HINGE = 'Refrigerator right hinge'
FREEZER_HINGE = 'Freezer right hinge'
BODY_COLLECTION = 'Fridge action body'
FIXTURE_COLLECTION = 'Fridge action fixture'
LEFT_ARM = ('Relaxed shirt sleeve', 'Turned sleeve cuff', 'Forearm with elbow and wrist sections',
            'Relaxed palm', 'Resting thumb')
HAND_GAP = .006


def prepare(scene):
    root = bpy.data.objects[ROOT]
    rig = bpy.data.objects[RIG]
    root.rotation_euler.z = 0
    rig.animation_data.action = None
    pivot = bpy.data.objects.new(PIVOT, None)
    scene.collection.objects.link(pivot)
    rig.parent = pivot
    rig.matrix_parent_inverse = Matrix.Identity(4)
    x, y = geo.stance(0)
    rig.location = (x, y, 0)
    rig.rotation_euler = (0, 0, math.radians(geo.rig_rotation_degrees()))
    rig.scale = (1, 1, 1)
    scene.frame_set(1)
    body, fixture = partition(scene, root, rig)
    bpy.context.view_layer.update()
    return root, rig, pivot, body, fixture


def partition(scene, root, rig):
    fixture_members = set(root.children_recursive)
    body_members = set(rig.children_recursive)
    body = bpy.data.collections.new(BODY_COLLECTION)
    fixture = bpy.data.collections.new(FIXTURE_COLLECTION)
    scene.collection.children.link(body)
    scene.collection.children.link(fixture)
    for obj in list(bpy.data.objects):
        if obj.type not in ('MESH', 'CURVE'):
            continue
        target = fixture if obj in fixture_members else body if obj in body_members else None
        if target is None:
            if not obj.hide_render:
                raise ValueError(f'Unowned visible geometry: {obj.name}')
            continue
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        target.objects.link(obj)
    for collection in bpy.data.collections:
        collection.hide_render = False
        collection.hide_viewport = False
    bpy.context.view_layer.update()
    return body, fixture


def door_parts():
    return sorted(obj.name for obj in bpy.data.objects[DOOR_HINGE].children_recursive)


def set_facing(root, pivot, degrees):
    root.rotation_euler.z = math.radians(degrees)
    pivot.rotation_euler.z = math.radians(degrees)
    bpy.context.view_layer.update()


def stance_matrix(index):
    """Rig object matrix at a sample with the pivot unturned: the frame every world target is written in."""
    x, y = geo.stance(index)
    return Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(geo.rig_rotation_degrees()), 4, 'Z')


def to_armature(index, point):
    return stance_matrix(index).inverted() @ Vector(point)


def torso_rotation(index):
    lean = Matrix.Rotation(math.radians(geo.LEAN_DEGREES[index]), 4, 'X')
    twist = Matrix.Rotation(math.radians(geo.TWIST_DEGREES[index]), 4, 'Z')
    return lean @ twist, lean @ Matrix.Rotation(math.radians(.4*geo.TWIST_DEGREES[index]), 4, 'Z')


def handle_grip(degrees):
    """World grip point on the refrigerator handle bar, outer normal and hinge tangent."""
    angle = math.radians(degrees)
    x, y = geo.door_point(geo.HANDLE, degrees)
    normal = Vector((math.sin(angle), -math.cos(angle), 0))
    tangent = Vector((math.cos(angle), math.sin(angle), 0))
    return Vector((x, y, .93)), normal, tangent


def inner_face(degrees, along=.74, height=1.10):
    """World point on the door's inner face near the free edge, its inward normal and edge direction."""
    angle = math.radians(degrees)
    along_door = Vector((-math.cos(angle), -math.sin(angle), 0))
    inward = Vector((-math.sin(angle), math.cos(angle), 0))
    point = Vector((*geo.HINGE, height)) + along_door*along
    return point, inward, along_door


def left_targets(index, rig):
    """World wrist and pointing-end targets of the left hand, and the direction that frees it."""
    plan = geo.LEFT_HAND[index]
    degrees = geo.DOOR_DEGREES[index]
    if plan == 'rest':
        return None
    if plan == 'handle':
        grip, normal, tangent = handle_grip(degrees)
        wrist = grip + normal*.09 + Vector((0, 0, .03)) - tangent*.04
        tip = wrist + (tangent*.55 - normal*.30 + Vector((0, 0, -.55))).normalized()*.111
        return wrist, tip, normal
    if plan == 'door_edge':
        # Fingers round the door's free edge, the palm toward the hinge.
        angle = math.radians(degrees)
        along_door = Vector((-math.cos(angle), -math.sin(angle), 0))
        outward = Vector((math.sin(angle), -math.cos(angle), 0))
        x, y = geo.door_point(geo.DOOR_TIP, degrees)
        edge = Vector((x, y, 1.10)) - outward*.035
        wrist = edge + along_door*.07
        tip = wrist + (-along_door*.8 + Vector((0, 0, -.35))).normalized()*.111
        return wrist, tip, along_door
    target = geo.REACH[index]
    return Vector(target['wrist']), Vector(target['tip']), Vector((0, 0, 1))


def arm_world_pole(shoulder, pole):
    _, facing, left = geo.stance_frame()
    a, b, c = geo.ELBOW_POLES[pole]
    return shoulder + Vector((*left, 0))*a + Vector((*facing, 0))*b + Vector((0, 0, c))


def place_arm(rig, side, shoulder, wrist, tip, pole):
    upper = rig.data.bones['upper_arm.'+side].length
    lower = rig.data.bones['forearm.'+side].length
    elbow = Vector(two_link(tuple(shoulder), tuple(wrist), upper, lower, tuple(pole)))
    direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
    direct_bone(rig, 'forearm.'+side, elbow, wrist)
    direct_bone(rig, 'hand.'+side, wrist, tip)


def apply_sample(rig, index, wrist_offset=(0, 0, 0), pole=None):
    """Pose one sample in armature space and set the door; returns the left-hand plan."""
    door = bpy.data.objects[DOOR_HINGE]
    door.rotation_euler.z = math.radians(geo.DOOR_DEGREES[index])
    bpy.data.objects[FREEZER_HINGE].rotation_euler.z = 0
    x, y = geo.stance(index)
    rig.location = (x, y, 0)
    pose(rig, 'idle', 0)
    torso, pelvis = torso_rotation(index)
    pivot = Vector((0, 0, .86))
    def about(rotation, point):
        return pivot + rotation @ (Vector(point)-pivot)
    twist = Matrix.Rotation(math.radians(geo.TWIST_DEGREES[index]), 4, 'Z')
    for name, rotation in (('hips', pelvis), ('spine', torso)):
        rest = rig.data.bones[name]
        direct_bone(rig, name, about(rotation, rest.head_local), about(rotation, rest.tail_local))
    # The legs are children of the hips: put them back on their standing
    # rest joints so the feet stay planted while the pelvis bends.
    for side in ('L', 'R'):
        for name in ('thigh', 'shin', 'foot'):
            leg = rig.data.bones[name+'.'+side]
            direct_bone(rig, name+'.'+side, leg.head_local, leg.tail_local)
    # The head rides on the bent spine but stays upright, looking into the
    # cabinet over the open door instead of tipping into the freezer door.
    rest = rig.data.bones['head']
    neck = about(torso, rest.head_local)
    direct_bone(rig, 'head', neck, neck + twist @ (rest.tail_local-rest.head_local))
    plans = {}
    for side in ('L', 'R'):
        upper, lower, hand = [rig.data.bones[n+'.'+side] for n in ('upper_arm', 'forearm', 'hand')]
        shoulder = about(torso, upper.head_local)
        targets = left_targets(index, rig) if side == 'L' else None
        if targets is None:
            # A resting arm hangs under gravity from its displaced shoulder; the
            # torso twist turns it but the forward bend does not swing it.
            elbow = shoulder + twist @ (upper.tail_local-upper.head_local)
            wrist = elbow + twist @ (lower.tail_local-lower.head_local)
            tip = wrist + twist @ (hand.tail_local-hand.head_local)
            direct_bone(rig, 'upper_arm.'+side, shoulder, elbow)
            direct_bone(rig, 'forearm.'+side, elbow, wrist)
            direct_bone(rig, 'hand.'+side, wrist, tip)
            plans[side] = 'rest'
            continue
        wrist_world, tip_world, _ = targets
        offset = Vector(wrist_offset)
        shoulder_world = stance_matrix(index) @ shoulder
        if pole is None:
            pole = geo.PREFERRED_POLE[geo.LEFT_HAND[index]]
        pole_world = arm_world_pole(shoulder_world, pole)
        place_arm(rig, side, shoulder, to_armature(index, wrist_world+offset), to_armature(index, tip_world+offset),
                  to_armature(index, pole_world))
        plans[side] = geo.LEFT_HAND[index]
    rig['book_visible'] = 0.
    rig['eyes_closed'] = 0.
    bpy.context.view_layer.update()
    return plans


AXES = tuple(Vector(v) for v in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)))


def parity_inside(point, tree):
    """True when rays along all six axes cross the surface an odd number of times.

    Several body surfaces are open tubes (sleeves, forearms, trouser legs), so a
    nearest-surface normal can call a free point inside when its nearest
    surface is a tube's rim; ray parity on every axis cannot."""
    for direction in AXES:
        origin, hits = Vector(point), 0
        for _ in range(64):
            location = tree.ray_cast(origin, direction, 5)[0]
            if location is None:
                break
            hits += 1
            origin = location+direction*1e-5
        if hits % 2 == 0:
            return False
    return True


def _inside_candidates(points, tree, low, high):
    for point in points:
        if not all(low[i] <= point[i] <= high[i] for i in range(3)):
            continue
        closest, normal, _, distance = tree.find_nearest(point)
        if closest is not None and distance > 1e-6 and (point-closest).dot(normal) < -1e-6:
            yield point


def intersection(body, solid):
    """Surface crossing or containment between a body surface and a fixture solid, or None."""
    (a, a_tree), (b, b_tree) = body, solid
    (a_low, a_high), (b_low, b_high) = bounds(body), bounds(solid)
    if any(a_high[i] < b_low[i] or b_high[i] < a_low[i] for i in range(3)):
        return None
    crossings = a_tree.overlap(b_tree)
    if crossings:
        return {'kind': 'surface', 'triangle_pairs': len(crossings)}
    for point in _inside_candidates(a, b_tree, b_low, b_high):
        if parity_inside(point, b_tree):
            return {'kind': 'body_inside_solid', 'point': list(point)}
    for point in _inside_candidates(b, a_tree, a_low, a_high):
        if parity_inside(point, a_tree):
            return {'kind': 'solid_inside_body', 'point': list(point)}
    return None


def bone_length_errors(rig):
    return {b.name: abs((b.tail-b.head).length-rig.data.bones[b.name].length) for b in rig.pose.bones}


def joint_targets(rig):
    return {b.name: dict(head=list(b.head), tail=list(b.tail)) for b in rig.pose.bones}


def surfaces(collection, names=None):
    deps = bpy.context.evaluated_depsgraph_get()
    if len(_BOUNDS) > 4096:
        _BOUNDS.clear()
    return {obj.name: evaluated_surface(obj, deps) for obj in collection.all_objects
            if not obj.hide_render and obj.type in ('MESH', 'CURVE') and (names is None or obj.name in names)}


_BOUNDS = {}


def bounds(surface):
    key = id(surface[0])
    if key not in _BOUNDS:
        points = surface[0]
        _BOUNDS[key] = (surface[0], [min(p[i] for p in points) for i in range(3)],
                        [max(p[i] for p in points) for i in range(3)])
    return _BOUNDS[key][1:]


def minimum_gap(first, second, limit=.25):
    """Smallest vertex-to-surface distance in either direction, capped at `limit`."""
    (a_low, a_high), (b_low, b_high) = bounds(first), bounds(second)
    if any(a_high[i]+limit < b_low[i] or b_high[i]+limit < a_low[i] for i in range(3)):
        return limit
    best = limit
    for (points, _), (_, tree) in ((first, second), (second, first)):
        for point in points:
            found = tree.find_nearest(point, best)
            if found[0] is not None and found[3] < best:
                best = found[3]
    return best


def clearance(body, fixture, door_names):
    """Complete body clearance against every fixture solid at the current sample."""
    bodies = surfaces(body)
    if set(bodies) != body_inventory():
        raise ValueError('Fridge sample lost an approved visible body surface')
    solids = surfaces(fixture)
    collisions, gaps = [], {}
    for body_name, body_surface in sorted(bodies.items()):
        for solid_name, solid_surface in sorted(solids.items()):
            hit = intersection(body_surface, solid_surface)
            if hit:
                collisions.append(dict(body=body_name, solid=solid_name, **hit))
            gap = minimum_gap(body_surface, solid_surface)
            if gap < .25:
                gaps[f'{body_name}|{solid_name}'] = gap
    door_gap = min([g for k, g in gaps.items() if k.split('|')[1] in door_names] or [.25])
    case_gap = min([g for k, g in gaps.items() if k.split('|')[1] not in door_names] or [.25])
    return dict(body_inventory=sorted(bodies), fixture_solids=sorted(solids),
                complete_body_solid_pairs=len(bodies)*len(solids), collisions=collisions,
                minimum_gap=min([door_gap, case_gap]), minimum_door_gap=door_gap, minimum_case_gap=case_gap,
                near_pairs={k: g for k, g in sorted(gaps.items()) if g < .05})


def palm_inside_cabinet(body):
    """Left palm centroid behind the case front, between the walls, shelf and divider."""
    deps = bpy.context.evaluated_depsgraph_get()
    obj = body.all_objects['Relaxed palm']
    points, _ = evaluated_surface(obj, deps)
    centroid = sum(points, Vector())/len(points)
    cabinet = geo.CABINET
    inside = (cabinet['x'][0] < centroid.x < cabinet['x'][1] and centroid.y > cabinet['y_front']
              and cabinet['z'][0] < centroid.z < cabinet['z'][1])
    return dict(centroid=list(centroid), deepest_y=max(p.y for p in points), inside=inside)


def sweep(body, fixture, rig, first, arms, step=2.5):
    """Door and body moving together between two consecutive samples.

    The door turns linearly between the two samples' angles while the feet
    move linearly between their stances; the pose of the nearer sample rides
    on the moving stance. The door-hand arm is excluded because it touches
    the door by design. Returns the collisions and the smallest gap."""
    door = bpy.data.objects[DOOR_HINGE]
    second = first+1
    start, end = geo.DOOR_DEGREES[first], geo.DOOR_DEGREES[second]
    names = body_inventory() - set(LEFT_ARM)
    door_names = set(door_parts())
    hits, closest = [], .25
    (ax, ay), (bx, by) = geo.stance(first), geo.stance(second)
    try:
        moving = max(abs(end-start), 100*math.hypot(bx-ax, by-ay))
        count = max(2, int(math.ceil(moving/step)))
        for k in range(count+1):
            t = k/count
            angle = start+(end-start)*t
            apply_sample(rig, first if t < .5 else second, *arms[first if t < .5 else second])
            rig.location = (ax+(bx-ax)*t, ay+(by-ay)*t, 0)
            door.rotation_euler.z = math.radians(angle)
            bpy.context.view_layer.update()
            bodies = surfaces(body, names)
            solids = surfaces(fixture, door_names)
            for body_name, body_surface in bodies.items():
                for solid_name, solid_surface in solids.items():
                    hit = intersection(body_surface, solid_surface)
                    if hit:
                        hits.append(dict(t=t, angle=angle, body=body_name, solid=solid_name, kind=hit['kind']))
                    closest = min(closest, minimum_gap(body_surface, solid_surface))
    finally:
        apply_sample(rig, first, *arms[first])
    return dict(first=first, start=start, end=end, step=step, checked_body=sorted(names),
                door_parts=sorted(door_names), collisions=hits, minimum_gap=closest)


def hand_gap(body, fixture):
    """Smallest gap between the left hand and the fixture, and whether they intersect."""
    hand = surfaces(body, {'Relaxed palm', 'Resting thumb', 'Forearm with elbow and wrist sections', 'Turned sleeve cuff'})
    solids = surfaces(fixture)
    gap, hit = .25, False
    for a in hand.values():
        for b in solids.values():
            hit = hit or bool(intersection(a, b))
            gap = min(gap, minimum_gap(a, b))
    return (0. if hit else gap), hit


def settle(rig, body, fixture, index, step=.004, limit=30):
    """Move the left hand along its freeing direction until it clears the fixture by HAND_GAP.

    The search only ever moves the hand away from the surface it rests on, so a
    hand that already clears keeps its authored target."""
    targets = left_targets(index, rig)
    if targets is None:
        return [0., 0., 0.], None, None
    free = targets[2]
    preferred = geo.PREFERRED_POLE[geo.LEFT_HAND[index]]
    order = [preferred] + [k for k in range(len(geo.ELBOW_POLES)) if k != preferred]
    for pole in order:
        for count in range(limit+1):
            offset = free*step*count
            try:
                apply_sample(rig, index, offset, pole)
            except ValueError:
                break
            gap, hit = hand_gap(body, fixture)
            if not hit and gap >= HAND_GAP:
                return list(offset), pole, gap
    hand = surfaces(body, {'Relaxed palm', 'Resting thumb', 'Forearm with elbow and wrist sections', 'Turned sleeve cuff'})
    solids = surfaces(fixture)
    found = [(a, b, intersection(hand[a], solids[b])) for a in hand for b in solids]
    raise ValueError(f'Left hand of sample {index} cannot clear the fixture: '
                     + repr([(a, b, h['kind']) for a, b, h in found if h]) + f' gap {gap}')


def body_extent(body):
    """World bounds of every visible body vertex, as [min x, min y, max x, max y]."""
    points = [p for points, _ in surfaces(body).values() for p in points]
    return [min(p.x for p in points), min(p.y for p in points), max(p.x for p in points), max(p.y for p in points)]
