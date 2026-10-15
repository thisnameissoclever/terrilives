"""Reject altered staged data entirely in memory; leave live and staged bytes intact."""
from pathlib import Path
import importlib.util
import json
import sys
import tomllib

import numpy as np

ROOT=Path(__file__).resolve().parents[4]
BASE=ROOT/'assets/models/sims/character-repair'
FOLDER=ROOT/'.scratch/book-preservation/dropped-book'
spec=importlib.util.spec_from_file_location('verify_assets',BASE/'verify_assets.py')
verify=importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)
atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text(encoding='utf-8'))
manifest=json.loads((FOLDER/'manifest.json').read_text(encoding='utf-8'))
first=manifest['states'][0]
ordinary_pages=verify.load_pages
ordinary_loads=json.loads
results=[]


def check(name, change_pages=None, change_manifest=None):
    def pages(folder, records):
        loaded=ordinary_pages(folder,records)
        if change_pages:
            loaded=[page.copy() for page in loaded]
            change_pages(records,loaded)
        return loaded

    def loads(*args,**kwargs):
        value=ordinary_loads(*args,**kwargs)
        if change_manifest and isinstance(value,dict) and value.get('representation')=='reconstructed-source-geometry':
            change_manifest(value)
        return value

    verify.load_pages=pages
    json.loads=loads
    try:
        verify.verify_dropped_book(FOLDER,atlas)
    except AssertionError as error:
        results.append(dict(control=name,rejected=True,message=str(error)))
    else:
        raise AssertionError('Deliberate defect passed: '+name)
    finally:
        verify.load_pages=ordinary_pages
        json.loads=ordinary_loads


def alter_pixel(records,pages,kind,channel):
    if not records[0]['path'].startswith(kind+'-'):
        return
    row=first[kind]
    page=pages[row['pageIndex']]
    crop=verify.crop(pages,row)
    y,x=np.argwhere(crop[:,:,3]>0)[0]
    page[row['y']+y,row['x']+x,channel]^=1 if channel!=3 else 255


verify.verify_dropped_book(FOLDER,atlas)
check('one-changed-published-color-byte',lambda rows,pages:alter_pixel(rows,pages,'color',0))
check('one-missing-covered-depth-pixel',lambda rows,pages:alter_pixel(rows,pages,'depth',3))
check('half-logical-pixel-registration-shift',change_manifest=lambda m:m['states'][0]['anchorOffset'].__setitem__(0,m['states'][0]['anchorOffset'][0]+.5))
check('replacement-color-flag',change_manifest=lambda m:m['states'][0].__setitem__('replacementColor',True))
check('changed-source-hash',change_manifest=lambda m:m['source'].__setitem__('sha256','0'*64))
check('changed-book-scale',change_manifest=lambda m:m['placement'].__setitem__('scale',1.01))
check('unsupported-floor-gap',change_manifest=lambda m:m['placement'].__setitem__('minimumFloorGap',.01))
report=dict(state='complete',scope='isolated-in-memory-negative-controls',controls=results)
(Path(__file__).parent/'negative-controls.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
