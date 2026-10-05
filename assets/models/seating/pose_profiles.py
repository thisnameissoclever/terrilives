"""Measured neutral profiles on immutable furniture and the approved skeleton."""
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'sims/sim-01'))
from rig_math import knee_point

PROFILES = {
    'armchair': dict(content='armchair',source='living/owner-review-pending/armchair/candidate-03/armchair-authoring.blend',
        seat='Seat cushion',hip_y=-.06,z_offset=-.33,ankle_y=-.355,foot_pitch=0.,body_turn=-90,canvas=[96,120]),
    'dining': dict(content='chair',source='dining/owner-review-pending/dining-chair/candidate-01/dining-chair-authoring.blend',
        seat='Seat',hip_y=-.28,z_offset=-.1988,ankle_y=-.575,foot_pitch=0.,body_turn=-90,canvas=[96,120]),
    'office': dict(content='desk_chair',source='office/owner-review-pending/office-chair/candidate-03/office-chair-authoring.blend',
        seat='Seat cushion',hip_y=-.295,z_offset=-.1663,ankle_y=None,foot_pitch=8.2023,body_turn=-90,canvas=[96,120]),
    'sofa': dict(content='long_sofa',source='living/owner-review-pending/long-sofa/candidate-01/long-sofa-authoring.blend',
        seat='Seat cushion 1',hip_y=-.36,z_offset=-.1738,ankle_y=None,foot_pitch=8.2023,body_turn=-90,canvas=[160,176]),
    'ottoman': dict(content='sofa',source='living/owner-review-pending/ottoman/candidate-01/ottoman-authoring.blend',
        seat='Cushion',hip_y=-.20,z_offset=-.3488,ankle_y=-.57,foot_pitch=0.,body_turn=-90,canvas=[96,120]),
    'reading': dict(content='reading_chair',source='furniture/review/candidate-02/chair-authoring.blend',
        seat='Chair seat cushion',hip_y=-.22,z_offset=-.2638,ankle_y=-.46,foot_pitch=0.,body_turn=0,canvas=[96,120]),
}


def leg_targets(kind, upper, lower):
    if any(not math.isfinite(value) or value<=0 for value in (upper,lower)):
        raise ValueError('Leg lengths must be positive and finite')
    profile = PROFILES[kind]
    hip = (profile['hip_y'],.86+profile['z_offset'])
    if profile['ankle_y'] is None:
        ankle_z = .15
        knee_z = ankle_z+lower-.001
        thigh_y = upper*upper-(hip[1]-knee_z)**2
        shin_y = lower*lower-(knee_z-ankle_z)**2
        if thigh_y<=0 or shin_y<0:
            raise ValueError('Seat profile is unreachable with these leg lengths')
        knee = (hip[0]-math.sqrt(thigh_y),knee_z)
        ankle = (knee[0]+math.sqrt(shin_y),ankle_z)
    else:
        ankle = (profile['ankle_y'],.13)
        knee = knee_point(hip,ankle,upper,lower)
    return dict(hip=hip,knee=knee,ankle=ankle)
