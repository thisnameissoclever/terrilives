"""Check exported bytes against published colors, registrations, and source hashes."""
from pathlib import Path
import argparse
import hashlib
import json
import tomllib

import numpy as np
from PIL import Image

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[3]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_pages(folder, records):
    pages=[]
    for record in records:
        path=folder/record['path']
        assert digest(path)==record['sha256'],path
        pixels=np.frombuffer(path.read_bytes(),dtype=np.uint8).reshape((record['height'],record['width'],4))
        pages.append(pixels)
    return pages


def crop(pages, row):
    return pages[row['pageIndex']][row['y']:row['y']+row['h'],row['x']:row['x']+row['w']]


def verify_dropped_book(folder, atlas):
    dropped=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    assert dropped['state']=='complete'
    assert dropped['representation']=='reconstructed-source-geometry'
    assert dropped['colorPreservation']=='exact-published-rgba'
    assert dropped['originalSurfaceRecovered'] is False
    assert digest(ROOT/dropped['source']['path'])==dropped['source']['sha256']
    assert digest(folder/dropped['model']['path'])==dropped['model']['sha256']
    assert digest(ROOT/dropped['comparison']['path'])==dropped['comparison']['sha256']
    for key in ['physicalReceipt','cameraSource']:
        assert digest(ROOT/dropped[key]['path'])==dropped[key]['sha256'],key
    for key in ['fitGeometry','fitResult']:
        assert digest(folder/dropped[key]['path'])==dropped[key]['sha256'],key
    for name,sha in dropped['producerHashes'].items():
        assert digest(BASE/name)==sha,name
    placement=dropped['placement']
    assert placement['scale']==1 and placement['floorGap']==.0005
    assert abs(placement['minimumFloorGap']-.0005)<1e-6
    assert placement['twiceSupportArea']>0 and placement['maximumShapeError']<1e-6
    assert len(dropped['sourceParts'])==14
    assert dropped['fit']['method']=='all-four-complete-alpha-masks'
    assert dropped['fit']['translationOptimized'] is False
    assert dropped['fit']['alphaAbsoluteDifference']<dropped['fit']['priorWidthHeightFit']['alphaAbsoluteDifference']
    support=dropped['outlineSupport']
    assert support['lanczosRadiusPixels']==3
    assert support['maximumDistancePixels']==support['lanczosRadiusPixels']+support['pixelCenterRadius']+support['halfStrokePixels']
    colors=load_pages(folder,dropped['colorPages'])
    depths=load_pages(folder,dropped['depthPages'])
    published=json.loads((ROOT/dropped['comparison']['path']).read_text(encoding='utf-8'))
    originals={row['facing']:row for row in published['records']}
    assert len(dropped['states'])==4
    assert {row['facing'] for row in dropped['states']}=={'SE','NW','SW','NE'}
    checks=[]
    for row in dropped['states']:
        color,depth=crop(colors,row['color']),crop(depths,row['depth'])
        original=originals[row['facing']]['sprite']
        source=atlas['sprite'][row['atlasIndex']]
        assert source['name']=='ownedDroppedBook'+row['facing']
        assert [source['w'],source['h']]==[original['width'],original['height']]
        assert row['pixelDensity']==2
        assert row['anchorOffset']==original['trim'][:2]
        assert row['publishedColor']['rawCrop']==original['rawCrop']
        assert not row['replacementColor'] and row['actorFree']
        assert row['publishedColorMaxDifference']==0
        image_path=ROOT/row['publishedColor']['path']
        assert digest(image_path)==original['sha256']==row['publishedColor']['sha256']
        with Image.open(image_path) as image:
            pixels=np.asarray(image.convert('RGBA'))
        assert hashlib.sha256(pixels.tobytes()).hexdigest()==original['pixelsSha256']==row['publishedColor']['pixelsSha256']
        expected=np.zeros((240,192,4),dtype=np.uint8)
        x0,y0,x1,y1=original['rawCrop']
        assert [x0,y0]==[value*row['pixelDensity'] for value in row['anchorOffset']]
        expected[y0:y1,x0:x1]=pixels
        assert np.array_equal(color,expected),row['id']+' changed published RGBA or registration'
        with Image.open(ROOT/'web/public'/atlas['pages'][source.get('page',0)]) as image:
            atlas_pixels=np.asarray(image.convert('RGBA'))
            atlas_pixels=atlas_pixels[source['y']:source['y']+source['h'],source['x']:source['x']+source['w']]
            assert np.array_equal(atlas_pixels,pixels),row['id']+' changed published atlas pixels'
        covered=color[:,:,3]>0
        assert np.array_equal(covered,depth[:,:,3]>0)
        assert np.count_nonzero(covered)==row['opaquePixels']>0
        assert row['minSum']<row['maxSum']
        assert row['maxOutlineDistancePixels']<=support['maximumDistancePixels']
        values=(depth[:,:,0].astype(np.uint16)*256+depth[:,:,1])/65535*4-2
        assert abs(values[covered].min()-row['minSum'])<=4/65535
        assert abs(values[covered].max()-row['maxSum'])<=4/65535
        checks.append(dict(facing=row['facing'],coveredPixels=row['opaquePixels'],exactPublishedRgba=True,
                           exactAtlasRgba=True,exactRegistration=True,exactDepthCoverage=True,
                           maxGeometryDistancePixels=row['maxOutlineDistancePixels']))
    return dict(bundle='dropped-book',states=4,geometry='retained-canonical-source-at-scale-one',
                originalSceneRecovered=False,originalSurfaceRecovered=False,colors='exact-published-rgba',facings=checks)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dropped-book-only',action='store_true')
    parser.add_argument('--dropped-book-folder',type=Path,default=BASE/'dropped-book')
    parser.add_argument('--output',type=Path,default=BASE/'verification.json')
    args=parser.parse_args()
    atlas=tomllib.loads((ROOT/'assets/sprites/atlas.toml').read_text())
    if args.dropped_book_only:
        report=dict(state='complete',checks=[verify_dropped_book(args.dropped_book_folder,atlas)])
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print(json.dumps(report))
        return
    atlas_pages={}
    checks=[]
    seen=set()
    for bundle in ['fixture-depth','aquarium-depth','outdoor-depth']:
        folder=BASE/bundle
        manifest=json.loads((folder/'manifest.json').read_text())
        assert manifest['state']=='complete',bundle
        assert digest(ROOT/'assets/sprites/atlas.toml')==manifest['atlasSha256']
        for source in manifest['sources'].values():
            assert digest(ROOT/source['path'])==source['sha256'],source['path']
        for source,sha in manifest['coverageSources'].items():
            assert digest(ROOT/source)==sha,source
        pages=load_pages(folder,manifest['pages'])
        for row in manifest['sprites']:
            index=row['atlasIndex']
            assert index not in seen,index
            seen.add(index)
            source=atlas['sprite'][index]
            assert source['name']==row['name']
            assert [source['w'],source['h']]==[row['w'],row['h']]
            page_index=source.get('page',0)
            if page_index not in atlas_pages:
                atlas_pages[page_index]=np.asarray(Image.open(ROOT/'web/public'/atlas['pages'][page_index]).convert('RGBA'))
            pixels=atlas_pages[page_index][source['y']:source['y']+source['h'],source['x']:source['x']+source['w']]
            depth=crop(pages,row)
            assert np.array_equal(depth[:,:,3]>0,pixels[:,:,3]>0),row['name']
            values=(depth[:,:,0].astype(np.uint16)*256+depth[:,:,1])/65535*4-2
            covered=pixels[:,:,3]>0
            assert np.ptp(values[covered])>.0001,row['name']
            assert abs(values[covered].min()-row['minSum'])<=4/65535
            assert abs(values[covered].max()-row['maxSum'])<=4/65535
            assert int(covered.sum())==row['coveredPixels']
        checks.append(dict(bundle=bundle,sprites=len(manifest['sprites']),pages=len(pages),coverage='all-nonzero-alpha-exact',sourceHashes='unchanged'))
    folder=BASE/'shelf-depth'
    shelf=json.loads((folder/'manifest.json').read_text())
    assert shelf['state']=='complete'
    assert digest(ROOT/shelf['inventoryManifest']['path'])==shelf['inventoryManifest']['sha256']
    pages=load_pages(folder,shelf['pages'])
    assert set(shelf['facings'])=={'SE','NW','SW','NE'}
    for facing,row in shelf['facings'].items():
        assert [slot['slot'] for slot in row['slots']]==list(range(24))
        shell=crop(pages,row['shell'])
        assert (shell[:,:,3]>0).any()
        for slot in row['slots']:
            pixels=crop(pages,slot)
            assert (pixels[:,:,3]>0).any(),(facing,slot['slot'])
            assert slot['minSum']<slot['maxSum']
    checks.append(dict(bundle='shelf-depth',facings=4,slots=96,pages=len(pages)))
    folder=BASE/'components'
    components=json.loads((folder/'manifest.json').read_text())
    assert components['state']=='complete'
    color_pages=load_pages(folder,components['colorPages'])
    depth_pages=load_pages(folder,components['depthPages'])
    assert len(components['states'])==56
    for row in components['states']:
        color=crop(color_pages,row['color'])
        depth=crop(depth_pages,row['depth'])
        assert color.shape==depth.shape
        assert np.array_equal(color[:,:,3]>0,depth[:,:,3]>0),row['id']
        assert row['actorFree'] and row['staticColorMaxDifference']==0
        assert row['preservedStaticPixels']>0
        if (row['family']=='fridge' and row['state']=='closed') or (row['family']=='bike' and row['state']=='0'):
            source=atlas['sprite'][row['atlasIndex']]
            original=np.asarray(Image.open(ROOT/'web/public'/atlas['pages'][source.get('page',0)]).convert('RGBA'))
            original=original[source['y']:source['y']+source['h'],source['x']:source['x']+source['w']]
            x,y=[offset*row['pixelDensity'] for offset in row['anchorOffset']]
            assert np.array_equal(color[y:y+source['h'],x:x+source['w']],original),row['id']
    checks.append(dict(bundle='components',states=len(components['states']),restPixels='identical-to-published-color',depthCoverage='matches-color-exactly'))
    checks.append(verify_dropped_book(args.dropped_book_folder,atlas))
    models=tomllib.loads((ROOT/'content/objects.toml').read_text())['model']
    covered={atlas['sprite'][index]['name'] for index in seen}
    assert all(model['properties']['sprite']['set'] in covered for model in models)
    checks.append(dict(bundle='model-catalogue',models=len(models),missing=[]))
    report=dict(state='complete',checks=checks)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))


if __name__=='__main__':main()
