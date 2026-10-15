"""Export stock-aware physical shelf depth alongside unchanged inventory colors."""
from pathlib import Path
import gzip
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tomllib
import traceback

import bpy
import numpy as np
from mathutils import Matrix

BASE = Path(__file__).resolve().parent
ROOT = BASE.parents[3]
MODELS = ROOT/'assets/models'
OUT = BASE/'shelf-depth'
sys.path.insert(0,str(BASE))
from depth_geometry import Pages, digest, sample, source_coverage
from export_components import image_bytes


def main():
    OUT.mkdir(exist_ok=True)
    producer=MODELS/'reading/fetch/producer'
    seed=OUT/'source-seed.blend'
    raw=gzip.decompress((producer/'seed.blend.gz').read_bytes())
    if hashlib.sha256(raw).hexdigest()!='9f2327cf7971658121faa049ac7c74977caecb2f3f1b2fc70df7294e87113a74':
        raise ValueError('Shelf seed differs from the published inventory source')
    seed.write_bytes(raw)
    source_manifest=MODELS/'bookcase/export/mask-09/manifest.json'
    published=json.loads(source_manifest.read_text())
    atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    atlas_rows={row['name']:index for index,row in enumerate(atlas['sprite'])}
    report=dict(version=1,state='running',encoding='rg-u16-unorm-x-minus-y-range-minus2-plus2',
                sourceSeedSha256=digest(seed),inventoryManifest=dict(path=source_manifest.relative_to(ROOT).as_posix(),sha256=digest(source_manifest)),
                composition='maximum-depth-among-shell-and-present-stock-slots',facings={},
                producerHashes={p.relative_to(ROOT).as_posix():digest(p) for p in [Path(__file__),BASE/'depth_geometry.py',producer/'pose_complete_fetch_spine_geometric_ink_v3.py']})
    pages=Pages(OUT,'depth')
    def save():
        (OUT/'manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    try:
        for facing,degrees in {'SE':90,'NW':270,'SW':0,'NE':180}.items():
            bpy.ops.wm.open_mainfile(filepath=str(seed),load_ui=False,use_scripts=False)
            scene=bpy.context.scene
            registration=published['registration']
            scene.camera.matrix_world=Matrix(registration['camera_matrix'])
            scene.camera.data.ortho_scale=registration['ortho_scale']
            scene.camera.data.shift_x=scene.camera.data.shift_y=0
            scene.render.resolution_x,scene.render.resolution_y=768,960
            scene.render.resolution_percentage=100
            furniture=bpy.data.collections['Witness furniture']
            body=bpy.data.collections.new('Repair empty shelf actor')
            scene.collection.children.link(body)
            rotation=Matrix.Rotation(math.radians(degrees),4,'Z')
            originals=[obj for obj in furniture.all_objects if obj.type in ('MESH','CURVE')]
            for obj in originals:
                obj.matrix_world=rotation@obj.matrix_world
                obj.hide_render=False
            stocks=[bpy.data.objects[row['name']] for row in published['slot_transforms'][facing]]
            bpy.context.view_layer.update()
            for obj,row in zip(stocks,published['slot_transforms'][facing]):
                error=max(abs(a-b) for actual,expected in zip(obj.matrix_world,row['world_matrix']) for a,b in zip(actual,expected))
                if error>1e-6:raise ValueError(f'Published shelf slot registration changed: {obj.name}: {error}')
            sys.path.insert(0,str(producer))
            from pose_complete_fetch_spine_geometric_ink_v3 import author
            original_proof=json.loads((source_manifest.parent/'provenance'/f'{facing}-proof.json').read_text())
            ink_contract=original_proof['geometric_ink_contract']
            ink,receipt=author(scene,furniture,body,stocks,ink_contract['sourcePixelWidth'],ink_contract['color'])
            if abs(receipt['worldWidth']-ink_contract['worldWidth'])>1e-8:
                raise ValueError('Authored shelf ink width differs from the published source')
            for obj in ink.values():obj.hide_render=False
            shell=[obj for obj in originals if obj not in stocks]+[ink[obj.name] for obj in originals if obj not in stocks and obj.name in ink]
            base=image_bytes('resize',source_manifest.parent/f'{facing}-base.png',OUT/'base-pixels.rgba',[192,240])
            depth,proof,_,_=sample(shell,192,240,base[:,:,3]>0,max_edge_distance=3+math.sqrt(.5))
            row=dict(atlasIndex=atlas_rows['offlineBookcase'+('' if facing=='SE' else facing)],shell=dict(**pages.add(depth),**proof),slots=[])
            report['facings'][facing]=row
            for slot,obj in enumerate(stocks):
                objects=[obj,ink[obj.name]] if obj.name in ink else [obj]
                coverage=source_coverage(objects,768,960)
                raw_path=OUT/'source-mask.raw'
                raw_path.write_bytes(coverage.tobytes())
                target=OUT/'mask.raw'
                subprocess.run([shutil.which('python'),str(BASE/'color_pixels.py'),'mask',str(raw_path),str(target),'768','960','192','240'],check=True,capture_output=True)
                alpha=np.frombuffer(target.read_bytes(),dtype=np.uint8).reshape((240,192))
                depth,proof,_,_=sample(objects,192,240,alpha>0,max_edge_distance=3+math.sqrt(.5))
                row['slots'].append(dict(slot=slot,sourceBook=obj.name,**pages.add(depth),**proof))
                save()
                print(facing,slot,'stock depth complete',flush=True)
        report['pages']=pages.save()
        report['state']='complete'
        save()
    except Exception:
        report['state']='failed'
        report['error']=traceback.format_exc()
        save()
        raise


if __name__=='__main__':main()
