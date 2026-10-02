"""Prove the requested door revision preserves every other historical sprite."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
from PIL import Image
import build
import door_assets

ROOT=Path(build.ROOT)


def git_bytes(revision,path):
    return subprocess.check_output(['git','show',revision+':'+path],cwd=ROOT)


def prefix(sprites):
    digest=hashlib.sha256()
    for name,image,w,h in sprites:
        digest.update(name.encode()+b'\0'+struct.pack('<II',w,h)+image.tobytes())
    return digest.hexdigest()


def baseline_doors(revision):
    source=ROOT/'assets/models/doors/export'
    manifest_bytes=git_bytes(revision,'assets/models/doors/export/manifest.json')
    assert manifest_bytes==(source/'manifest.json').read_bytes(), 'preserved baseline door manifest changed'
    manifest=json.loads(manifest_bytes)
    for relative,want in manifest['inputs'].items():
        assert hashlib.sha256(git_bytes(revision,'assets/models/'+relative)).hexdigest()==want, 'baseline door provenance changed'
    result=[]
    for record in manifest['records']:
        for suffix in ('','Depth'):
            path=source/(record['name']+suffix+'.png')
            assert hashlib.sha256(path.read_bytes()).hexdigest()==record['sha256'][suffix], 'baseline door pixels changed'
            image=Image.open(path).convert('RGBA')
            result.append((record['name']+suffix,image,*image.size))
    assert len(result)==80
    return result


def capture(door_records=None):
    class Captured(Exception): pass
    original_sync=build.sync_generated_architecture
    original_doors=door_assets.records
    original_argv=sys.argv
    result=[]
    def stop(sprites,**kwargs):
        for name,image,w,h in sprites:
            result.append((name,w,h,hashlib.sha256(image.tobytes()).hexdigest()))
        capture.prefix = prefix(sprites)
        capture.original1700 = prefix(sprites[:1700])
        raise Captured()
    try:
        build.sync_generated_architecture=stop
        if door_records is not None: door_assets.records=lambda:door_records
        sys.argv=['build.py']
        try: build.main()
        except Captured: pass
        assert result, 'generator did not reach historical boundary'
    finally:
        build.sync_generated_architecture=original_sync
        door_assets.records=original_doors
        sys.argv=original_argv
    return result


def run(revision,output):
    old=capture(baseline_doors(revision))
    old_prefix=capture.prefix
    old_original1700=capture.original1700
    new=capture()
    new_prefix=capture.prefix
    new_original1700=capture.original1700
    original_config=json.loads(git_bytes(revision,'assets/models/architecture/architecture.json'))
    assert len(old)==len(new)==original_config['historicalCount']
    assert old_prefix==original_config['historicalPrefixSha256'], 'baseline generation differs from committed prefix'
    changed=[]
    for index,(before,after) in enumerate(zip(old,new)):
        assert before[:3]==after[:3], 'historical identity or dimensions changed'
        if before[3]!=after[3]:
            changed.append({'id':index,'name':before[0],
                'beforeRGBA':before[3],
                'afterRGBA':after[3]})
    expected={name for name,_,_,_ in baseline_doors(revision)}
    assert {r['name'] for r in changed}==expected, 'unexpected historical pixel changes or unchanged requested door record'
    assert old_original1700==new_original1700, 'original 1700 pixels changed'
    result={'baselineRevision':revision,'historicalCount':len(new),'oldPrefixSha256':old_prefix,
        'newPrefixSha256':new_prefix,'original1700Sha256':new_original1700,
        'changedRecords':changed,'onlyExpectedDoorChanges':True,
        'baselineDescriptorSha256':hashlib.sha256(git_bytes(revision,'assets/models/architecture/architecture.json')).hexdigest(),
        'selectedDoorManifestSha256':hashlib.sha256((door_assets.BASE/'manifest.json').read_bytes()).hexdigest()}
    output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='changedRecords'},indent=2))


if __name__=='__main__': run(sys.argv[1],Path(sys.argv[2]).resolve())
