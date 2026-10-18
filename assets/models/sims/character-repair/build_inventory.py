"""Bind every current model and character clip to its explicit asset representation."""
from pathlib import Path
import hashlib
import json
import tomllib

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[3]


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    models=tomllib.loads((ROOT/'content/objects.toml').read_text())['model']
    atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    indices={row['name']:index for index,row in enumerate(atlas['sprite'])}
    records={}
    bundles={}
    for family in ['fixture-depth','aquarium-depth','outdoor-depth','shelf-depth','components','dropped-book']:
        path=BASE/family/'manifest.json'
        manifest=json.loads(path.read_text())
        assert manifest['state']=='complete'
        bundles[family]=dict(path=path.relative_to(BASE).as_posix(),sha256=sha(path))
        for row in manifest.get('sprites',[]):records[row['name']]=family
    model_rows=[]
    for model in models:
        sprite=model['properties']['sprite']['set']
        assert sprite in records,sprite
        row=dict(model=model['id'],sprite=sprite,atlasIndex=indices[sprite],depthBundle=records[sprite],
                 representation='unchanged-published-color-with-registered-source-surface-depth')
        if model['id']=='bookshelf':row['inventoryDepthBundle']='shelf-depth'
        model_rows.append(row)
    clip_path=ROOT/'assets/models/sims/character-creator/clips/clips.json'
    clips=json.loads(clip_path.read_text())
    clip_rows=[]
    for name,clip in clips['clips'].items():
        family=clip['family']
        parts_path=clip_path.parent/family/'parts.json'
        parts=json.loads(parts_path.read_text())['parts']
        active=[part for part in parts if name in part['clips']]
        clip_rows.append(dict(clip=name,family=family,
            staticFixtureParts=[part['source'] for part in active if part['owner']=='fixture'],
            independentProps=[part['source'] for part in active if part['owner']=='prop'],
            characterOwnedParts=[part['source'] for part in active if part['owner']=='body'],
            partsSource=dict(path=parts_path.relative_to(ROOT).as_posix(),sha256=sha(parts_path))))
    inventory=dict(version=1,state='complete',bundles=bundles,models=model_rows,clips=clip_rows,
        movingFixtureRules=[
            dict(family='fridge',selection='Published source clip sample maps to closed, ajar20, ajar55, or open.'),
            dict(family='bike',selection='Eight source crank states follow the reversed source phase used by the character clip.'),
            dict(family='bed',selection='Use cover-removed base for occupied double beds; configured cover is separate geometry.'),
            dict(family='bunk',selection='Use cover-removed base only when the upper place is occupied. Lower-only occupancy keeps the published upper duvet.')],
        specialProps=[
            dict(sprite='carried_ingredients',atlasIndex=indices['carried_ingredients'],representation='billboard',
                 source='assets/sprites/gen/objects.py:_carried',physicalContract='A camera-facing bitmap plane anchored at the carrying hand; this is not authored volume.'),
            dict(sprite='ownedDroppedBook',representation='reconstructed-source-geometry',bundle='dropped-book',
                 physicalContract='Four source-colored floor-supported views, with matching physical depth. The unavailable original scene was not recovered.')],
        consumerAcceptance='Runtime integration, wall intersections, interaction transitions, and owner visual acceptance are separate checks.')
    (BASE/'asset-inventory.json').write_text(json.dumps(inventory,indent=2),encoding='utf-8')
    print(json.dumps(dict(models=len(model_rows),clips=len(clip_rows),missingModels=[])))


if __name__=='__main__':main()
