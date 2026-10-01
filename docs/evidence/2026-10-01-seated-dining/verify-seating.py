"""Reject concrete seat penetration and missing solids in the accepted scene."""
import hashlib
import json
import sys
import traceback
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / 'assets/models/domestic'
sys.path.insert(0, str(BASE))
from dining_contact import measure
from render_dining import set_pose

output = Path(__file__).with_name('chair-contact-regressions.json')
report = dict(state='running', model_sha256=hashlib.sha256((BASE / 'seated-dining.blend').read_bytes()).hexdigest(), cases=[])


def scene():
    bpy.ops.wm.open_mainfile(filepath=str(BASE / 'seated-dining.blend'))
    rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    chair = bpy.data.objects['Seated dining chair']
    table = bpy.data.objects['Seating table clearance']
    rig.rotation_euler.z = 0
    chair.rotation_euler.z = 1.5707963267948966
    table.rotation_euler.z = 0
    table.location = (0, -1.5, 0)
    bpy.context.scene.frame_set(1)
    return rig, chair, table


try:
    rig, chair, table = scene()
    report['accepted'] = measure(rig, chair, table)
    for name in ('generic-armchair-pose', 'raised-seat', 'missing-seat'):
        rig, chair, table = scene()
        if name == 'generic-armchair-pose':
            set_pose(rig, 'seated_eat', 0)
        elif name == 'raised-seat':
            bpy.data.objects['Seat'].location.z += .05
        else:
            bpy.data.objects.remove(bpy.data.objects['Seat'], do_unlink=True)
        try:
            measure(rig, chair, table)
        except (AssertionError, ValueError) as error:
            report['cases'].append(dict(name=name, caught=True, error=str(error)))
        else:
            raise AssertionError('Physical regression escaped: ' + name)
    report['state'] = 'complete'
except BaseException:
    report['state'] = 'failed'
    report['error'] = traceback.format_exc()
    raise
finally:
    output.write_text(json.dumps(report, indent=2) + '\n')
