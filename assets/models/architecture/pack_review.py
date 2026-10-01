"""Pack a completed candidate for the opt-in actual-renderer proof, without touching production art."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from PIL import Image


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def floor_owns_sample(px,py,origin,density=2):
    sx=(px+.5)/density-origin[0]
    sy=(py+.5)/density-origin[1]
    gx=(sx/32+sy/21)/2; gy=(sy/21-sx/32)/2
    return -.5<=gx<.5 and -.5<=gy<.5


def run(source,destination):
    proof=json.loads((source/'proof.json').read_text())
    assert proof['state']=='complete' and proof['background'] is True
    destination.mkdir(parents=True,exist_ok=False)
    entries=[]; images=[]; rows=[]; x=y=row_height=0; width=1024
    for record in proof['renders']:
        assert digest(source/record['color'])==record['color_sha256']
        assert digest(source/record['depth'])==record['depth_sha256']
        image=Image.open(source/record['color']).convert('RGBA')
        if record['name'].startswith('floor-'):
            # Adjacent tiles share a depth. Partial-alpha edge pixels cannot
            # cover one another, so exact half-open footprint ownership must
            # replace the isolated render's antialiased diamond coverage.
            pixels=image.load()
            for py in range(image.height):
                for px in range(image.width):
                    inside=floor_owns_sample(px,py,record['origin'])
                    r,g,b,a=pixels[px,py]
                    assert not inside or a>0, 'Interior floor texel has no color owner'
                    pixels[px,py]=(r,g,b,255 if inside else 0)
        bounds=image.getbbox(); assert bounds is not None
        assert bounds[0]>0 and bounds[1]>0 and bounds[2]<image.width and bounds[3]<image.height, record['name']+' clipped'
        crop=(bounds[0]-2,bounds[1]-2,bounds[2]+2,bounds[3]+2)
        image=image.crop(crop)
        if record['name'].startswith('floor-'):
            # An opaque material apron preserves RGB through browser image
            # decoding. Runtime floor coverage uses the exact world footprint;
            # the apron cannot extend the physical silhouette.
            original=image.copy(); pixels=image.load(); source_pixels=original.load()
            offsets=sorted(((dx,dy) for dy in range(-4,5) for dx in range(-4,5)),key=lambda p:p[0]*p[0]+p[1]*p[1])
            for py in range(image.height):
                for px in range(image.width):
                    if pixels[px,py][3]: continue
                    for dx,dy in offsets:
                        sample_x,sample_y=px+dx,py+dy
                        if 0<=sample_x<image.width and 0<=sample_y<image.height and source_pixels[sample_x,sample_y][3]:
                            pixels[px,py]=source_pixels[sample_x,sample_y]
                            break
        if x+image.width+2>width: x=0; y+=row_height+2; row_height=0
        depth=(source/record['depth']).read_bytes()
        data=b''.join(depth[(row*record['width']+crop[0])*2:(row*record['width']+crop[2])*2] for row in range(crop[1],crop[3]))
        assert len(data)==image.width*image.height*2
        origin=[record['origin'][0]-crop[0]/2,record['origin'][1]-crop[1]/2]
        entry={'name':record['name'],'x':x,'y':y,'w':image.width,'h':image.height,'pixel_density':2,
               'origin':origin,'anchor':[origin[0],origin[1]+21],'source_crop':crop}
        entries.append(entry); images.append(image); rows.append(data)
        x+=image.width+2; row_height=max(row_height,image.height)
    height=y+row_height
    atlas=Image.new('RGBA',(width,height))
    depth_atlas=bytearray(width*height*2)
    for entry,image,data in zip(entries,images,rows):
        assert 0<=entry['x'] and 0<=entry['y'] and entry['x']+entry['w']<=width and entry['y']+entry['h']<=height
        atlas.paste(image,(entry['x'],entry['y']))
        for row in range(entry['h']):
            start=((entry['y']+row)*width+entry['x'])*2
            depth_atlas[start:start+entry['w']*2]=data[row*entry['w']*2:(row+1)*entry['w']*2]
    assert len(depth_atlas)==width*height*2,'Depth atlas dimensions disagree'
    atlas.save(destination/'color.png')
    (destination/'depth.r16f').write_bytes(depth_atlas)
    manifest={'width':width,'height':height,'sprites':entries,'color':'color.png','depth':'depth.r16f',
              'color_sha256':digest(destination/'color.png'),'depth_sha256':digest(destination/'depth.r16f'),
              'color_texture_bytes':width*height*4,'depth_texture_bytes':len(depth_atlas),
              'source_proof_sha256':digest(source/'proof.json'),'packer_sha256':digest(Path(__file__))}
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (destination/'render-proof.json').write_bytes((source/'proof.json').read_bytes())
    print(json.dumps({'sprites':len(entries),'dimensions':[width,height],
                      'color_bytes':(destination/'color.png').stat().st_size,'depth_bytes':len(depth_atlas)}))


if __name__=='__main__': run(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
