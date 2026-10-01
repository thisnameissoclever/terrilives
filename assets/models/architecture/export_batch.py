"""Crop shared renders and pack paired geometry resources without redraws."""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image
from floors import PATTERN_SIZE, pattern_rgb
from materials import catalogue, resource_budget, fixture_catalogue


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def crop_floor(record, arrays, px, py):
    d=record['pixelDensity']; ox,oy=record['origin']
    cx=round((ox+(px-py)*32)*d); cy=round((oy+(px+py)*21)*d)
    crop=(cx-66,cy-44,cx+66,cy+44)
    result=[a[crop[1]:crop[3],crop[0]:crop[2]].copy() for a in arrays]
    color,carrier,depth,roles,owners=result
    assert color.shape==(88,132,4), 'floor crop outside source'
    # Exact diamond runtime coverage owns the pixels; fill only the texture apron.
    for image in (color,carrier):
        for _ in range(5):
            missing=image[:,:,3]==0
            if not missing.any(): break
            copied=image.copy()
            for dy,dx in ((0,-1),(0,1),(-1,0),(1,0)):
                neighbor=np.roll(image,(dy,dx),(0,1)); valid=missing&(neighbor[:,:,3]>0)
                if dy<0: valid[dy:,:]=False
                if dy>0: valid[:dy,:]=False
                if dx<0: valid[:,dx:]=False
                if dx>0: valid[:,:dx]=False
                copied[valid]=neighbor[valid]; missing[valid]=False
            image[:]=copied
        # Only the exact tile and a four-pixel apron need color.
        yy,xx=np.indices(image.shape[:2]); sx=(xx+.5-66)/2; sy=(yy+.5-44)/2
        gx=(sx/32+sy/21)/2; gy=(sy/21-sx/32)/2
        inside=(gx>=-.5)&(gx<.5)&(gy>=-.5)&(gy<.5)
        assert np.all(image[:,:,3][inside]>0), 'floor interior has no color owner'
        image[:,:,3]=np.where(image[:,:,3]>0,255,0)
    depth[:]=0; roles[:]=np.where(color[:,:,3]>0,2,0); owners[:]=1
    return result,crop,[33,22]


def cropped_piece(record,arrays,owner):
    color,carrier,depth,roles,owners=(a.copy() for a in arrays)
    keep=(owners==owner)&(color[:,:,3]>0)
    assert np.any(keep), 'empty split owner'
    color[~keep]=0; carrier[~keep]=0; roles[~keep]=0; depth[~keep]=0
    ys,xs=np.where(keep); crop=[max(0,int(xs.min())-2),max(0,int(ys.min())-2),
                             min(color.shape[1],int(xs.max())+3),min(color.shape[0],int(ys.max())+3)]
    cropped=[a[crop[1]:crop[3],crop[0]:crop[2]] for a in (color,carrier,depth,roles,owners)]
    origin=[record['origin'][0]-crop[0]/2,record['origin'][1]-crop[1]/2]
    return cropped,crop,origin


