"""Import reviewed architecture as a separate logical suffix with paired textures."""
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
from PIL import Image, ImageChops

ROOT=Path(__file__).resolve().parents[3]
SOURCE=ROOT/'assets/models/architecture'
sys.path.insert(0,str(SOURCE))
from windows import MODELS, DIRECTIONS
from check_scene import validate_window_geometry
from materials import validate_catalogue, resource_budget


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def inside(base,name):
    path=(base/name).resolve()
    assert path.is_relative_to(base.resolve()), 'architecture resource escapes batch'
    return path


@dataclass
class ArchitectureExport:
    manifest: dict
    directory: Path
    window_ids: list
    widths: dict
    missing_directions: list
    depth_registration_errors: list


def validate_manifest(data,proof):
    assert data['schema']==proof['schema']==1, 'unsupported architecture schema'
    assert proof['state']=='complete' and proof['background'] is True, 'incomplete architecture batch'
    assert len(proof['renders'])==proof['expected_count']==174, 'incomplete architecture catalogue'
    assert set(proof['models'])=={str(i) for i in MODELS}, 'missing window model'
    for i,(_,width) in MODELS.items():
        record=proof['models'][str(i)]
        assert record['width']==width, 'window width changed'
        validate_window_geometry(i,record['parts'])
    expected={(i,d,h) for i in MODELS for d in DIRECTIONS for h in ('full','cut')}
    actual=set()
    for source in proof['renders']:
        assert source['normalChecks']>0, 'missing evaluated normal proof'
        if source['kind']=='window':
            key=(source['model'],source['direction'],source['heightMode'])
            assert key in expected and key not in actual, 'window direction changed'
            assert source['geometryKey']==f'window.{MODELS[key[0]][0]}.{key[1]}.{key[2]}', 'window direction changed'
            actual.add(key)
    assert actual==expected, 'missing window direction'
    assert len([r for r in proof['renders'] if r['kind']=='junction'])==80, 'missing junction height mask'
    source_by_name={r['geometryKey']:r for r in proof['renders']}
    assert len(source_by_name)==174, 'duplicate source geometry'
    w,h=data['width'],data['height']
    assert type(w) is int and type(h) is int and 0<w<=8192 and 0<h<=8192, 'architecture texture size limit'
    validate_catalogue(data['catalogue'],data['patternResources'],require_shipped=True)
    names=set(); coverage={}; rectangles=[]
    for entry in data['sprites']:
        assert entry['name'] not in names, 'duplicate architecture sprite'
        names.add(entry['name'])
        assert entry['source'] in source_by_name, 'unknown source geometry'
        source=source_by_name[entry['source']]
        assert entry['direction']==source['direction'], 'window direction changed'
        for key in ('x','y','w','h'):
            assert type(entry[key]) is int, 'invalid sprite rectangle'
        x,y,sw,sh=(entry[k] for k in ('x','y','w','h'))
        assert x>=0 and y>=0 and sw>0 and sh>0 and x+sw<=w and y+sh<=h, 'sprite outside architecture texture'
        for ax,ay,aw,ah in rectangles:
            assert x>=ax+aw or ax>=x+sw or y>=ay+ah or ay>=y+sh, 'overlapping texture rectangles'
        rectangles.append((x,y,sw,sh))
        assert entry['depthRegistration']=={k:entry[k] for k in ('x','y','w','h','origin','pixel_density')}, 'depth registration changed'
        assert entry['pixel_density']==2, 'texture density changed'
        crop=entry['sourceCrop']
        assert crop[2]-crop[0]==sw and crop[3]-crop[1]==sh, 'source crop dimensions changed'
        assert 0<=crop[0]<crop[2]<=source['widthPixels'] and 0<=crop[1]<crop[3]<=source['heightPixels'], 'source crop outside original'
        if entry['kind']!='floor-patch':
            assert entry['origin']==[source['origin'][0]-crop[0]/2,source['origin'][1]-crop[1]/2], 'sprite origin changed'
            assert entry['physicalBounds']==source['physicalBounds'], 'physical bounds changed'
        else:
            assert entry['origin']==[33,22] and entry['physicalBounds']==[[-.5,-.5,0],[.5,.5,0]], 'floor geometry changed'
        assert all(math.isfinite(n) for n in entry['origin']), 'invalid origin'
        assert entry['anchor']==[entry['origin'][0],entry['origin'][1]+21], 'anchor changed'
        owner=tuple(entry['ownedSpan']) if isinstance(entry['ownedSpan'],list) else entry['ownedSpan']
        source_owners=coverage.setdefault(entry['source'],set())
        assert owner not in source_owners, 'overlapping split ownership'
        source_owners.add(owner)
    assert set(coverage)==set(source_by_name), 'missing split source'
    for key,source in source_by_name.items():
        expected_owners=({(x,y) for y in range(4) for x in range(4)} if source['kind']=='floor-patch' else
                         {i for i,h in enumerate(source['armHeights']) if h} if source['kind']=='junction' else
                         set(range(source['width'])) if source['kind']=='window' else {0})
        assert coverage[key]==expected_owners, 'incomplete split ownership'
    return source_by_name


