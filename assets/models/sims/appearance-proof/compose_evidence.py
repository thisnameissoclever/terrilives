from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
base=Path(__file__).resolve().parents[4]/'docs/evidence/2026-10-12-character-appearance'
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',17)
for action in ['idle','read']:
 sheet=Image.new('RGB',(960,1000),'#17181f');draw=ImageDraw.Draw(sheet)
 for row,presentation in enumerate(['masculine','feminine']):
  for col,value in enumerate([0,50,100]):
   frame=Image.open(base/'captures'/f'{presentation}-{value}-{value}-{action}-0.png').convert('RGB');frame.thumbnail((320,440))
   sheet.paste(frame,(col*320+(320-frame.width)//2,row*500+48))
   draw.text((col*320+15,row*500+8),f'{presentation.title()} | height {85+value*.3:g}%',font=font,fill='white')
   draw.text((col*320+15,row*500+29),f'Build {value} | {"Bob" if row else "Curl"}',font=font,fill='#abc3d5')
 sheet.save(base/f'actual-{action}-range.png')
