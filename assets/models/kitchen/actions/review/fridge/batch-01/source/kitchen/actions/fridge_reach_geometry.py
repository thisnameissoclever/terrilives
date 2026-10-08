"""Pure schedule and stance geometry for the fridge open-and-reach scene.

Coordinates are the accepted refrigerator scene's world metres with the fixture
unrotated (the SW render facing): the case is centred on the origin, its front
faces -Y and the refrigerator door hangs from a hinge on the +X side. The
accepted model root carries a uniform scale of 1.2, so every authored model
dimension is multiplied by that scale here.
"""
import math

MODEL_SCALE = 1.2
# fridge_geometry.HINGE scaled by the accepted root.
HINGE = (.35*MODEL_SCALE, -.396*MODEL_SCALE)
# Outer corner of the refrigerator door relative to its hinge in model units,
# scaled: the door is .70 wide and its outer face sits .064 in front of the hinge.
DOOR_TIP = (-.70*MODEL_SCALE, -.064*MODEL_SCALE)
DOOR_INNER_TIP = (-.70*MODEL_SCALE, -.004*MODEL_SCALE)
DOOR_TOP_Z = (.652+1.016/2)*MODEL_SCALE
HANDLE = ((-.245-.35)*MODEL_SCALE, (-.491+.396)*MODEL_SCALE)

SAMPLES = 8
DOOR_DEGREES = (0, 20, 55, 80, 80, 80, 45, 0)
REACH_SAMPLES = (3, 4, 5)
# The left hand pulls the handle while the Sim is still on the door's outer
# side, then rests on the inner face beside the free edge once the door has
# swung past the shoulder, reaches into the cabinet while the door stands
# open, and draws the door shut by the same edge.
LEFT_HAND = ('rest', 'handle', 'door_inner', 'reach', 'reach', 'reach', 'door_inner', 'rest')
# Forward bend at the hips, in degrees, and the twist that brings the left
# shoulder toward the cabinet.
LEAN_DEGREES = (0, 1, 2, 22, 24, 21, 2, 0)
TWIST_DEGREES = (0, 3, 5, 22, 24, 21, 5, 0)

# Feet centre and body yaw. The Sim faces the fridge from the handle side of
# the front tile, far enough from the hinge that the swinging door clears the
# chest and shoulders; it bends at the hips and turns its shoulders to reach.
STANCE = dict(x=-.55, y=-1.03, yaw_degrees=0.0)

# Reach targets for the left wrist and the hand's pointing end, by reach
# sample. All lie behind the case front (y = -0.474), between the side
# walls (|x| < 0.396), above the top fridge shelf lip (z > 1.004) and below
# the compartment divider (z < 1.374).
REACH = {
    3: dict(wrist=(-.19, -.46, 1.19), tip=(-.17, -.35, 1.17)),
    4: dict(wrist=(-.17, -.43, 1.18), tip=(-.15, -.32, 1.16)),
    5: dict(wrist=(-.19, -.47, 1.18), tip=(-.17, -.36, 1.15)),
}
# Candidate elbow directions for the left arm, as (left, forward, up) offsets
# in metres from the shoulder. The posing search tries them in order and
# keeps the first whose hand and forearm clear the fixture.
ELBOW_POLES = ((.45, -.20, -.30), (.10, .15, -.50), (0., -.10, -.50), (-.15, .10, -.45),
               (.45, -.05, -.35))
PREFERRED_POLE = dict(handle=0, door_inner=1, reach=4)

# Logical pixels added to the accepted 96 by 120 canvas as (left, top, right,
# bottom). The Sim stands on the neighbouring tile and the open door reaches
# into it, so the scene needs room outside the fixture's own canvas; the
# fixture keeps its pixels and lands exactly this far from the new corner.
PADDING = (30, 20, 30, 26)
CABINET = dict(x=(-.396, .396), y_front=-.474, z=(1.004, 1.374))


def door_point(point, degrees):
    """World XY of a door point given relative to the hinge, at a hinge angle."""
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    x, y = point
    return HINGE[0] + c*x - s*y, HINGE[1] + s*x + c*y


def sweep_radius():
    return math.hypot(*DOOR_TIP)


def stance_frame():
    """Feet centre, facing and left vectors of the standing Sim."""
    yaw = math.radians(STANCE['yaw_degrees'])
    facing = (math.sin(yaw), math.cos(yaw))
    left = (facing[1], -facing[0])
    return (STANCE['x'], STANCE['y']), facing, left


def rig_rotation_degrees():
    """Object rotation of the rig, whose rest pose faces -Y, so it faces the stance."""
    return 180.0 - STANCE['yaw_degrees']


def sample_for_progress(progress, samples=SAMPLES, reduced_motion=False):
    """Progress-driven sample index, mirrored by the web renderer.

    Progress runs 0 to 1000 over the step. Reduced motion holds the closed rest
    sample, so the door never swings for a player who asked for less motion."""
    if type(progress) is not int or type(samples) is not int or samples <= 0:
        raise ValueError('Progress and sample count must be integers')
    if reduced_motion:
        return 0
    progress = max(0, min(1000, progress))
    return min(samples-1, progress*samples//1000)


def validate_schedule():
    if not (len(DOOR_DEGREES) == len(LEFT_HAND) == len(LEAN_DEGREES) == len(TWIST_DEGREES) == SAMPLES):
        raise ValueError('Every fridge reach schedule needs one entry per sample')
    if DOOR_DEGREES[0] != 0 or DOOR_DEGREES[-1] != 0 or any(not 0 <= a <= 80 for a in DOOR_DEGREES):
        raise ValueError('The door must start and end closed and never pass 80 degrees')
    if any(DOOR_DEGREES[i] != 80 or LEFT_HAND[i] != 'reach' for i in REACH_SAMPLES):
        raise ValueError('The reach samples must hold the door fully open')
    if any(LEFT_HAND[i] == 'reach' for i in range(SAMPLES) if i not in REACH_SAMPLES):
        raise ValueError('Only the open-door samples reach into the cabinet')
    for index in REACH_SAMPLES:
        for point in REACH[index].values():
            x, y, z = point
            if not (CABINET['x'][0] < x < CABINET['x'][1] and y > CABINET['y_front']
                    and CABINET['z'][0] < z < CABINET['z'][1]):
                raise ValueError('Reach target lies outside the cabinet opening')
    return True
