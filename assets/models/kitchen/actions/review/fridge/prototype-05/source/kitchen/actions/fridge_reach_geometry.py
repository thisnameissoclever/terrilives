"""Pure schedule and stance geometry for the fridge open-and-reach scene.

Coordinates are the accepted refrigerator scene's world metres with the fixture
unrotated (the SW render facing): the case is centred on the origin, its front
faces -Y and the refrigerator door hangs from a hinge on the +X side. The
accepted model root carries a uniform scale of 1.2, so every authored model
dimension is multiplied by that scale here.

The body stays inside the column of the tile in front of the door
(|x| <= 0.5): fridges are usually placed against walls or beside counters, so
nothing may be drawn on the tiles to either side. The door's free corner
sweeps a 0.84-metre circle that covers most of that tile, so the Sim steps:
it pulls the door from the front of the tile, steps back out of the swing as
the door opens, steps in to reach while the door stands open, and steps back
again before the door swings shut.
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
DOOR_DEGREES = (0, 20, 55, 80, 80, 80, 80, 0)
REACH_SAMPLES = (4, 5)
# Feet centre of each sample, by name. FRONT pulls the handle, BACK stands
# outside the door's swing, REACH stands close enough to reach inside.
STANCES = dict(FRONT=(-.03, -1.05), BACK=(-.03, -1.50), REACH=(-.03, -.97))
STANCE_BY_SAMPLE = ('FRONT', 'FRONT', 'BACK', 'BACK', 'REACH', 'REACH', 'BACK', 'BACK')
YAW_DEGREES = 0.0
# The right hand pulls the handle from the front; the left hand takes the
# handle as the Sim steps back, lets go once the door is open, reaches into
# the cabinet, and takes the door's free edge to swing it shut.
LEFT_HAND = ('rest', 'rest', 'handle', 'rest', 'reach', 'reach', 'door_edge', 'rest')
RIGHT_HAND = ('rest', 'handle', 'rest', 'rest', 'rest', 'rest', 'rest', 'rest')
# Forward bend at the hips and shoulder twist, in degrees.
LEAN_DEGREES = (0, 1, 0, 0, 8, 9, 0, 0)
TWIST_DEGREES = (0, 2, 2, 0, 4, 5, 2, 0)

# Reach targets for the left wrist and the hand's pointing end. All lie
# behind the case front (y = -0.474), between the side walls (|x| < 0.396),
# above the top fridge shelf lip (z > 1.004) and below the compartment
# divider (z < 1.374).
REACH = {
    4: dict(wrist=(.06, -.46, 1.19), tip=(.06, -.35, 1.17)),
    5: dict(wrist=(.05, -.43, 1.18), tip=(.05, -.32, 1.16)),
}
# The body (shoulders, hanging hands and hair) must stay on the front tile's
# floor, clear of a wall on either side edge of the tile: walls are 0.14 thick
# and centred on the tile edge, so their faces stand 0.43 from the tile centre.
TILE_HALF_WIDTH = .5
WALL_FACE = .5-.14/2
WALL_CLEARANCE = .02
BODY_HALF_WIDTH = .375
# Logical pixels added to the accepted 96 by 120 canvas as (left, top, right,
# bottom). The Sim stands on the neighbouring tile and the open door reaches
# into it, so the scene needs room outside the fixture's own canvas; the
# fixture keeps its pixels and lands exactly this far from the new corner.
PADDING = (26, 21, 26, 22)
ELBOW_POLES = ((.45, -.20, -.30), (.10, .15, -.50), (0., -.10, -.50), (-.15, .10, -.45),
               (.45, -.05, -.35))
# The door-edge grip keeps its elbow low and forward so the forearm runs to
# the edge in view instead of folding back behind the upper arm.
PREFERRED_POLE = dict(handle=0, door_edge=3, reach=4)
CABINET = dict(x=(-.396, .396), y_front=-.474, z=(1.004, 1.374))


def door_point(point, degrees):
    """World XY of a door point given relative to the hinge, at a hinge angle."""
    angle = math.radians(degrees)
    c, s = math.cos(angle), math.sin(angle)
    x, y = point
    return HINGE[0] + c*x - s*y, HINGE[1] + s*x + c*y


def sweep_radius():
    return math.hypot(*DOOR_TIP)


def stance(index):
    """Feet centre of a sample."""
    return STANCES[STANCE_BY_SAMPLE[index]]


def stance_frame(index=0):
    """Feet centre, facing and left vectors of the standing Sim at a sample."""
    yaw = math.radians(YAW_DEGREES)
    facing = (math.sin(yaw), math.cos(yaw))
    left = (facing[1], -facing[0])
    return stance(index), facing, left


def rig_rotation_degrees():
    """Object rotation of the rig, whose rest pose faces -Y, so it faces the fridge."""
    return 180.0 - YAW_DEGREES


def sample_for_progress(progress, samples=SAMPLES, reduced_motion=False):
    """Progress-driven sample index, mirrored by the web renderer.

    Progress runs 0 to 1000 over the step. Reduced motion holds the rest
    sample, so the door never swings for a player who asked for less motion."""
    if type(progress) is not int or type(samples) is not int or samples <= 0:
        raise ValueError('Progress and sample count must be integers')
    if reduced_motion:
        return 0
    progress = max(0, min(1000, progress))
    return min(samples-1, progress*samples//1000)


def validate_schedule():
    rows = (DOOR_DEGREES, LEFT_HAND, RIGHT_HAND, LEAN_DEGREES, TWIST_DEGREES, STANCE_BY_SAMPLE)
    if any(len(row) != SAMPLES for row in rows):
        raise ValueError('Every fridge reach schedule needs one entry per sample')
    if DOOR_DEGREES[0] != 0 or DOOR_DEGREES[-1] != 0 or any(not 0 <= a <= 80 for a in DOOR_DEGREES):
        raise ValueError('The door must start and end closed and never pass 80 degrees')
    if any(DOOR_DEGREES[i] != 80 or LEFT_HAND[i] != 'reach' for i in REACH_SAMPLES):
        raise ValueError('The reach samples must hold the door fully open')
    if any(LEFT_HAND[i] == 'reach' for i in range(SAMPLES) if i not in REACH_SAMPLES):
        raise ValueError('Only the open-door samples reach into the cabinet')
    if any(name not in STANCES for name in STANCE_BY_SAMPLE):
        raise ValueError('Unknown stance')
    for x, _ in STANCES.values():
        if abs(x)+BODY_HALF_WIDTH > WALL_FACE-WALL_CLEARANCE+1e-9:
            raise ValueError('A stance puts the body into a wall beside the front tile')
    if any(RIGHT_HAND[i] not in ('rest', 'handle') for i in range(SAMPLES)):
        raise ValueError('The right hand only rests or pulls the handle')
    for index in range(SAMPLES-1):
        moving_door = DOOR_DEGREES[index] != DOOR_DEGREES[index+1]
        if moving_door and STANCE_BY_SAMPLE[index] == 'REACH' or moving_door and STANCE_BY_SAMPLE[index+1] == 'REACH':
            raise ValueError('The Sim may not stand at the reach stance while the door moves')
    for index in REACH_SAMPLES:
        for point in REACH[index].values():
            x, y, z = point
            if not (CABINET['x'][0] < x < CABINET['x'][1] and y > CABINET['y_front']
                    and CABINET['z'][0] < z < CABINET['z'][1]):
                raise ValueError('Reach target lies outside the cabinet opening')
    return True