def validate_pixels(data,directory):
    paths={key:inside(directory,name) for key,name in data['resources'].items()}
    for key,path in paths.items(): assert digest(path)==data['hashes'][key], 'architecture texture hash changed'
    color=Image.open(paths['color']).convert('RGBA'); carrier=Image.open(paths['carrier']).convert('RGBA')
    assert color.size==carrier.size==(data['width'],data['height']), 'paired color dimensions changed'
    depth=paths['depth'].read_bytes(); roles=paths['roles'].read_bytes()
    assert len(depth)==data['width']*data['height']*2 and len(roles)==data['width']*data['height'], 'paired depth dimensions changed'
    assert all((bits[0]&0x7c00)!=0x7c00 for bits in struct.iter_unpack('<H',depth)), 'nonfinite architecture depth'
    assert set(roles)<=set(range(6)), 'unknown material role'
    source_images={}
    for entry in data['sprites']:
        x,y,w,h=(entry[k] for k in ('x','y','w','h'))
        image=color.crop((x,y,x+w,y+h)); alpha=image.getchannel('A')
        mask=Image.frombytes('L',(data['width'],data['height']),roles).crop((x,y,x+w,y+h))
        occupied=alpha.point(lambda a:255 if a else 0)
        assert ImageChops.multiply(occupied,mask.point(lambda r:255 if not r else 0)).getbbox() is None, 'visible texel missing role'
        if entry['kind']=='floor-patch': continue
        key=entry['source']; source=data['sourceCoverage'][key]
        if key not in source_images: source_images[key]=Image.new('RGBA',(source['width'],source['height']))
        restored=source_images[key]; crop=entry['sourceCrop']
        assert ImageChops.multiply(restored.crop(crop).getchannel('A'),alpha).getbbox() is None, 'overlapping split pixels'
        # Copy only owned pixels, without multiplying straight alpha twice.
        restored.paste(image,(crop[0],crop[1]),occupied)
    for key,image in source_images.items():
        assert hashlib.sha256(image.tobytes()).hexdigest()==data['sourceCoverage'][key]['rgba_sha256'], 'split reconstruction changed source pixels'
    for resource in data['patternResources'].values():
        path=inside(directory,resource['file'])
        assert digest(path)==resource['sha256'], 'pattern resource hash changed'
        with Image.open(path) as image:
            assert image.size==(resource['width'],resource['height']), 'pattern resource dimensions changed'


def load_reviewed_architecture(catalog_path=None, *, require_review=True):
    config=json.loads(Path(catalog_path or SOURCE/'architecture.json').read_text())
    directory=inside(SOURCE,config['batch'])
    data=json.loads((directory/'manifest.json').read_text())
    proof=json.loads((directory/'render-proof.json').read_text())
    validate_manifest(data,proof)
    assert digest(directory/'render-proof.json')==data['sourceProofSha256'], 'source receipt hash changed'
    for path,want in {**data['sourceInputs'],**data['packingInputs']}.items():
        assert digest(inside(ROOT,path))==want, 'architecture source hash changed'
    validate_pixels(data,directory)
    if require_review:
        review=json.loads((directory/'review.json').read_text())
        assert review['status']=='accepted' and review['independent'] is True, 'architecture independent review pending'
        assert review['manifestSha256']==digest(directory/'manifest.json'), 'reviewed manifest changed'
    return ArchitectureExport(data,directory,list(MODELS),{i:v[1] for i,v in MODELS.items()},[],[])


