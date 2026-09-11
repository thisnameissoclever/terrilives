"""Measure deformed shoes against the authored bike through a complete cycle."""
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = Path(__file__).resolve().parent
sys.path.insert(0,str(BASE))
from animation_export import scene_for, digest, SIM
from build_parts import set_crank_phase
from contact_contract import validate_contact_report
from geometry import PEDAL_THICKNESS
from preview import rider_pose


def evaluated_tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    vertices = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    tree = BVHTree.FromPolygons(vertices,[list(face.vertices) for face in mesh.polygons])
    minimum_z = min(vertex.z for vertex in vertices)
    evaluated.to_mesh_clear()
    return tree,minimum_z


def run():
    assert bpy.app.background
    source_hash = digest(SIM/'sim-01-rigged.blend')
    scene,rig,root,movable,_,_ = scene_for('bike')
    rig.rotation_euler = (0,0,0)
    root.rotation_euler = (0,0,0)
    shoes = [o for o in bpy.data.objects if o.name.startswith(('Shaped shoe','Fitted rounded shoe sole'))]
    obstacles = [o for o in bpy.data.objects if o.name.startswith(('Bike flywheel','Bike console mast'))]
    report = {'source_sha256':source_hash,'samples':16,'contacts':[],'collisions':[],
              'obstacle_count':len(obstacles),'shoe_count':len(shoes),
              'obstacles':[obj.name for obj in obstacles],'shoes':[obj.name for obj in shoes]}
    for sample in range(16):
        rider_pose(rig,sample/16)
        set_crank_phase(movable,sample/16)
        bpy.context.view_layer.update()
        obstacle_trees = [(o.name,evaluated_tree(o)[0]) for o in obstacles]
        for shoe in shoes:
            tree,minimum_z = evaluated_tree(shoe)
            if shoe.name.startswith('Fitted rounded shoe sole'):
                side = 'R' if shoe.name.endswith('.001') else 'L'
                centre = bpy.data.objects['Bike pedal '+side].matrix_world.translation
                top = centre.z + PEDAL_THICKNESS/2
                # Cast upward through the pedal centre. Matching minimum Z
                # alone would also pass a shoe displaced sideways off the pedal.
                hit,_,_,_ = tree.ray_cast(Vector((centre.x,centre.y,top-.01)),Vector((0,0,1)),.05)
                report['contacts'].append({'sample':sample,'side':side,'gap':minimum_z-top,
                                          'support_gap':None if hit is None else hit.z-top})
            for name,other in obstacle_trees:
                overlap = tree.overlap(other)
                if overlap:
                    report['collisions'].append({'sample':sample,'shoe':shoe.name,
                                                  'obstacle':name,'intersections':len(overlap)})
    assert digest(SIM/'sim-01-rigged.blend') == source_hash
    output = BASE/'review/animation-02/contact-proof.json'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2))
    validate_contact_report(report)
    print('PASS: sixteen evaluated phases; no shoe/wheel intersections; both soles contact pedals')


if __name__ == '__main__':
    run()
