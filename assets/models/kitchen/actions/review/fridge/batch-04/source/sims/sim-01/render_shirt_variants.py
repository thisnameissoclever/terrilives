"""Render shirt-only variants from the unchanged saved actions in background Blender."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import traceback

import bpy
import numpy as np

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from render_job import apply_render_job
from shirt_colors import recolor_stop

SHIRT_COLORS = {
    'blue': {
        'Washed sage overshirt': (0.045, 0.18, 0.38, 1.0),
        'Sage seam and cuff': (0.035, 0.135, 0.285, 1.0),
        'Sage folded collar fabric': (0.055, 0.205, 0.42, 1.0),
    },
    'red': {
        'Washed sage overshirt': (0.40, 0.06, 0.045, 1.0),
        'Sage seam and cuff': (0.30, 0.045, 0.034, 1.0),
        'Sage folded collar fabric': (0.44, 0.075, 0.055, 1.0),
    },
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def material_snapshot():
    result = {}
    for material in bpy.data.materials:
        values = {'diffuse_color': list(material.diffuse_color)}
        if material.node_tree:
            values['links'] = [f'{link.from_node.name}/{link.from_socket.identifier}>{link.to_node.name}/{link.to_socket.identifier}'
                               for link in material.node_tree.links]
            for node in material.node_tree.nodes:
                if node.type == 'VALTORGB':
                    values[f'{node.name}/ramp'] = [{'position': element.position, 'color': list(element.color)}
                                                  for element in node.color_ramp.elements]
                    values[f'{node.name}/ramp_settings'] = {
                        field: getattr(node.color_ramp, field)
                        for field in ('interpolation', 'color_mode', 'hue_interpolation')}
                for socket in node.inputs:
                    if not hasattr(socket, 'default_value'):
                        continue
                    value = socket.default_value
                    if not isinstance(value, (str, int, float, bool)):
                        try:
                            value = list(value)
                        except TypeError:
                            value = str(value)
                    values[f'{node.name}/{socket.identifier}'] = value
        result[material.name] = values
    return result


def topology_sha256():
    digest = hashlib.sha256()
    for obj in sorted(bpy.data.objects, key=lambda item: item.name):
        if obj.type != 'MESH':
            continue
        digest.update(obj.name.encode())
        digest.update(json.dumps([material.name if material else None for material in obj.data.materials]).encode())
        for collection, field, count in ((obj.data.polygons, 'material_index', len(obj.data.polygons)),
                                         (obj.data.loops, 'vertex_index', len(obj.data.loops)),
                                         (obj.data.polygons, 'loop_total', len(obj.data.polygons))):
            values = np.empty(count, dtype=np.int32)
            collection.foreach_get(field, values)
            digest.update(values.tobytes())
    return digest.hexdigest()


def set_shirt_colors(colors, original_materials):
    for name, color in colors.items():
        material = bpy.data.materials[name]
        nodes = [node for node in material.node_tree.nodes if node.type == 'VALTORGB']
        assert len(nodes) == 1, (name, len(nodes))
        ramp = nodes[0].color_ramp
        original = original_materials[name][f'{nodes[0].name}/ramp']
        assert len(ramp.elements) == len(original) == 4
        for element, before in zip(ramp.elements, original):
            element.color = recolor_stop(before['color'], original_materials[name]['diffuse_color'], color)
            assert element.position == before['position']


def run(preview):
    assert bpy.app.background
    suffix = 'preview' if preview else 'batch'
    status_path = BASE / f'shirt-variants-{suffix}-status.json'
    status_path.write_text(json.dumps({'state': 'running', 'completed': 0}))
    source = BASE / 'sim-01-rigged.blend'
    manifest_path = BASE / 'export/manifest.json'
    manifest = json.loads(manifest_path.read_text())
    preserved = {path.relative_to(BASE).as_posix(): sha256(path) for path in
                 [source, manifest_path] + [BASE / 'export' / frame['path'] for frame in manifest['frames']]}
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    registration = json.loads((BASE / 'registered-canvas-proof.json').read_text())
    original_materials = material_snapshot()
    (BASE / 'shirt-source-materials.json').write_text(json.dumps(original_materials, indent=2) + '\n')
    topology = topology_sha256()
    jobs = [frame for frame in manifest['frames'] if not preview or
            (frame['action'] == 'idle' and frame['facing'] in ('SE', 'SW'))]
    baseline = {}
    for frame in jobs:
        baseline[frame['path']] = apply_render_job(scene, rig, registration,
                                                  frame['action'], frame['facing'], frame['frame'])
    proof = {'source_rig_sha256': sha256(source), 'mode': suffix, 'variants': {},
             'topology_and_material_assignment_sha256': topology,
             'preserved_sha256': preserved,
             'saved_rig_exact_replay': 'Unresolved reading RGB drift; existing failed proof remains unchanged.'}
    completed = 0
    for variant, colors in SHIRT_COLORS.items():
        set_shirt_colors(colors, original_materials)
        updated = material_snapshot()
        changes = []
        for name, values in original_materials.items():
            for field, before in values.items():
                after = updated[name][field]
                if before != after:
                    assert name in colors and field == 'Color Ramp/ramp', (name, field)
                    assert [stop['position'] for stop in before] == [stop['position'] for stop in after]
                    assert [stop['color'][3] for stop in before] == [stop['color'][3] for stop in after]
                    changes.append({'material': name, 'field': field, 'before': before, 'after': after})
        assert len(changes) == 3, changes
        assert topology_sha256() == topology
        directory = BASE / 'review/shirt-variants' / variant
        directory.mkdir(parents=True, exist_ok=True)
        rows = []
        for frame in jobs:
            state = apply_render_job(scene, rig, registration, frame['action'], frame['facing'], frame['frame'])
            assert state == baseline[frame['path']], (variant, frame['path'], 'geometry, visibility or camera changed')
            path = directory / frame['path']
            scene.render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            rows.append({'path': frame['path'], 'sha256': sha256(path), 'state': state})
            completed += 1
            status_path.write_text(json.dumps({'state': 'running', 'completed': completed,
                                              'total': len(jobs) * 2, 'last': f'{variant}/{frame["path"]}'}))
        proof['variants'][variant] = {'target_linear_rgba': colors, 'material_changes': changes, 'frames': rows}
    for name in SHIRT_COLORS['blue']:
        node = next(node for node in bpy.data.materials[name].node_tree.nodes if node.type == 'VALTORGB')
        for element, before in zip(node.color_ramp.elements, original_materials[name][f'{node.name}/ramp']):
            element.color = before['color']
    assert material_snapshot() == original_materials
    assert all(sha256(BASE / path) == digest for path, digest in preserved.items())
    proof['state'] = 'complete'
    proof['original_files_byte_identical'] = True
    (BASE / f'shirt-variants-{suffix}-proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    status_path.write_text(json.dumps({'state': 'complete', 'completed': completed, 'total': len(jobs) * 2}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    try:
        run(args.preview)
    except Exception:
        suffix = 'preview' if args.preview else 'batch'
        (BASE / f'shirt-variants-{suffix}-status.json').write_text(
            json.dumps({'state': 'failed', 'traceback': traceback.format_exc()}, indent=2))
        raise
