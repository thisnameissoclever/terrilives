"""Create labeled native-size evidence; originals remain untouched."""
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw


def run(source,destination,partial=False):
    proof=json.loads((source/'proof.json').read_text())
    assert proof['state']=='complete' or partial, 'incomplete source'
    destination.mkdir(parents=True,exist_ok=False)
    for model in range(1,10):
        records=[r for r in proof['renders'] if r.get('model')==model]
        board=Image.new('RGB',(720,500),(37,39,42)); draw=ImageDraw.Draw(board)
        draw.text((8,2),f'Window {model}'+(' - REJECTED PARTIAL BATCH' if partial else ' - SOURCE REVIEW'),fill='white')
        for i,record in enumerate(records):
            original=Image.open(source/record['color']).convert('RGBA')
            native=original.resize((original.width//2,original.height//2),Image.Resampling.LANCZOS)
            x=(i//2)*180; y=(i%2)*250
            board.paste(native,(x+10,y+20),native)
            draw.text((x+8,y+215),record['direction']+' '+record['heightMode'],fill='white')
        board.save(destination/f'window-{model}-native.png')
        original_board=Image.new('RGB',(1440,1000),(37,39,42)); labels=ImageDraw.Draw(original_board)
        labels.text((8,2),f'Window {model} - ORIGINAL RESOLUTION',fill='white')
        for i,record in enumerate(records):
            original=Image.open(source/record['color']).convert('RGBA')
            x=(i//2)*360; y=(i%2)*500
            original_board.paste(original,(x+20,y+40),original)
            labels.text((x+16,y+430),record['direction']+' '+record['heightMode'],fill='white')
        original_board.save(destination/f'window-{model}-original.png')
    for kind in ('junction','floor-patch','straight','doorway'):
        records=[r for r in proof['renders'] if r['kind']==kind]
        for page in range((len(records)+15)//16):
            group=records[page*16:(page+1)*16]
            board=Image.new('RGB',(1120,960),(37,39,42)); draw=ImageDraw.Draw(board)
            for i,record in enumerate(group):
                original=Image.open(source/record['color']).convert('RGBA')
                native=original.resize((original.width//2,original.height//2),Image.Resampling.LANCZOS)
                x=(i%4)*280; y=(i//4)*240
                board.paste(native,(x,y),native); draw.text((x+4,y+214),record['geometryKey'],fill='white')
            board.save(destination/f'{kind}-{page+1}-native.png')
    print('Review sheets:',destination)


if __name__=='__main__': run(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve(),'--partial' in sys.argv)
