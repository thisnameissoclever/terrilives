"""Downsample completed Blender renders and assemble inspectable loop evidence."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

BASE = Path(__file__).resolve().parent
FACINGS = ('SE','SW','NW','NE')
CLIPS = {'idle':(1,1,'Idle'),'walk':(8,10,'Walk'),'read':(4,2,'Read')}
CLIPS.update({'talk':(4,2,'Talk'),'eat':(4,2,'Eat'),'stand_read':(4,2,'StandRead'),'watch_fish':(4,2,'WatchFish'),'sit':(4,2,'Sit')})
CLIPS['sleep']=(4,1,'Sleep')
CANVASES = {'idle':(38,88),'walk':(52,104),'read':(52,104)}
CANVASES.update({name:(52,104) for name in CLIPS if name not in CANVASES})
CANVASES['sleep']=(104,76)


def sheet(action, count, folder):
    scale = 3
    width,height = CANVASES[action]
    cell_w, cell_h = width*scale+12, height*scale+30
    result = Image.new('RGB',(max(count,4)*cell_w,4*cell_h),(235,230,218))
    draw = ImageDraw.Draw(result)
    for row,facing in enumerate(FACINGS):
        for index in range(count):
            path = folder/f'{action}-{facing}-{index}.png'
            img = Image.open(path).convert('RGBA')
            img = img.resize((width*scale,height*scale),Image.Resampling.NEAREST)
            x,y = index*cell_w+6,row*cell_h+23
            result.paste(img,(x,y),img)
            draw.text((x,row*cell_h+6),f'{action} {facing} {index}',fill=(35,32,28))
    result.save(BASE/'review'/f'{action}-contact-3x.png')


def animation(action,count,fps,folder,suffix='loop'):
    width,height = CANVASES[action]
    frames = []
    for index in range(count):
        canvas = Image.new('RGB',(width*4*4,height*4+28),(235,230,218))
        draw = ImageDraw.Draw(canvas)
        for col,facing in enumerate(FACINGS):
            img = Image.open(folder/f'{action}-{facing}-{index}.png').convert('RGBA')
            img = img.resize((width*4,height*4),Image.Resampling.NEAREST)
            canvas.paste(img,(col*width*4,28),img)
            draw.text((col*width*4+8,8),f'{action} {facing}',fill=(35,32,28))
        frames.append(canvas)
    frames[0].save(BASE/'review'/f'{action}-{suffix}.webp',save_all=True,append_images=frames[1:],duration=round(1000/fps),loop=0,lossless=True)


def main():
    status = json.loads((BASE/'build-status.json').read_text())
    assert status['state'] == 'complete', status
    framing = json.loads((BASE/'seated-framing.json').read_text())
    registration = json.loads((BASE/'registered-canvas-proof.json').read_text())
    projected = json.loads((BASE/'projected-bounds.json').read_text())
    export = BASE/'export'
    manifest = {'schema_version':1,'width':38,'height':88,'anchor':registration['idle']['anchor'],
                'source_sha256':status['proof']['source_sha256'], 'frames':[], 'clips':{},
                'facing_root_degrees':{'SE':90,'SW':0,'NW':270,'NE':180},
                'projection':{'camera_ortho_scale':framing['camera_scale'],'pixels_per_model_unit':88/framing['camera_scale']},
                'reading_framing':framing}
    boxes = []
    for action,(count,fps,label) in CLIPS.items():
        width,height = CANVASES[action]
        anchor = registration[action]['anchor']
        manifest['clips'][action] = {'frame_count':count,'sample_fps':fps,'loop':True,'source_action':action,'width':width,'height':height,'anchor':anchor,'world_origin':registration[action]['world_origin']}
        if action == 'walk':
            manifest['clips'][action]['distance_per_cycle_model_units'] = 1.0
        for facing in FACINGS:
            for index in range(count):
                filename = f'{action}-{facing}-{index}.png'
                source = Image.open(BASE/'review'/filename).convert('RGBA')
                assert source.size == (width*16,height*16), (filename,source.size)
                image = source.resize((width,height),Image.Resampling.LANCZOS)
                # Remove nearly transparent resampling ringing, including hidden RGB.
                image.putdata([(r,g,b,a) if a>4 else (0,0,0,0) for r,g,b,a in image.get_flattened_data()])
                bounds = image.getchannel('A').getbbox()
                assert bounds and bounds[0]>0 and bounds[1]>0 and bounds[2]<width and bounds[3]<height, (filename,bounds)
                target = export/filename
                image.info.clear()
                image.save(target)
                entry = {'name':f'rigSim{label}{facing}{index}', 'action':action,'facing':facing,'frame':index,
                         'path':filename,'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}
                if action=='eat':
                    raw = projected[f'{action}-{facing}-{index}']['hand_anchor']
                    entry['hand_anchor'] = [raw[0]+(width-38)/2,raw[1]+(height-88)/2]
                    entry['hand_in_front'] = projected[f'{action}-{facing}-{index}']['hand_in_front']
                manifest['frames'].append(entry)
                boxes.append({'frame':filename,'alpha_bbox':list(bounds)})
        sheet(action,count,export)
        if count>1:
            animation(action,count,fps,export)
        if action=='walk':
            animation(action,count,20,export,'loop-at-game-speed')
    (export/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (BASE/'export-proof.json').write_text(json.dumps({'frames':len(boxes),'alpha_boxes':boxes},indent=2)+'\n')
    print(f'PASS: {len(boxes)} native RGBA frames, registered clip canvases, full alpha padding, SHA256 manifest and contact/loop evidence.')


if __name__ == '__main__':
    main()