def run(source,destination):
    receipt=json.loads((source/'proof.json').read_text())
    assert receipt['state']=='complete' and receipt['background'] is True, 'incomplete render batch'
    assert len(receipt['renders'])==receipt['expected_count']==174, 'incomplete render catalogue'
    destination.mkdir(parents=True,exist_ok=False)
    entries=[]; crops=[]
    source_coverage={}
    for record in receipt['renders']:
        for key in ('color','carrier','depth','roles','owners'):
            assert digest(source/record[key])==record['hashes'][key], 'render bytes changed'
        color=np.array(Image.open(source/record['color']).convert('RGBA'))
        carrier=np.array(Image.open(source/record['carrier']).convert('RGBA'))
        h,w=color.shape[:2]
        assert (w,h)==(record['widthPixels'],record['heightPixels']), 'color dimensions changed'
        assert carrier.shape==color.shape, 'carrier dimensions changed'
        bounds=Image.fromarray(color).getbbox()
        assert bounds and min(bounds[:2])>1 and bounds[2]<w-1 and bounds[3]<h-1, 'source image clipped'
        depth=np.fromfile(source/record['depth'],dtype='<f2').reshape(h,w)
        roles=np.fromfile(source/record['roles'],dtype=np.uint8).reshape(h,w)
        owners=np.fromfile(source/record['owners'],dtype=np.uint8).reshape(h,w)
        assert np.all(roles[color[:,:,3]>0]>0), 'visible color lacks material owner'
        assert np.all(owners[color[:,:,3]>0]>0), 'visible color lacks split owner'
        arrays=(color,carrier,depth,roles,owners)
        canonical=color.copy(); canonical[color[:,:,3]==0]=0
        source_coverage[record['geometryKey']]={'width':w,'height':h,
            'rgba_sha256':hashlib.sha256(canonical.tobytes()).hexdigest()}
        if record['kind']=='floor-patch':
            pieces=[(f'{px}.{py}',crop_floor(record,arrays,px,py),[px,py]) for py in range(4) for px in range(4)]
        else:
            ids=sorted(int(n) for n in np.unique(owners[color[:,:,3]>0]))
            pieces=[(str(i-1),cropped_piece(record,arrays,i),i-1) for i in ids]
        for suffix,(data,crop,origin),owned in pieces:
            image=data[0]; height,width=image.shape[:2]
            entry={k:record[k] for k in ('kind','model','width','direction','heightMode','armHeights','patternKey','physicalBounds') if k in record}
            entry.update(name=record['geometryKey']+'.piece.'+suffix,geometryKey=record['geometryKey'],
                         source=record['geometryKey'],sourceCrop=crop,origin=origin,anchor=[origin[0],origin[1]+21],
                         w=width,h=height,pixel_density=2,ownedSpan=owned,
                         logicalBounds=[-origin[0],-origin[1],width/2-origin[0],height/2-origin[1]])
            if record['kind']=='floor-patch':
                entry['geometryKey']='floor.tile'; entry['physicalBounds']=[[-.5,-.5,0],[.5,.5,0]]
                entry['phase']=owned; entry['heightMode']='floor'
            entries.append(entry); crops.append(data[:4])
    width=2048; x=y=row_height=0
    for entry in entries:
        if x+entry['w']+2>width: x=0; y+=row_height+2; row_height=0
        entry.update(x=x,y=y)
        entry['depthRegistration']={k:entry[k] for k in ('x','y','w','h','origin','pixel_density')}
        x+=entry['w']+2; row_height=max(row_height,entry['h'])
    height=y+row_height
    assert max(width,height)<=8192, 'architecture texture exceeds baseline limit'
    color=np.zeros((height,width,4),dtype=np.uint8); carrier=color.copy()
    depth=np.zeros((height,width),dtype='<f2'); roles=np.zeros((height,width),dtype=np.uint8)
    for entry,data in zip(entries,crops):
        x,y,w,h=(entry[k] for k in ('x','y','w','h'))
        for atlas,crop in zip((color,carrier,depth,roles),data): atlas[y:y+h,x:x+w]=crop
    Image.fromarray(color).save(destination/'color.png'); Image.fromarray(carrier).save(destination/'carrier.png')
    depth.tofile(destination/'depth.r16f'); roles.tofile(destination/'roles.r8')
    # Pattern maps are linear RGB resources. They are independent of geometry and palettes.
    resources={}
    for name in ('plaster','boards','tiles','carpet','neutral','grass','street','fixture-checks','fixture-stripes'):
        image=np.array([[tuple(round(c*255) for c in pattern_rgb(name,x,y))+(255,) for x in range(256)] for y in range(256)],dtype=np.uint8)
        path=destination/(name+'.pattern.png'); Image.fromarray(image).save(path)
        resources[name]={'file':path.name,'sha256':digest(path),'width':256,'height':256,'colorSpace':'linear',
                         'shipped':not name.startswith('fixture-')}
    paths={'color':'color.png','carrier':'carrier.png','depth':'depth.r16f','roles':'roles.r8'}
    manifest={'schema':1,'width':width,'height':height,'sprites':entries,'resources':paths,
              'hashes':{key:digest(destination/path) for key,path in paths.items()},
              'sourceProofSha256':digest(source/'proof.json'),'sourceInputs':receipt['inputs'],
              'packingInputs':{'assets/models/architecture/export_batch.py':digest(Path(__file__))},
              'sourceCoverage':source_coverage,
              'patternResources':resources,'catalogue':receipt['catalogue'],
              'budgets':{'starter':resource_budget(catalogue(),list(catalogue()['finishes']),width*height),
                         'expanded':resource_budget(fixture_catalogue(),['fixture.0','fixture.1'],width*height)},
              'reviewReceipt':'review.json'}
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (destination/'render-proof.json').write_bytes((source/'proof.json').read_bytes())
    print(json.dumps({'sprites':len(entries),'width':width,'height':height,'budgets':manifest['budgets']}))


if __name__=='__main__': run(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
