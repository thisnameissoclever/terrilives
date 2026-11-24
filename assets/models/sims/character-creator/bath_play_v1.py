"""Author a shared floating, nudging and lifting track in the unchanged bath frame."""
from pathlib import Path
import hashlib
import json
import math
import sys
import bpy
from mathutils import Matrix, Quaternion, Vector

BASE = Path(__file__).resolve().parent
MODELS = BASE.parents[1]
SAMPLES = 24
ASSEMBLY = 'Bath play toy'
GRIP = (-.035, -.015, -.020)
FLOAT = (-.04, -.40, .54)
WATER_Z = .52
TOYS = ('duck', 'boat', 'submarine')


def smooth(value):
    value = max(0., min(1., value))
    return value*value*(3.-2.*value)


def track(phase):
    phase %= 1.
    contact = smooth((phase-3/24)/(2/24))*(1-smooth((phase-18/24)/(2/24)))
    lift = smooth((phase-9/24)/(3/24))*(1-smooth((phase-15/24)/(3/24)))
    nudge = .04*math.sin(math.pi*max(0., min(1., (phase-5/24)/(4/24)))) if 5/24 <= phase <= 9/24 else 0.
    position = (FLOAT[0], FLOAT[1]+nudge+.012*lift*math.sin(math.tau*phase), FLOAT[2]+.12*lift)
    return dict(position=position, tilt=.10*lift*math.sin(math.tau*phase), contact=contact,
                reach=smooth(phase/(3/24))*(1-smooth((phase-20/24)/(4/24))))


def material(name, colour):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*colour, 1.)
    return result


def ellipsoid(name, point, radius, colour):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=point)
    obj = bpy.context.object
    obj.name = name
    obj.scale = radius
    obj.data.materials.append(colour)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def box(name, point, dimensions, colour):
    bpy.ops.mesh.primitive_cube_add(size=1., location=point)
    obj = bpy.context.object
    obj.name = name
    obj.scale = dimensions
    obj.data.materials.append(colour)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bevel = obj.modifiers.new('Rounded toy edges', 'BEVEL')
    bevel.width = .005
    bevel.segments = 2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def joined(name, pieces, root):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj['creator_owner'] = 'actor'
    obj['bath_toy'] = name.rsplit(' ', 1)[1]
    # All variants occupy the same authored assembly envelope and share its grip.
    obj['bath_envelope'] = json.dumps([[-.07, -.09, -.02], [.07, .09, .09]])
    return obj


def author_toys(rig):
    root = bpy.data.objects.new(ASSEMBLY, None)
    bpy.context.collection.objects.link(root)
    root.parent = rig
    root.matrix_parent_inverse = Matrix.Identity(4)
    root['creator_owner'] = 'actor'
    yellow = material('Bath toy yellow', (1., .72, .055))
    orange = material('Bath toy orange', (1., .29, .035))
    navy = material('Bath toy navy', (.035, .12, .23))
    cream = material('Bath toy cream', (.94, .90, .70))
    blue = material('Bath toy blue', (.12, .52, .78))
    red = material('Bath toy red', (.82, .12, .10))
    duck = joined('Bath play duck', [
        box('Duck flat underside', (0., 0., -.015), (.11, .06, .01), yellow),
        ellipsoid('Duck body', (0., -.005, .012), (.064, .077, .032), yellow),
        ellipsoid('Duck head', (0., .038, .058), (.031, .031, .031), yellow),
        ellipsoid('Duck bill', (0., .073, .052), (.025, .017, .009), orange),
        ellipsoid('Duck left eye', (-.025, .054, .067), (.004, .004, .004), navy),
        ellipsoid('Duck right eye', (.025, .054, .067), (.004, .004, .004), navy),
        ellipsoid('Duck tail', (0., -.069, .030), (.022, .021, .020), yellow),
    ], root)
    boat = joined('Bath play boat', [
        box('Boat flat underside', (0., 0., -.015), (.11, .06, .01), red),
        ellipsoid('Boat hull', (0., 0., .004), (.07, .09, .024), red),
        box('Boat deck', (0., 0., .025), (.115, .14, .014), cream),
        box('Boat cabin', (0., -.006, .053), (.065, .07, .044), blue),
        box('Boat roof', (0., -.006, .079), (.079, .084, .015), cream),
    ], root)
    submarine = joined('Bath play submarine', [
        box('Submarine flat keel', (0., 0., -.015), (.11, .06, .01), yellow),
        ellipsoid('Submarine hull', (0., 0., .012), (.062, .09, .032), yellow),
        box('Submarine tower', (0., -.01, .052), (.046, .045, .035), orange),
        box('Submarine periscope', (0., -.01, .076), (.012, .014, .028), navy),
        ellipsoid('Submarine port left', (-.059, .025, .018), (.007, .014, .012), blue),
        ellipsoid('Submarine port right', (.059, .025, .018), (.007, .014, .012), blue),
        box('Submarine tail fins', (0., -.069, .012), (.14, .025, .012), orange),
    ], root)
    return root, [duck, boat, submarine]


