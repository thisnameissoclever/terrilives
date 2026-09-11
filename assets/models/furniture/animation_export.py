"""Render occupied scenes and reciprocal collection holdouts for layer review."""
import hashlib
import json
import math
from pathlib import Path
import sys
import traceback

import bpy

BASE = Path(__file__).resolve().parent
SIM = BASE.parent / 'sims/sim-01'
sys.path.insert(0, str(BASE))
from build_parts import bike, chair, set_crank_phase
from geometry import FACINGS
from preview import rider_pose

OUTPUT = BASE / 'review/animation-probe'
if '--no-lines' in sys.argv:
    OUTPUT = BASE / 'review/animation-probe-no-lines'
if '--separate-lines' in sys.argv:
    OUTPUT = BASE / 'review/animation-probe-separate-lines'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_status(state, **fields):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT/'status.json').write_text(json.dumps({'state':state, **fields}, indent=2))


def scene_for(kind):
    bpy.ops.wm.open_mainfile(filepath=str(SIM/'sim-01-rigged.blend'))
    scene = bpy.context.scene
    rig = bpy.data.objects['SIM_01_SHARED_RIG']
    sim_collection = bpy.data.collections.new('Interaction Sim')
    scene.collection.children.link(sim_collection)
    for obj in list(bpy.data.objects):
        if obj.type not in ('MESH','CURVE'):
            continue
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        sim_collection.objects.link(obj)
    root = bpy.data.objects.new(kind.upper()+'_MODEL_ROOT', None)
    scene.collection.objects.link(root)
    movable = (bike if kind == 'bike' else chair)(root)
    furniture_collection = bpy.data.collections.new('Interaction furniture')
    scene.collection.children.link(furniture_collection)
    for obj in list(root.children_recursive):
        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        furniture_collection.objects.link(obj)
    registration = json.loads((SIM/'registered-canvas-proof.json').read_text())
    scene.camera.data.ortho_scale = registration['idle']['camera_ortho_scale'] * 120/88
    scene.camera.location = registration['idle']['camera_location']
    scene.render.resolution_x, scene.render.resolution_y = 384, 480
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    if '--no-lines' in sys.argv:
        scene.render.use_freestyle = False
    return scene, rig, root, movable, sim_collection, furniture_collection


def render_pass(scene, sim_collection, furniture_collection, owner, path, separate_lines=False):
    layer = bpy.context.view_layer
    layer.layer_collection.children[sim_collection.name].holdout = owner == 'furniture'
    layer.layer_collection.children[furniture_collection.name].holdout = owner == 'sim'
    for lines in layer.freestyle_settings.linesets:
        lines.select_by_collection = owner in ('sim', 'furniture')
        if owner in ('sim', 'furniture'):
            lines.collection = sim_collection if owner == 'sim' else furniture_collection
            lines.collection_negation = 'INCLUSIVE'
    if separate_lines or '--separate-lines' in sys.argv:
        scene.render.use_freestyle = owner in ('beauty', 'lines')
        layer.freestyle_settings.as_render_pass = owner == 'lines'
        scene.use_nodes = owner == 'lines'
        if owner == 'lines':
            tree = scene.node_tree
            tree.nodes.clear()
            source = tree.nodes.new('CompositorNodeRLayers')
            output = tree.nodes.new('CompositorNodeComposite')
            tree.links.new(source.outputs['Freestyle'], output.inputs['Image'])
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def run():
    assert bpy.app.background
    write_status('running', completed=0)
    records = []
    source = SIM/'sim-01-rigged.blend'
    source_hash = digest(source)
    small = '--no-lines' in sys.argv or '--separate-lines' in sys.argv
    for kind in (('bike',) if small else ('bike', 'chair')):
        scene, rig, root, movable, sim_collection, furniture_collection = scene_for(kind)
        for facing in (('SE',) if small else ('SE', 'NW')):
            root.rotation_euler.z = math.radians(FACINGS[facing])
            rig.rotation_euler.z = math.radians(FACINGS[facing])
            if kind == 'bike':
                rider_pose(rig, .25)
                set_crank_phase(movable, .25)
            else:
                rig.animation_data.action = bpy.data.actions['read']
                scene.frame_set(3)
            bpy.context.view_layer.update()
            owners = ('beauty', 'sim', 'furniture', 'lines') if '--separate-lines' in sys.argv else ('beauty', 'sim', 'furniture')
            for owner in owners:
                path = OUTPUT/f'{kind}-{facing}-{owner}.png'
                render_pass(scene, sim_collection, furniture_collection, owner, path)
                records.append({'path':path.name, 'sha256':digest(path)})
                write_status('running', completed=len(records), last=path.name)
    assert digest(source) == source_hash, 'Approved Sim source changed'
    (OUTPUT/'proof.json').write_text(json.dumps({'source_sha256':source_hash, 'renders':records}, indent=2))
    write_status('complete', completed=len(records))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        write_status('failed', traceback=traceback.format_exc())
        raise
