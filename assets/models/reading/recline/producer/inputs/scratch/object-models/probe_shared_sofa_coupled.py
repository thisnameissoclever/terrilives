"""Bounded geometry study; candidates remain unapproved and sources stay immutable."""
import hashlib
import itertools
import json
import math
import os
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import probe_shared_sofa_tucked as probe

PARAMETERS = None


class UnreachablePose(ValueError):
    """An authored candidate has no geometric elbow solution."""


def elbow_at_x(shoulder, wrist, upper, lower, x):
    """Intersect the two reach spheres with an authored elbow X plane."""
    upper_squared = upper * upper - (x - shoulder.x) ** 2
    lower_squared = lower * lower - (x - wrist.x) ** 2
    if upper_squared <= 0 or lower_squared <= 0:
        raise UnreachablePose('Elbow plane misses a reach sphere')
    delta = Vector((wrist.y - shoulder.y, wrist.z - shoulder.z))
    distance = delta.length
    upper_radius, lower_radius = math.sqrt(upper_squared), math.sqrt(lower_squared)
    if not abs(upper_radius - lower_radius) < distance < upper_radius + lower_radius:
        raise UnreachablePose('Elbow circles do not intersect')
    axis = delta / distance
    along = (upper_squared - lower_squared + distance * distance) / (2 * distance)
    height_squared = upper_squared - along * along
    if height_squared <= 0:
        raise UnreachablePose('Elbow circle has no separated roots')
    centre = Vector((shoulder.y, shoulder.z)) + axis * along
    normal = Vector((-axis.y, axis.x))
    roots = [centre + sign * math.sqrt(height_squared) * normal for sign in (-1, 1)]
    forward = min(roots, key=lambda value: value.x)
    return Vector((x, forward.x, forward.y))


def coupled_arms(rig):
    yaw, reach, elbow_x = PARAMETERS
    reading = rig['book_visible'] > .5
    delta = Vector((0, -reach, -.09))
    names = ['spine', 'head', 'book'] + [
        part + '.' + side for side in ('L', 'R')
        for part in ('upper_arm', 'forearm', 'hand')]
    # Capture global armature-space frames before editing their parents.
    original = {name: rig.pose.bones[name].matrix.copy() for name in names}
    spine_origin = rig.pose.bones['spine'].head.copy()
    for side, sign in (('L', -1), ('R', 1)):
        shoulder = rig.pose.bones['upper_arm.' + side].head.copy()
        hand = original['hand.' + side].copy()
        wrist = hand.translation + delta if reading else Vector((sign * .17, -.50 - reach, .76))
        elbow = elbow_at_x(shoulder, wrist,
                          rig.data.bones['upper_arm.' + side].length,
                          rig.data.bones['forearm.' + side].length, sign * elbow_x)
        probe.direct_bone(rig, 'upper_arm.' + side, shoulder, elbow)
        probe.direct_bone(rig, 'forearm.' + side, elbow, wrist)
        hand.translation = wrist
        rig.pose.bones['hand.' + side].matrix = hand
        bpy.context.view_layer.update()
    if reading:
        book = original['book'].copy()
        book.translation += delta
        rig.pose.bones['book'].matrix = book
        bpy.context.view_layer.update()
    frames = {name: rig.pose.bones[name].matrix.copy() for name in names}
    rotation = Matrix.Rotation(math.radians(yaw), 4, 'Z')
    transform = Matrix.Translation(spine_origin) @ rotation @ Matrix.Translation(-spine_origin)
    # Full frames preserve shaft rotation, which head/tail coordinates cannot encode.
    for name in names:
        rig.pose.bones[name].matrix = transform @ frames[name]
        bpy.context.view_layer.update()
    for name in names:
        bone = rig.pose.bones[name]
        target = transform @ frames[name]
        actual = bone.matrix
        error = max(abs(actual[row][column] - target[row][column])
                    for row in range(4) for column in range(4))
        if error > .00001:
            raise ValueError(f'Pose frame mismatch for {name}: {error}')
        length_error = abs((bone.tail - bone.head).length - rig.data.bones[name].length)
        if length_error > .00001 or max(abs(scale - 1) for scale in bone.scale) > .00001:
            raise ValueError(f'Pose changed segment length or scale for {name}')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(directory):
    global PARAMETERS
    if not bpy.app.background or not directory.is_absolute():
        raise ValueError('Use background Blender and a new absolute output directory')
    directory.mkdir(parents=True, exist_ok=False)
    inputs = {str(Path(__file__)): digest(Path(__file__)),
              str(Path(probe.__file__)): digest(Path(probe.__file__))}
    receipt = directory / 'proof.json'
    report = dict(state='running', pid=os.getpid(), background=bpy.app.background,
                  blender_version=bpy.app.version_string, inputs=inputs,
                  scope='Diagnostic S/R/S mixed geometry at four phases; no visual acceptance',
                  candidates=[])

    def save():
        receipt.write_text(json.dumps(report, indent=2) + '\n')

    save()
    probe.tuck_arms = coupled_arms
    try:
        for index, values in enumerate(itertools.product((0, -15, -30), (.08, .12, .16), (.18, .20, .22))):
            PARAMETERS = values
            destination = directory / f'candidate-{index:02d}'
            record = dict(index=index, yaw=values[0], reach=values[1], elbow_x=values[2])
            try:
                probe.run(destination, False)
                result = json.loads((destination / 'proof.json').read_text())
                record['collision_counts'] = [len(phase['collisions']) for phase in result['contacts']]
                record['support_errors'] = [support['error'] for phase in result['contacts']
                                            for support in phase['support'] if 'error' in support]
                record['geometry_screen_passed'] = not any(record['collision_counts']) and not record['support_errors']
            except UnreachablePose as error:
                record['geometry_screen_passed'] = False
                record['error'] = str(error)
            report['candidates'].append(record)
            save()
        if any(digest(Path(path)) != sha for path, sha in inputs.items()):
            raise ValueError('A probe source changed while running')
        report['state'] = 'complete'
        report['survivors'] = [row['index'] for row in report['candidates'] if row['geometry_screen_passed']]
        report['remaining_proof'] = 'All action arrangements, complete self/contact/roll proof, palms and visual review'
    except BaseException as error:
        report['state'] = 'failed'
        report['error'] = repr(error)
        raise
    finally:
        save()


if __name__ == '__main__':
    arguments = sys.argv[sys.argv.index('--') + 1:]
    if len(arguments) != 1:
        raise ValueError('Pass one new absolute output directory')
    run(Path(arguments[0]))