def open_source():
    library = json.loads((BASE/'clips/clips.json').read_text())
    record = library['sources']['bath']
    source = MODELS/record['path']
    expected = record['sha256']
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
        raise ValueError('Historical bath source changed')
    bpy.ops.wm.open_mainfile(filepath=str(source), load_ui=False, use_scripts=False)
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    fixture = bpy.data.objects['BATHTUB_MODEL_ROOT']
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    fixture_frame = Matrix.LocRotScale(fixture.matrix_world.translation, fixture.matrix_world.to_quaternion(), None)
    relative = fixture_frame.inverted() @ rig.matrix_world
    if max(abs(relative[row][col]-Matrix.Identity(4)[row][col]) for row in range(4) for col in range(4)) > 1e-7:
        raise ValueError('Bath source rig is not in its recorded fixture frame')
    baseline = {bone.name: bone.matrix_basis.copy() for bone in rig.pose.bones}
    worlds = {bone.name: bone.matrix.copy() for bone in rig.pose.bones}
    rig.animation_data.action = None
    root, toys = author_toys(rig)
    sys.path.insert(0, str(MODELS/'bathroom/actions'))
    from bath_pose_geometry import two_link
    rest = rig.data.bones
    palm = rest['hand.R'].matrix_local.inverted() @ Vector(library['clips']['bath']['contacts']['landmarks']['palmR']['point'])
    orientation = worlds['hand.R'].to_3x3().to_4x4()
    source_palm = worlds['hand.R'] @ palm

    def orient(name, head, tail):
        reference = worlds[name].to_quaternion()
        original = reference @ Vector((0., 1., 0.))
        rotation = original.rotation_difference((tail-head).normalized()) @ reference
        rig.pose.bones[name].matrix = Matrix.Translation(head) @ rotation.to_matrix().to_4x4()
        bpy.context.view_layer.update()

    def sample(index, action=None):
        for name, value in baseline.items():
            rig.pose.bones[name].matrix_basis = value
        bpy.context.view_layer.update()
        motion = track(index/SAMPLES)
        root.matrix_basis = Matrix.Translation(motion['position']) @ Matrix.Rotation(motion['tilt'], 4, 'Y')
        bpy.context.view_layer.update()
        target = rig.matrix_world.inverted() @ root.matrix_world @ Vector(GRIP)
        grip = source_palm.lerp(target, motion['reach'])
        wrist = grip-orientation.to_3x3() @ palm
        shoulder = worlds['upper_arm.R'].translation
        upper = rest['upper_arm.R'].length
        lower = rest['forearm.R'].length
        pole = shoulder+Vector((-.15, .20, -.12))
        elbow = Vector(two_link(shoulder, wrist, upper, lower, pole))
        orient('upper_arm.R', shoulder, elbow)
        orient('forearm.R', elbow, wrist)
        rig.pose.bones['hand.R'].matrix = Matrix.Translation(wrist) @ orientation
        # A small following nod accompanies the toy without moving the torso or legs.
        head = worlds['head']
        turn = Matrix.Rotation(.025*motion['reach']*math.sin(math.tau*index/SAMPLES), 4, 'X')
        rig.pose.bones['head'].matrix = Matrix.Translation(head.translation) @ turn @ head.to_3x3().to_4x4()
        bpy.context.view_layer.update()
        return motion

    return source, expected, rig, fixture, root, toys, sample
