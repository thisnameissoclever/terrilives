"""Export and bind the recessed ladder, closed liner and actual wet floor inside the square."""
from argparse import ArgumentParser
from hashlib import sha256
import json
from pathlib import Path
import sys
import bpy

HERE=Path(__file__).resolve().parent
MODELS=HERE.parent
sys.path[:0]=[str(HERE),str(MODELS/'furniture')]
from export_pool_fixture_v5 import evaluated_fixture,digest
from export_pool_fixture_v7 import top_faces
from pool_activity_model_v8 import build
import pool_activity_layout_v8 as bay


def export(source,out):
    motion_in=(source/'motion.json').read_bytes()
    motion=json.loads(motion_in);fixture=json.loads((source/'contacts.json').read_bytes())
    family=json.loads((source/'ladder-climb-out.poolroute').read_bytes())
    if sha256(motion_in).hexdigest()!=fixture['revisions']['poseProducer'] or family['motion']!=fixture['revisions']['poseProducer'] or family['model']!=fixture['revisions']['model']:
        raise ValueError('Unpaired incoming pool motion, physical surface and family.')
    out.mkdir(parents=True,exist_ok=False)
    bpy.ops.wm.open_mainfile(filepath=str(MODELS/'sims/sim-01/sim-01-rigged.blend'),load_ui=False,use_scripts=False)
    scene=bpy.data.scenes.new('Square pool with dry ladder bay');bpy.context.window.scene=scene
    root=bpy.data.objects.new('POOL_MODEL_ROOT',None);scene.collection.objects.link(root)
    proof=build(root)
    solids,rails=evaluated_fixture(root,bay.LADDER_RAIL_X)
    by_name={s['id']:s for s in solids};original={s['id']:s for s in fixture['solids']}
    if by_name.keys()!=original.keys():raise ValueError('The ladder bay lost its physical owners.')
    deck=by_name[motion['places']['crest']['surface']]
    if abs(deck['bounds'][1][1]-deck['bounds'][0][1]-.48)>1e-6:raise ValueError('Incorrect clear landing depth.')
    inside=[by_name[motion['places'][p]['surface']] for p in ['outside3','outside2','outside1']]
    if any(abs(s['bounds'][1][1]-b)>1e-6 for s,b in zip(inside,[.60,.75,.90])):raise ValueError('Outer tread spacing differs from the authored flight.')
    for clip in fixture['clips'].values():
        for r in [*clip['samples'],*clip['intervals']]:
            for v in r['limbs'].values():
                name=v['surface']
                if name in by_name and v['region'] and v['region']['kind']=='top-face':
                    if v['region'].get('triangles')!=top_faces(original[name]):raise ValueError('Unexpected partial support on '+name)
                    v['region']={'kind':'top-face','triangles':top_faces(by_name[name])}
    motion['modelSource']='outdoor/pool_activity_model_v8.py'
    motion['derivation']['ladder']='A 48 cm turning platform and inclined flight sit in a dry recess inside the 2 by 2 pool.'
    motion['dryBay']={'outer':[bay.DRY[1],bay.DRY[2],bay.DRY[3]],'liner':[bay.WET[1],bay.WET[2],bay.WET[3]],
                      'water':[bay.WATER[1],bay.WATER[2],bay.WATER[3]],'inset':bay.INSET}
    motion['waterCorridor']['initialCentre'][1]=-.18
    path=out/'pool-authoring.blend'
    bpy.ops.wm.save_as_mainfile(filepath=str(path),check_existing=False)
    body=(json.dumps(motion,indent=2)+'\n').encode();model=digest(path);motion_sha=sha256(body).hexdigest()
    fixture.update(solids=solids,rails=rails,waterHeight=proof['water_z'])
    fixture['revisions'].update(model=model,poseProducer=motion_sha,producer=digest(Path(__file__)),
      clipLibrary=sha256(json.dumps(fixture['clips'],sort_keys=True,separators=(',',':')).encode()).hexdigest())
    family.update(model=model,motion=motion_sha)
    (out/'motion.json').write_bytes(body)
    (out/'contacts.json').write_bytes(json.dumps(fixture,separators=(',',':')).encode())
    (out/'ladder-climb-out.poolroute').write_bytes(json.dumps(family,separators=(',',':')).encode())
    (out/'geometry-proof.json').write_text(json.dumps({'dry':bay.DRY,'wet':bay.WET,'nosings':proof['nosings'],
     'solidBounds':[[op(s['bounds'][side][axis] for s in solids) for axis in range(3)] for side,op in enumerate((min,max))],
     'modelSha256':model},indent=2))
    print(json.dumps({p.name:digest(p) for p in out.iterdir() if p.is_file()}))


if __name__=='__main__':
    p=ArgumentParser()
    p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);export(a.source,a.output)
