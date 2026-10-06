"""Export registered center-reader layers only after successful writers and fidelity checks."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image,ImageChops

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
sys.path[:0]=[str(ROOT/'assets/models/seating'),str(ROOT/'assets/models/bedroom')]
from seat_export_contract import encode_scene,reference_beauty,premultiplied_display
from double_bed_linear import reconstruct
from double_bed_layers import comparison


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(source):
    source=Path(source).resolve();output=source/'export'
    physical=json.loads((source/'physical-proof.json').read_text());canvas=physical['canvas']
    if output.exists():
        raise ValueError('Preserve prior reader export')
    receipts={};inputs={str(Path(__file__).resolve()):digest(Path(__file__).resolve())}
    for facing in ('SE','NW','SW','NE'):
        directory=source/facing
        process=json.loads((directory/'render-process-exit.json').read_text(encoding='utf-8-sig'))
        receipt=json.loads((directory/'raw/proof.json').read_text())
        if process['exit_code']!=0 or not process['actual_handle_retained'] or not process['inputs_unchanged'] or process['stop_reason'] is not None or receipt['state']!='complete' or len(receipt['renders'])!=9:
            raise ValueError('Reader source writer did not finish: '+facing)
        receipts[facing]=receipt
        for path in (directory/'raw/proof.json',directory/'render-process-exit.json',source/'physical-proof.json'):
            inputs[str(path)]=digest(path)
        for path,sha in receipt['inputs'].items():
            if digest(path)!=sha:
                raise ValueError('Reader source input changed: '+path)
            inputs[path]=sha
    output.mkdir();textures=output/'textures';textures.mkdir()
    manifest=dict(version=2,state='complete_subset',importable=True,encoding='scene-linear-premultiplied-visible-additive',pixelDensity=2,
        content=physical['content'],stage=physical['stage'],stableSeatIds=['whole_sofa'],action='recline',exclusive=True,
        layerOrder=['furniture','body0','body1','body2','sharedInk'],palettes=['green','blue','red'],
        phases=dict(count=4,cycleTicks=16,phaseTicks=[0,4,8,12],sourceAliases=[0,0,0,0],reducedMotionFrame=0),
        scope='Complete four-facing exclusive whole-sofa recline contact seed, full-size existing rig and unchanged furniture; four exact static aliases; runtime review pending',
        physicalReceipt=dict(path='../physical-proof.json',sha256=digest(source/'physical-proof.json')),records=[],inputs=inputs,comparisons=[])
    saved={}
    def put(image):
        bounds=image.getchannel('A').getbbox()
        if bounds:
            left,top,right,bottom=bounds
            crop=(max(0,left-1),max(0,top-1),min(image.width,right+1),min(image.height,bottom+1))
            cropped=image.crop(crop)
        else:
            crop=(0,0,1,1);cropped=Image.new('RGBA',(1,1))
        key=(cropped.mode,cropped.size,hashlib.sha256(cropped.tobytes()).hexdigest())
        if key not in saved:
            path=textures/(f'{cropped.width}x{cropped.height}-'+key[2]+'.png');cropped.save(path)
            saved[key]=dict(path=str(path.relative_to(output)).replace('\\','/'),sha256=digest(path),pixelsSha256=key[2],width=cropped.width,height=cropped.height)
        return dict(**saved[key],trim=[crop[0]/2,crop[1]/2,cropped.width/2,cropped.height/2],rawCrop=list(crop),canvas=[image.width/2,image.height/2])
    for facing,receipt in receipts.items():
        directory=source/facing/'raw';rows={(r['palette'],r['owner']):r for r in receipt['renders']}
        def read(palette,owner):
            row=rows[palette,owner];path=directory/row['path']
            if digest(path)!=row['sha256']:
                raise ValueError('Reader render changed')
            inputs[str(path)]=row['sha256']
            with Image.open(path) as image:
                if image.mode!='RGBA' or image.size!=tuple(v*8 for v in canvas):
                    raise ValueError('Reader raw registration changed')
                return image.copy()
        furniture=read('green','furniture');ink=read('green','sharedInk');body_ink=read('green','bodyInk')
        if ImageChops.subtract(body_ink.getchannel('A'),ink.getchannel('A')).getbbox():
            raise ValueError('Body-owned ink exceeds shared ink')
        size=tuple(v*2 for v in canvas);blank=Image.new('RGBA',size);empty_ref=put(blank)
        baseline_alpha=None
        for palette in ('green','blue','red'):
            body=read(palette,'body');beauty=read(palette,'beauty')
            alpha=body.getchannel('A').tobytes()
            if baseline_alpha is None:
                baseline_alpha=alpha
            elif alpha!=baseline_alpha:
                raise ValueError('Palette changed visible reader geometry')
            edge=beauty.getchannel('A')
            if any(edge.crop(box).getbbox() for box in ((0,0,canvas[0]*8,1),(0,canvas[1]*8-1,canvas[0]*8,canvas[1]*8),(0,0,1,canvas[1]*8),(canvas[0]*8-1,0,canvas[0]*8,canvas[1]*8))):
                raise ValueError('Reader source canvas clips visible pixels')
            encoded=encode_scene(dict(sim=body,furniture=furniture,lines=ink),size)
            actual=reconstruct([encoded['furniture'],encoded['sim'],encoded['lines']])
            reference=reference_beauty(beauty,size)
            metrics=comparison(premultiplied_display(reference),premultiplied_display(actual),[encoded['furniture'],encoded['sim']])
            if metrics['scene']['max_error']>6 or metrics['scene']['p95_error']>2:
                raise ValueError('Reader layer reconstruction exceeds unchanged six/two gates: '+str(metrics))
            manifest['comparisons'].append(dict(facing=facing,palette=palette,**metrics))
            mask=ImageChops.add(encoded['sim'].getchannel('A'),body_ink.getchannel('A').resize(size,Image.Resampling.BOX))
            coverage=Image.merge('RGBA',(Image.new('L',size),Image.new('L',size),Image.new('L',size),mask))
            whole=ImageChops.add(ImageChops.add(encoded['sim'].getchannel('A'),encoded['furniture'].getchannel('A')),encoded['lines'].getchannel('A'))
            full=Image.merge('RGBA',(Image.new('L',size),Image.new('L',size),Image.new('L',size),whole))
            layers=[put(encoded['furniture']),put(encoded['sim']),empty_ref,empty_ref,put(encoded['lines'])]
            owner=dict(stableSeatId='whole_sofa',coverage=put(coverage),marker=receipt['marker'])
            for frame in range(4):
                manifest['records'].append(dict(facing=facing,frame=frame,paletteIndices=[['green','blue','red'].index(palette)],
                    emptyFurnitureKey=physical['content']+'/'+facing,sprite=None,canvas=receipt['canvas'],anchor=receipt['anchor'],
                    layers=layers,alphaCoverage=put(full),owners=[owner],sourceFrame=0))
    manifest['uniqueTextureCount']=len(saved)
    if any(digest(path)!=sha for path,sha in inputs.items()):
        raise ValueError('Reader export input changed')
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(manifest=str(output/'manifest.json'),records=len(manifest['records']),uniqueTextures=len(saved),
        maximumError=max(r['scene']['max_error'] for r in manifest['comparisons']),p95=max(r['scene']['p95_error'] for r in manifest['comparisons']))))


if __name__=='__main__':
    run(sys.argv[1])