def generated_files(batch,historical_count):
    data=batch.manifest
    resources={key:f"architecture-{sha}.{ 'png' if key in ('color','carrier') else 'r16f' if key=='depth' else 'r8'}" for key,sha in data['hashes'].items()}
    patterns={key:{**value,'url':f"architecture-pattern-{value['sha256']}.png"} for key,value in data['patternResources'].items() if value['shipped']}
    validate_catalogue(data['catalogue'],patterns,require_shipped=True)
    descriptor={'schema':1,'baseSpriteId':historical_count,'width':data['width'],'height':data['height'],
                'resources':resources,'hashes':data['hashes'],'patterns':patterns,'catalogue':data['catalogue'],
                'budgets':data['budgets'],
                'finishContract':{'roleIds':{'wall':1,'floor':2,'frame':3,'glazing':4,'trim':5},
                                  'patternColorSpace':'linear','patternRowOrigin':'lower-left',
                                  'patternWorldOffset':[.5,.5],'nearestSampling':True,
                                  'maxResidentPatterns':12,'reservedTextureBindings':4,
                                  'contentLook':'relative-to-authoredContentLook'},
                'sprites':[{**entry,'id':historical_count+i} for i,entry in enumerate(data['sprites'])]}
    text='// GENERATED by assets/sprites/gen/build.py. Do not edit by hand.\n'
    text+='// Logical suffix after the complete historical atlas; separate texture coordinates.\n'
    text+='export const ARCHITECTURE = '+json.dumps(descriptor,indent=2)+' as const;\n'
    result={ROOT/'web/src/render/architecture-data.ts':text.encode()}
    # Only identities present in the reviewed floor sources describe baked pixels.
    # The live catalogue may later append finishes without adding geometry.
    floor_patterns=sorted({entry['patternKey'] for entry in data['sprites'] if entry['kind']=='floor-patch'})
    baked={key:{'finish':data['catalogue']['finishes'][key],
                'pattern':data['catalogue']['patterns'][key],
                'patternSha256':data['patternResources'][data['catalogue']['patterns'][key]['resource']]['sha256'],
                'palette':data['catalogue']['palettes'][data['catalogue']['finishes'][key]['paletteKey']]}
           for key in floor_patterns}
    receipt={'manifestSha256':digest(batch.directory/'manifest.json'),
             'colorSha256':data['hashes']['color'],'finishes':baked}
    baked_text='// GENERATED from the accepted architecture export. Do not edit by hand.\n'
    baked_text+='// Independent baked-pixel identities; never derive these from the live catalogue.\n'
    baked_text+='export const BAKED_FLOORS = '+json.dumps(receipt,indent=2)+' as const;\n'
    result[ROOT/'web/src/render/architecture-baked-floors.ts']=baked_text.encode()
    for key,name in resources.items(): result[ROOT/'web/public'/name]=(batch.directory/data['resources'][key]).read_bytes()
    for key,resource in patterns.items(): result[ROOT/'web/public'/resource['url']]=(batch.directory/resource['file']).read_bytes()
    return result


def load_historical_extensions(config, existing_names=frozenset()):
    """Load pinned reviewed imports after the immutable released prefix."""
    from offline_props import load_props
    result = []
    names = set(existing_names)
    catalogs = set()
    for extension in config.get('historicalExtensions', []):
        path = inside(ROOT, extension['catalog'])
        assert path not in catalogs, 'duplicate architecture extension catalog'
        catalogs.add(path)
        data = json.loads(path.read_text())
        canonical = json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        assert hashlib.sha256(canonical).hexdigest() == extension['canonicalSha256'], 'architecture extension catalog changed'
        if extension.get('kind', 'static') == 'covered-bunk':
            from offline_covered_bunk import load_covered_bunk, records
            sprites = records(load_covered_bunk(path))
            assert not names.intersection(row[0] for row in sprites), 'duplicate covered-bunk records'
        elif extension.get('kind', 'static') == 'static':
            sprites, _, _, _ = load_props(path, existing_names=names)
        else:
            raise ValueError('Unknown reviewed atlas extension kind')
        result.extend(sprites)
        names.update(sprite[0] for sprite in sprites)
    return result


def validate_historical_sprites(sprites, config, extensions):
    """Keep the released prefix exact and require an independently reviewed tail."""
    count = config['historicalCount']
    assert len(sprites) == count + len(extensions), 'complete historical atlas length changed'
    prefix=hashlib.sha256()
    for name,image,w,h in sprites[:count]:
        prefix.update(name.encode()+b'\0'+struct.pack('<II',w,h)+image.tobytes())
    assert prefix.hexdigest()==config['historicalPrefixSha256'], 'complete historical atlas prefix changed'
    for actual, expected in zip(sprites[count:], extensions):
        assert (actual[0], actual[2], actual[3], actual[1].mode, actual[1].tobytes()) == (
            expected[0], expected[2], expected[3], expected[1].mode, expected[1].tobytes()), 'reviewed atlas extension changed'


def sync_generated_architecture(historical_sprites, *, check):
    config=json.loads((SOURCE/'architecture.json').read_text())
    extensions = load_historical_extensions(config,
        {sprite[0] for sprite in historical_sprites[:config['historicalCount']]})
    validate_historical_sprites(historical_sprites, config, extensions)
    batch=load_reviewed_architecture()
    for path,want in generated_files(batch,len(historical_sprites)).items():
        if check:
            assert path.is_file() and path.read_bytes()==want, f'generated architecture stale: {path}'
        else:
            path.write_bytes(want)
    print(f"architecture is {'up to date' if check else 'generated'}: {len(batch.manifest['sprites'])} logical records after {len(historical_sprites)} historical records")
