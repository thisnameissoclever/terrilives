"""Draft climbing key with independently authored pelvis, trunk, head and limb curves."""
import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix
import pool_activity_pose_v1 as reference
from pool_activity_sample_v2 import sample_reference, normalize_pelvis_placement, capture_channels, realize_neutral_channels, blend_channels, restore_channels

BASE = Path(__file__).resolve().parent
AUTHORING = json.loads((BASE / 'pool_activity_motion_v2.json').read_text())
ENTRY_SAMPLES = reference.ENTRY_SAMPLES
PADDLE_SAMPLES = reference.PADDLE_SAMPLES
EXIT_SAMPLES = reference.EXIT_SAMPLES

if hashlib.sha256((BASE / AUTHORING['referenceMotion']).read_bytes()).hexdigest() != AUTHORING['referenceMotionSha256']:
    raise ValueError('The draft pool source requires its unchanged reference producer')


def curve_weight(curve, phase):
    if not math.isfinite(phase) or not 0 <= phase <= 1:
        raise ValueError('Pool authoring phase must lie in its finite interval')
    if phase <= curve[0]['phase'] or phase >= curve[-1]['phase']:
        return 0.
    for left, right in zip(curve, curve[1:]):
        if phase <= right['phase']:
            amount = (phase - left['phase']) / (right['phase'] - left['phase'])
            smooth = amount * amount * (3 - 2 * amount)
            return left['weight'] + (right['weight'] - left['weight']) * smooth
    raise ValueError('Pool authoring curve has no enclosing keys')


def column_matrix(values):
    return Matrix([[values[column * 4 + row] for column in range(4)] for row in range(4)])


def apply(rig, phase, paddle=0., evidence=None):
    contacts = sample_reference(rig, phase, paddle)
    weights = {group: curve_weight(AUTHORING['curves'][group], phase) for group in AUTHORING['groups']}
    if not any(weights.values()):
        return contacts
    normalize_pelvis_placement(rig)
    inherited = capture_channels(rig)
    target = realize_neutral_channels(rig, AUTHORING['neutralKey']['basis'])
    for group, names in AUTHORING['groups'].items():
        weight = weights[group]
        if weight == 0:
            continue
        for name in names:
            bone = rig.pose.bones[name]
            restore_channels(bone, blend_channels(inherited[name], target[name], weight))
    bpy.context.view_layer.update()
    if evidence is not None:
        evidence.update({'phase': phase, 'weights': weights, 'inheritedChannels': inherited, 'realizedNeutralChannels': target, 'actualChannels': capture_channels(rig)})
    return contacts


def sample(rig, name, index, evidence=None):
    if name == 'pool_enter':
        return apply(rig, index / (ENTRY_SAMPLES - 1), evidence=evidence)
    if name == 'pool_paddle':
        return apply(rig, 1., index / PADDLE_SAMPLES, evidence)
    origin = int(name.rsplit('_', 1)[1]) / PADDLE_SAMPLES
    phase = index / (EXIT_SAMPLES - 1)
    if phase < .1:
        return apply(rig, 1., origin if phase == 0 else (origin if origin <= .5 else origin - 1) * (1 - phase / .1), evidence)
    return apply(rig, 1 - (phase - .1) / .9, evidence=evidence)
