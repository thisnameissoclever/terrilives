"""Draw exact exported fixture states beside the unchanged published references."""
from pathlib import Path
import json
import tomllib
import numpy as np
from PIL import Image, ImageDraw

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[3]


def read_pages(folder, rows):
    return [Image.frombytes('RGBA',(row['width'],row['height']),(folder/row['path']).read_bytes()) for row in rows]


def from_record(pages,row):
    return pages[row['pageIndex']].crop((row['x'],row['y'],row['x']+row['w'],row['y']+row['h']))


def main():
    atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    folder=BASE/'components'
    manifest=json.loads((folder/'manifest.json').read_text())
    pages=read_pages(folder,manifest['colorPages'])
    canvas=Image.new('RGB',(4*350,4*390),'#e8e4dc')
    draw=ImageDraw.Draw(canvas)
    for row_index,(family,state) in enumerate([('fridge','open'),('bike','3'),('bed','cover-removed'),('bunk','cover-removed')]):
        for column,facing in enumerate(['SE','NW','SW','NE']):
            record=next(row for row in manifest['states'] if row['family']==family and row['state']==state and row['facing']==facing)
            image=from_record(pages,record['color'])
            x,y=column*350,row_index*390
            draw.text((x+12,y+10),family+' '+facing+' '+state,fill='#292621')
            canvas.paste(image,(x+(350-image.width)//2,y+40),image)
    canvas.save(BASE/'fixture-state-review.png')
    folder=BASE/'dropped-book'
    if not (folder/'manifest.json').exists():return
    manifest=json.loads((folder/'manifest.json').read_text())
    if manifest['state']!='complete':return
    pages=read_pages(folder,manifest['colorPages'])
    canvas=Image.new('RGB',(4*340,2*440),'#e8e4dc')
    draw=ImageDraw.Draw(canvas)
    for column,record in enumerate(manifest['states']):
        source=atlas['sprite'][record['atlasIndex']]
        page=Image.open(ROOT/'web/public'/atlas['pages'][source.get('page',0)]).convert('RGBA')
        original=page.crop((source['x'],source['y'],source['x']+source['w'],source['y']+source['h']))
        old=Image.new('RGBA',(192,240))
        ox,oy=[round(v*2) for v in record['anchorOffset']]
        old.paste(original,(ox,oy))
        for row_index,(label,image) in enumerate([('Published reference',old),('Reconstructed geometry',from_record(pages,record['color']))]):
            alpha=image.getchannel('A').getbbox()
            x,y=column*340,row_index*440
            draw.text((x+10,y+12),record['facing']+' '+label,fill='#292621')
            art=image.crop(alpha).resize((max(1,(alpha[2]-alpha[0])*6),max(1,(alpha[3]-alpha[1])*6)),Image.Resampling.NEAREST)
            canvas.paste(art,(x+(340-art.width)//2,y+80),art)
    canvas.save(BASE/'dropped-book-before-after.png')


if __name__=='__main__':main()
