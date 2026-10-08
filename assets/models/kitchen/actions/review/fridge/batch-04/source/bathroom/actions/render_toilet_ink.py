"""Body-owned toilet ink with the complete fixture still providing occlusion."""
import hashlib
import json
from pathlib import Path
import sys

BASE=Path(__file__).resolve().parent


def render_body_ink(scene,body,fixture,path):
    import bpy
    from armchair_contact import body_inventory
    visible={obj.name for obj in body.all_objects if not obj.hide_render}
    if visible!=body_inventory():
        raise ValueError('Body ink changed the complete approved54-object owner inventory')
    layer=bpy.context.view_layer
    for collection in (body,fixture):
        layer.layer_collection.children[collection.name].holdout=False
    for lines in layer.freestyle_settings.linesets:
        lines.select_by_collection=True
        lines.collection=body
        lines.collection_negation='INCLUSIVE'
    scene.render.use_freestyle=True
    layer.freestyle_settings.as_render_pass=True
    scene.use_nodes=True
    tree=scene.node_tree
    tree.nodes.clear()
    source=tree.nodes.new('CompositorNodeRLayers')
    target=tree.nodes.new('CompositorNodeComposite')
    tree.links.new(source.outputs['Freestyle'],target.inputs['Image'])
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    return dict(body_owned_stroke_inventory=sorted(visible),full_scene_occlusion=True,
                fixture_geometry_hidden=False,body_and_fixture_holdout=False)


def run(source_proof,output):
    """Standalone replay uses the same source binder as the combined job."""
    import bpy
    sys.path.insert(0,str(BASE))
    from render_toilet_loop import render_ink_replay
    if not bpy.app.background:
        raise ValueError('Body ink requires hidden background Blender')
    render_ink_replay(Path(source_proof),Path(output))


if __name__=='__main__':
    args=sys.argv[sys.argv.index('--')+1:]
    run(args[0],args[1])
