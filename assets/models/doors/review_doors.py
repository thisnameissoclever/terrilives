"""Create native door source sheets without changing candidate render bytes."""
import hashlib
import json
from pathlib import Path
import sys
from PIL import Image,ImageDraw


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def run(source,destination):
    status=json.loads((source/'status.json').read_text())
    manifest=json.loads((source/'manifest.json').read_text())
    assert status['state']=='complete' and status['background'] and len(manifest['records'])==40
    destination.mkdir(parents=True,exist_ok=False)
    sheets=[]
    for facing in range(4):
        records=[r for r in manifest['records'] if r['facing']==facing]
        native=Image.new('RGB',(1200,155),(37,39,42)); labels=ImageDraw.Draw(native)
        original=Image.new('RGB',(3600,465),(37,39,42)); original_labels=ImageDraw.Draw(original)
        for i,record in enumerate(records):
            path=source/(record['name']+'.png')
            assert digest(path)==record['sha256']['']
            image=Image.open(path).convert('RGBA')
            small=image.resize((112,120),Image.Resampling.LANCZOS)
            native.paste(small,(i*120,20),small); labels.text((i*120+2,2),record['name'],fill='white')
            original.paste(image,(i*360,60),image); original_labels.text((i*360+6,6),record['name'],fill='white')
        for suffix,image in (('native',native),('original',original)):
            path=destination/f'orientation-{facing}-{suffix}.png';image.save(path)
            sheets.append({'file':path.name,'sha256':digest(path)})
    (destination/'source-review.json').write_text(json.dumps({'manifestSha256':digest(source/'manifest.json'),
        'statusSha256':digest(source/'status.json'),'sheets':sheets,'dimensions':manifest['authoredDimensions']},indent=2)+'\n')


if __name__=='__main__': run(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
