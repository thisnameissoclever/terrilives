"""Render joint occupied scenes with three reciprocal holdouts and one outline."""
import argparse
import json
import os
from pathlib import Path
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from double_bed_receipt import SnapshotWriter
from double_bed_sleep import build, digest, set_facing, set_occupancy, set_palette
from double_bed_batch import groups, owners, SCRIPTS
from double_bed_witnesses import measure


def signature():
    config = json.loads((BASE/'double-bed-sleep-pose.json').read_text())
    return {'scripts': {name: digest(BASE/name) for name in SCRIPTS},
            'source_sha256': digest(BASE/config['source_model']),
            'blender_version': bpy.app.version_string,
            'blender_build': bpy.app.build_hash.decode(),
            'physical_canvas': [1280, 1408], 'logical_canvas': [160, 176],
            'pixel_density': 8, 'static': True}


def render_pass(state, owner, path):
    scene, layer = state['scene'], bpy.context.view_layer
    collections = {'furniture': state['furniture'],
                   'sim0': state['bodies'][0], 'sim1': state['bodies'][1]}
    for name, collection in collections.items():
        layer.layer_collection.children[collection.name].holdout = owner in collections and owner != name
    for lines in layer.freestyle_settings.linesets:
        lines.select_by_collection = False
    scene.render.use_freestyle = owner in ('beauty', 'lines')
    layer.freestyle_settings.as_render_pass = owner == 'lines'
    scene.use_nodes = owner == 'lines'
    if owner == 'lines':
        nodes = scene.node_tree
        nodes.nodes.clear()
        source = nodes.nodes.new('CompositorNodeRLayers')
        output = nodes.nodes.new('CompositorNodeComposite')
        nodes.links.new(source.outputs['Freestyle'], output.inputs['Image'])
    if path.exists():
        raise ValueError('Refusing to replace a render: ' + path.name)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def palette_stops(state, owner):
    return {name: [tuple(stop.color) for stop in row['ramp'].elements]
            for name, row in state['palettes'][owner].items()}


def run(output, pilot):
    if not bpy.app.background or bpy.app.version_string != '4.5.14 LTS' or bpy.app.build_hash.decode() != '62c1db4208e8':
        raise ValueError('Expected the pinned background Blender build')
    output.mkdir(parents=True, exist_ok=False)
    writer = SnapshotWriter(output)
    report = {'state': 'running', 'pid': os.getpid(), 'pilot': pilot,
              'signature': signature(), 'renders': [], 'surface_witnesses': {}}
    try:
        writer.publish('start', report)
        state = build()
        scene = state['scene']
        settings = {'view': scene.view_settings.view_transform, 'look': scene.view_settings.look,
                    'exposure': scene.view_settings.exposure, 'gamma': scene.view_settings.gamma,
                    'display': scene.display_settings.display_device}
        if settings != {'view': 'Standard', 'look': 'None', 'exposure': 0, 'gamma': 1, 'display': 'sRGB'}:
            raise ValueError('Scene-linear export requires the approved sRGB display transfer')
        report['color_management'] = settings
        baseline = palette_stops(state, 1)
        set_palette(state, 0, 'blue')
        if palette_stops(state, 1) != baseline:
            raise ValueError('Owner 0 recolored owner 1 clothing')
        set_palette(state, 0, 'green')
        baseline = palette_stops(state, 0)
        set_palette(state, 1, 'red')
        if palette_stops(state, 0) != baseline:
            raise ValueError('Owner 1 recolored owner 0 clothing')
        set_palette(state, 1, 'green')
        report['independent_materials'] = True
        p = world_to_camera_view(state['scene'], state['scene'].camera, Vector((0, 0, 0)))
        report['projected_origin'] = [p.x*160, (1-p.y)*176]
        report['anchor'] = [report['projected_origin'][0], report['projected_origin'][1]+21]
        if max(abs(a-b) for a, b in zip(report['anchor'], (80, 144.00044))) > .002:
            raise ValueError('Double bed camera registration changed')
        for mask, facing, first, second, sample in groups(pilot):
            set_occupancy(state, mask)
            set_palette(state, 0, first)
            set_palette(state, 1, second)
            set_facing(state, facing)
            witness_key = f'{mask}|{facing}'
            if witness_key not in report['surface_witnesses']:
                report['surface_witnesses'][witness_key] = measure(state)
                writer.publish('owner-witnesses', {'scene': witness_key,
                                                   'witnesses': report['surface_witnesses'][witness_key]})
            for owner in owners(mask):
                name = f'double-bed-{mask}-{facing}-{first}-{second}-{sample}-{owner}.png'
                render_pass(state, owner, output/name)
                row = {'occupancy': mask, 'facing': facing, 'palettes': [first, second],
                       'sample': sample, 'owner': owner, 'path': name, 'sha256': digest(output/name)}
                report['renders'].append(row)
                writer.publish('image-result', row)
        if signature() != report['signature']:
            raise ValueError('Render inputs changed during generation')
        report['state'] = 'complete'
    except BaseException:
        report.update(state='failed', error=traceback.format_exc())
        raise
    finally:
        writer.finish(report)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pilot', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    if not args.output.is_absolute():
        raise ValueError('Use an absolute owned output directory')
    run(args.output, args.pilot)
