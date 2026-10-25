"""Realize sparse nominal program output as a focused source-preference experiment."""
import math

import bpy
from pool_activity_sample_v2 import capture_channels, realize_neutral_channels, restore_channels


def apply_nominal_source(rig, names, record):
    if record['phase'] not in (.325, .35, .375, .4) or not record['physicalKeyPassed']:
        raise ValueError('V4 focused authoring requires an accepted changed nominal key')
    basis = record['basis']
    if len(names) != len(basis) or len(names) != len(set(names)):
        raise ValueError('V4 nominal basis does not match its actual bone order')
    if len(record['program']['controls']) != 4:
        raise ValueError('V4 nominal intent must retain all four original limb controls')
    for name, matrix in zip(names, basis):
        if len(matrix) != 16 or any(not math.isfinite(value) for value in matrix):
            raise ValueError('V4 nominal source basis is not finite')
        if name != 'root' and matrix[12:15] != [0, 0, 0]:
            raise ValueError('V4 nominal source changes a child offset')
    inherited = capture_channels(rig)
    targets = realize_neutral_channels(rig, dict(zip(names, basis)))
    for name in names:
        if name != 'book':
            restore_channels(rig.pose.bones[name], targets[name])
    bpy.context.view_layer.update()
    if capture_channels(rig)['book'] != inherited['book']:
        raise ValueError('V4 focused source changed the inactive book channels')
    return {'phase': record['phase'], 'ownership': 'selected-active-nominal-key',
            'sourceRepresentation': 'evaluated nominal basis realized through existing Blender channels',
            'footConstructorInputProvenance': {'recipe': 'properPoolRotation(configuredRest[end])',
                                               'actualAcceptedRequestYaw': {'left': 0, 'right': 0},
                                               'completedFramesAreNotRawInputs': True},
            'preControlProgram': record['program'], 'literalGoals': record['contactGoals'],
            'inheritedChannels': inherited, 'realizedNominalChannels': targets,
            'actualChannels': capture_channels(rig)}
