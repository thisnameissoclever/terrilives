"""Pair untouched browser captures with sections of the measured runtime mesh."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageChops

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT/'docs/evidence/2026-10-12-character-appearance/intersections'
FONT = 'C:/Windows/Fonts/segoeui.ttf'
font = lambda size: ImageFont.truetype(FONT,size)


def loops(segments, axes):
    nodes, edges = {}, {}
    for segment in segments:
        a,b = [tuple(round(p[k],6) for k in axes) for p in segment]
        if a == b:
            continue
        nodes[a],nodes[b] = a,b
        edges.setdefault(a,set()).add(b);edges.setdefault(b,set()).add(a)
    assert all(len(v)==2 for v in edges.values()), 'Section must have closed contours'
    result=[]
    while edges:
        start=next(iter(edges));path=[start];prev=None;current=start
        while True:
            candidates=edges[current]-({prev} if prev else set())
            nxt=next(iter(candidates))
            if nxt==start:break
            path.append(nxt);prev,current=current,nxt
        for p in path:del edges[p]
        result.append(path)
    return result


rows=json.loads((OUT/'sections.json').read_text())['sections']
captions={
 'seat':('1. Thighs enter the seat cushion','Height 0 (85%); build 100; masculine; reading frame 0',0,(0.0,-.10,.43)),
 'arm':('2. Shirt hem enters the chair arm','Height 0 (85%); build 100; masculine; reading frame 0',0,(-.29,-.15,.535)),
 'back':('3. Shirt enters the back cushion','Height 50 (100%); build 100; masculine; reading frame 0',2,(0,.15,.95)),
}
for row in rows:
    title,settings,facing,focus=captions[row['label']]
    image=Image.new('RGB',(1260,790),'#17181e');draw=ImageDraw.Draw(image)
    draw.text((24,15),title,font=font(26),fill='white')
    draw.text((24,53),settings,font=font(20),fill='#bcc8d4')
    draw.text((24,92),'Actual browser view',font=font(21),fill='white')
    draw.text((656,92),'Measured mesh cross-section',font=font(21),fill='white')
    original=Image.open(OUT/f"{row['label']}-{facing}.png").convert('RGB')
    # Preserve screenshot pixels at native scale, including its original margins.
    image.paste(original,(90,140))
    draw=ImageDraw.Draw(image)
    import math
    a=facing*math.pi/2;x,y,z=row['point']
    x,y=math.cos(a)*x-math.sin(a)*y,math.sin(a)*x+math.cos(a)*y
    scale=min(original.width/96,original.height/128)
    sx=original.width*.5+(x+y)*32*scale
    sy=original.height*100/128-(-(x-y)*21+z*math.sqrt(1166))*scale
    cx,cy=90+sx,140+sy
    draw.ellipse((cx-38,cy-26,cx+38,cy+26),outline='#ffd565',width=3)
    draw.text((24,711),'Yellow ring: location, including surfaces hidden by the chair.',font=font(17),fill='#ffd565')
    axes=[k for k in range(3) if k!=row['axis']]
    # The overshirt is open at its neckline. Do not invent a closing face or fill.
    open_body = row['label']=='back'
    body=[] if open_body else loops(row['bodySegments'],axes)
    fixture=loops(row['fixtureSegments'],axes)
    body_lines=[[[p[k] for k in axes] for p in segment] for segment in row['bodySegments']]
    allpoints=[p for loop in body_lines+fixture for p in loop]
    lower=[min(p[k] for p in allpoints) for k in range(2)]
    upper=[max(p[k] for p in allpoints) for k in range(2)]
    factor=min(520/(upper[0]-lower[0]),480/(upper[1]-lower[1]))
    center=[(upper[k]+lower[k])/2 for k in range(2)]
    project=lambda p:(round(930+(p[0]-center[0])*factor),round(405-(p[1]-center[1])*factor))
    masks=[]
    for outlines,color in [(fixture,'#b4776d'),(body,'#4da7ba')]:
        mask=Image.new('1',image.size);md=ImageDraw.Draw(mask)
        for contour in outlines:md.polygon([project(p) for p in contour],fill=1)
        image.paste(color,(0,0),mask);masks.append(mask)
    overlap=ImageChops.logical_and(*masks)
    image.paste('#ff465d',(0,0),overlap)
    draw=ImageDraw.Draw(image)
    if open_body:
        line_mask=Image.new('1',image.size);line_draw=ImageDraw.Draw(line_mask)
        for segment in body_lines:
            pixels=[project(p) for p in segment]
            draw.line(pixels,fill='#b7f1ff',width=4)
            line_draw.line(pixels,fill=1,width=4)
        image.paste('#ff465d',(0,0),ImageChops.logical_and(masks[0],line_mask))
        draw=ImageDraw.Draw(image)
    for outlines,color in [(fixture,'#ffd0bd'),(body,'#b7f1ff')]:
        for contour in outlines:
            pixels=[project(p) for p in contour];draw.line(pixels+[pixels[0]],fill=color,width=2)
    point=project([row['point'][k] for k in axes]);nearest=project([row['closest'][k] for k in axes])
    draw.line([point,nearest],fill='white',width=3)
    for p in [point,nearest]:draw.ellipse((p[0]-4,p[1]-4,p[0]+4,p[1]+4),fill='white')
    legend = 'Blue: shirt surface; red: surface inside pink cushion' if open_body else 'Pink: cushion / arm    Blue: clothing    Red: overlap'
    draw.text((656,655),legend,font=font(17),fill='white')
    draw.text((656,683),f"White line: {row['depth']:.4f} model units inside the fixture",font=font(17),fill='white')
    orientation='Horizontal slice through the shirt hem' if row['axis']==2 else 'Side slice through the measured point'
    draw.text((656,711),orientation,font=font(17),fill='#bcc8d4')
    draw.text((24,756),'Same unmodified runtime geometry. The section exposes hidden overlap; it is not the normal game view.',font=font(18),fill='#bcc8d4')
    image.save(OUT/f"{row['label']}-evidence.png")
    print(row['label'],'closed section contours',len(body),len(fixture))
