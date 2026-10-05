"""Render signed joint bunk scenes with reciprocal holdouts and one ink pass."""
import os
from pathlib import Path
import sys
import traceback

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from covered_bunk_batch import SCRIPTS, groups, owners
from covered_bunk_contact import measure
from covered_bunk_sleep import SOURCE, build, digest, set_occupancy, set_palette, set_facing
from double_bed_receipt import SnapshotWriter
from double_bed_witnesses import measure as visible_witnesses


def signature():
    return {'scripts': {name: digest(BASE/name) for name in SCRIPTS},
            'source_sha256': digest(SOURCE), 'blender_version': bpy.app.version_string,
            'blender_build': bpy.app.build_hash.decode(), 'physical_canvas': [1280, 1408],
            'logical_canvas': [160, 176], 'pixel_density': 8, 'static': True}


def render_pass(state, owner, path):
    scene, layer = state['scene'], bpy.context.view_layer
    collections = {'furniture': state['furniture'], 'sim0': state['body']}
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
        raise FileExistsError('Refusing to replace a raw pass')
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def run(output):
    if (not bpy.app.background or bpy.app.version_string != '4.5.14 LTS'
            or bpy.app.build_hash.decode() != '62c1db4208e8'):
        raise ValueError('Expected pinned background Blender')
    output.mkdir(parents=True, exist_ok=False)
    writer = SnapshotWriter(output)
    report = {'state': 'running', 'pid': os.getpid(), 'pilot': False,
              'signature': signature(), 'renders': [], 'surface_witnesses': {}, 'contact_samples': []}
    try:
        writer.publish('start', report)
        state = build()
        state['bodies'] = [state['body']]
        scene = state['scene']
        report['color_management'] = {'view': scene.view_settings.view_transform,
                                      'look': scene.view_settings.look,
                                      'exposure': scene.view_settings.exposure, 'gamma': scene.view_settings.gamma,
                                      'display': scene.display_settings.display_device}
        p = world_to_camera_view(scene, scene.camera, Vector((0, 0, 0)))
        report['projected_origin'] = [p.x*160, (1-p.y)*176]
        report['anchor'] = [report['projected_origin'][0], report['projected_origin'][1]+21]
        if max(abs(a-b) for a, b in zip(report['anchor'], (80, 144.00044))) > .002:
            raise ValueError('Bunk camera registration changed')
        for mask, facing, first, second, sample in groups():
            set_occupancy(state, mask)
            set_palette(state, first)
            if mask:
                fit = measure(state)
                if report['contact_samples'] and fit != report['contact_samples'][0]:
                    raise ValueError('Palette or scene replay changed the physical pose')
                if not report['contact_samples']:
                    report['contact_samples'].append(fit)
                    writer.publish('canonical-fit', fit)
            set_facing(state, facing)
            witness_key = f'{mask}|{facing}'
            if witness_key not in report['surface_witnesses']:
                witnesses = visible_witnesses(state)
                report['surface_witnesses'][witness_key] = witnesses
                writer.publish('owner-witnesses', {'scene': witness_key, 'witnesses': witnesses})
            for owner in owners(mask):
                path = output / f'covered-bunk-{mask}-{facing}-{first}-{sample}-{owner}.png'
                render_pass(state, owner, path)
                row = {'occupancy': mask, 'facing': facing, 'palettes': [first, second],
                       'sample': sample, 'owner': owner, 'path': path.name, 'sha256': digest(path)}
                report['renders'].append(row)
                writer.publish('image-result', row)
        if signature() != report['signature']:
            raise ValueError('Frozen render inputs changed')
        report['state'] = 'complete'
    except BaseException:
        report.update(state='failed', error=traceback.format_exc())
        raise
    finally:
        writer.finish(report)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    if len(args) != 1 or not Path(args[0]).is_absolute():
        raise ValueError('Pass one new absolute raw batch directory')
    run(Path(args[0]))
