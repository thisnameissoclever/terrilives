import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer } from '../src/render/sprites.ts';
import { BED_CATALOG, ATLAS_FILE_NAME, SPRITE_PAIRS, spriteIndex } from '../src/render/atlas.ts';
import { bedSceneKey } from '../src/render/bed-sprites.ts';
import { writeInstance } from '../src/render/instances.ts';

// Independent pixel references are generated from the original export PNGs,
// not from the atlas, generated catalog, shader or picking implementation.
export async function coveredBedProof() {
  const reference = await (await fetch('./.covered-bed-reference.json')).json();
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 220;
  const gpu = await initDevice(canvas);
  const errors = [], records = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.querySelector('#board');
  board.style = 'display:flex;flex-wrap:wrap;max-width:960px;background:#17171c;color:white';
  const renderer = await SpriteRenderer.create(gpu);
  const instances = new Float32Array(16);
  const copy = document.createElement('canvas'); copy.width = 240; copy.height = 220;
  const ctx = copy.getContext('2d', {willReadFrequently:true});
  const sheet = document.createElement('canvas');sheet.width=960;sheet.height=960;
  const sheetContext=sheet.getContext('2d');sheetContext.fillStyle='#17171c';sheetContext.fillRect(0,0,960,960);
  let tileNumber=0;
  let maximum = 0, totalSamples = 0;
  const legacy=[];
  try {
    for (const row of reference.records) {
      const target = spriteIndex('offlineDoubleBed'+(row.facing==='SE'?'':row.facing));
      const key = bedSceneKey(row.mask, ['green','blue','red'].indexOf(row.palettes[0]), ['green','blue','red'].indexOf(row.palettes[1]));
      const scene = BED_CATALOG[target][key];
      writeInstance(instances,0,20.375+58*row.scale,20.125+88*row.scale,.5,scene.sprite);
      instances.set(row.shift,12);
      renderer.draw(instances,1,row.scale);
      await gpu.device.queue.onSubmittedWorkDone();
      ctx.drawImage(canvas,0,0);
      const pixels = ctx.getImageData(0,0,240,220).data;
      const differences = []; let worst = 0, point = null;
      for (const [x,y,...expected] of row.samples) {
        const index=(y*240+x)*4;
        const difference=Math.max(...expected.map((value,channel)=>Math.abs(value-pixels[index+channel])));
        differences.push(difference);
        if (difference>worst) {worst=difference;point={x,y,expected,actual:Array.from(pixels.slice(index,index+3))};}
      }
      differences.sort((a,b)=>a-b);
      const p95=differences[Math.floor(differences.length*.95)];
      maximum=Math.max(maximum,worst);totalSamples+=differences.length;
      records.push({facing:row.facing,mask:row.mask,palettes:row.palettes,scale:row.scale,shift:row.shift,maximum:worst,p95,point});
      if (row.scale===1.37 && row.shift[0]===0 && row.palettes.every(value=>value==='green')) {
        const tile=document.createElement('section'), label=document.createElement('div'), picture=document.createElement('canvas');
        label.textContent=`${row.facing}, occupancy ${row.mask}`;
        picture.width=240;picture.height=220;picture.getContext('2d').drawImage(copy,0,0);
        tile.append(label,picture);board.append(tile);
        const sx=(tileNumber%4)*240,sy=Math.floor(tileNumber/4)*240;
        sheetContext.fillStyle='white';sheetContext.font='16px sans-serif';sheetContext.fillText(label.textContent,sx+4,sy+17);
        sheetContext.drawImage(picture,sx,sy+20);tileNumber++;
      }
    }
    for (const index of [0,1,...Object.keys(SPRITE_PAIRS).map(Number)]) {
      writeInstance(instances,0,120.375,185.125,.5,index);
      instances.set([150,.4,.15],12);
      renderer.draw(instances,1,1.37);await gpu.device.queue.onSubmittedWorkDone();ctx.drawImage(canvas,0,0);
      const pixels=ctx.getImageData(0,0,240,220).data;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pixels)),value=>value.toString(16).padStart(2,'0')).join('');
      legacy.push({index,hash});
    }
    const validation=await gpu.device.popErrorScope();
    const sheetLink=document.createElement('a');sheetLink.textContent='Download GPU sheet';sheetLink.download='covered-bed-gpu.png';sheetLink.href=sheet.toDataURL();
    document.querySelector('#downloads').append(sheetLink,document.createTextNode(' | '));
    return {pass:!validation && errors.length===0 && records.every(row=>row.maximum<=6 && row.p95<=2),
      atlas:ATLAS_FILE_NAME,cases:records.length,totalSamples,maximum,validation:validation?.message??null,errors,records,legacy};
  } finally {gpu.device.destroy();}
}
