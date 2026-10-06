"""Join verified facing exports and measure real shelf-only page packing."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import time
from PIL import Image
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def run(unused,output):
    folders=[HERE/f'shelf-complete-export-{f.lower()}-01' for f in ('SE','SW','NW','NE')]
    paths=[Path(__file__),ROOT/'assets/sprites/gen/atlas_pages.py',HERE/'shelf-complete-catalogue-confirmed-01/proof.json',HERE/'shelf-complete-catalogue-confirmed-01/writer-exit.json']
    paths += [p/n for p in folders for n in ('manifest.json','writer-exit.json')]
    before={p.relative_to(ROOT).as_posix():digest(p) for p in paths}
    output.mkdir(parents=True,exist_ok=False)
    start=time.perf_counter()
    manifest=None
    allimages=[]
    for folder in folders:
        part=json.loads((folder/'manifest.json').read_text())
        receipt=json.loads((folder/'writer-exit.json').read_text())
        assert part['state']=='complete' and receipt['exit_code']==0 and receipt['stop_reason'] is None
        assert receipt['proof_sha256']==digest(folder/'manifest.json')
        if manifest is None:
            manifest=dict(part);manifest['bases']={};manifest['rows']={}
        assert part['source_proof_sha256']==manifest['source_proof_sha256']
        for row in part['images']:
            image=folder/row['path']
            assert digest(image)==row['sha256'] and receipt['outputs_verified'][row['path']]==row['sha256']
            shutil.copyfile(image,output/row['path'])
            assert digest(output/row['path'])==row['sha256']
            allimages.append(dict(row))
        manifest['bases'].update(part['bases']);manifest['rows'].update(part['rows'])
    manifest['inputs']=before
    manifest['images']=allimages
    assert len(manifest['bases'])==4 and all(len(rows)==4 and all(len(r)==64 for r in rows) for rows in manifest['rows'].values())
    spec=importlib.util.spec_from_file_location('atlas_pages',ROOT/'assets/sprites/gen/atlas_pages.py')
    pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)
    placed,count=pack.pack_pages([tuple(r['size']) for r in allimages],2048,1)
    pages=[]
    for page in range(count):
        sheet=Image.new('RGBA',(2048,2048),(0,0,0,0))
        for index,row in enumerate(allimages):
            p,x,y=placed[index]
            row['packed']={'page':p,'x':x,'y':y,'width':row['size'][0],'height':row['size'][1]}
            if p!=page:continue
            image=Image.open(output/row['path']).convert('RGBA')
            sheet.paste(image,(x,y))
            assert sheet.crop((x,y,x+image.width,y+image.height)).tobytes()==image.tobytes()
        path=output/f'page-{page:02d}.png';sheet.save(path)
        pages.append({'path':path.name,'sha256':digest(path),'size':[2048,2048],'decoded_bytes':2048*2048*4})
        sheet.close()
    manifest['pages']=pages
    manifest['images']+=pages
    total=sum(r['decoded_bytes'] for r in allimages if 'packed' in r)
    # Pages are added to the same list only after computing crop payload.
    payload=sum(r['decoded_bytes'] for r in manifest['images'] if 'packed' in r)
    gpu=count*2048*2048*4
    manifest['packing']={'page_size':2048,'padding':1,'shelf_only_pages':count,'crop_payload_bytes':payload,
       'page_decoded_bytes':gpu,'gpu_texture_bytes':gpu,
       'packing_waste_bytes':gpu-payload,'incremental_full_game_page_count_unmeasured':True,
       'conservative_upload_live_set_model_bytes':gpu*2+2048*2048*4,
       'upload_live_set_model':'All decoded pages plus GPU array plus one staging page; driver/internal copies excluded. Runtime measurement still required.'}
    assert before=={p:digest(ROOT/p) for p in before}
    manifest.update(state='complete',elapsed_seconds=time.perf_counter()-start,total_crop_decoded_bytes=payload,
                    actual_packing_and_upload_peak_pending=False,actual_upload_peak_pending=True)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'state':'complete','image_count':len(allimages)-len(pages),'page_count':count,'packing':manifest['packing'],'seconds':manifest['elapsed_seconds']}))

if __name__=='__main__':run(Path(sys.argv[1]),Path(sys.argv[2]))
