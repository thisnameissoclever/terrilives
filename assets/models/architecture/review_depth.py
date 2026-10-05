"""Compare immutable baseline and matching-depth source renders at native size."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image, ImageDraw


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(baseline, candidate, destination):
    proof=json.loads((candidate/'proof.json').read_text())
    assert proof['state']=='complete' and len(proof['renders'])==proof['expected_count']
    destination.mkdir(parents=True,exist_ok=False)
    results=[]
    for record in proof['renders']:
        old=Image.open(baseline/record['color']).convert('RGBA')
        new=Image.open(candidate/record['color']).convert('RGBA')
        assert new.size==old.size
        board=Image.new('RGB',(400,235),(37,39,42)); labels=ImageDraw.Draw(board)
        labels.text((8,3),record['geometryKey'],fill='white')
        labels.text((8,20),'Before: wall .12',fill='white'); labels.text((208,20),'After: wall .14',fill='white')
        for image,x in ((old,8),(new,208)):
            native=image.resize((image.width//2,image.height//2),Image.Resampling.LANCZOS)
            board.paste(native,(x,35),native)
        path=destination/(record['geometryKey']+'.png'); board.save(path)
        board.resize((1200,705),Image.Resampling.NEAREST).save(destination/(record['geometryKey']+'-3x.png'))
        results.append({'geometryKey':record['geometryKey'],'baselineColorSha256':digest(baseline/record['color']),
            'candidateColorSha256':digest(candidate/record['color']),'sheetSha256':digest(path),
            'physicalBounds':record['physicalBounds']})
    (destination/'comparison.json').write_text(json.dumps({'sourceProofSha256':digest(candidate/'proof.json'),'records':results},indent=2)+'\n')


if __name__=='__main__': run(*(Path(arg).resolve() for arg in sys.argv[1:4]))
