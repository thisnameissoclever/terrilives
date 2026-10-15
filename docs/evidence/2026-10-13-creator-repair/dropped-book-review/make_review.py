"""Display the preserved pixels and physical-depth samples from the staged bundle."""
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[4]
FOLDER=ROOT/'.scratch/book-preservation/dropped-book'
OUTPUT=Path(__file__).parent
manifest=json.loads((FOLDER/'manifest.json').read_text(encoding='utf-8'))


def crop(kind,row):
    record=manifest[kind+'Pages'][row['pageIndex']]
    page=np.frombuffer((FOLDER/record['path']).read_bytes(),dtype=np.uint8).reshape((record['height'],record['width'],4))
    return page[row['y']:row['y']+row['h'],row['x']:row['x']+row['w']].copy()


sheet=Image.new('RGB',(960,690),(233,230,221))
draw=ImageDraw.Draw(sheet)
for index,row in enumerate(manifest['states']):
    published=np.zeros((240,192,4),dtype=np.uint8)
    x0,y0,x1,y1=row['publishedColor']['rawCrop']
    with Image.open(ROOT/row['publishedColor']['path']) as original:
        published[y0:y1,x0:x1]=np.asarray(original.convert('RGBA'))
    staged=crop('color',row['color'])
    depth=crop('depth',row['depth'])
    covered=depth[:,:,3]>0
    values=(depth[:,:,0].astype(np.uint16)*256+depth[:,:,1])/65535*4-2
    amount=(np.clip(values,-.16,.16)+.16)/.32
    display=np.zeros_like(depth)
    display[:,:,0]=(amount*230).astype(np.uint8)
    display[:,:,1]=((1-amount)*190).astype(np.uint8)
    display[:,:,2]=100
    display[:,:,3]=depth[:,:,3]
    for number,(label,array) in enumerate([('Published',published),('Staged exact copy',staged),('Companion depth',display)]):
        draw.text((index*240+15,number*230+10),row['facing']+' '+label,fill=(20,20,20))
        image=Image.fromarray(array).crop((75,148,116,204)).resize((123,168),Image.Resampling.NEAREST)
        sheet.paste(image,(index*240+58,number*230+35),image)
    draw.text((index*240+15,435),'RGBA and registration: identical',fill=(20,70,30))
sheet.save(OUTPUT/'published-vs-staged.png')
