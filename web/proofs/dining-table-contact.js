import { initDevice } from '../src/render/device.ts';
import { SpriteRenderer, loadAtlasTexture } from '../src/render/sprites.ts';
import { buildInstances } from '../src/frame.ts';
import { InteractionSelection } from '../src/render/interaction-sprites.ts';
import { INTERACTION_SPRITES, spriteIndex } from '../src/render/atlas.ts';
import { FLOATS_PER_INSTANCE } from '../src/render/instances.ts';
import manifest from '../../assets/models/domestic/export/seated-table-proof/manifest.json';
import supportManifest from '../../assets/models/domestic/export/seated-dining/manifest.json';
import { packDiningSupport } from '../src/render/dining-support.ts';
import { SPRITES, SPRITE_DINING_SUPPORT } from '../src/render/atlas.ts';
import handManifest from '../../assets/models/domestic/export/seated-hands-proof/manifest.json';

const images = import.meta.glob('../../assets/models/domestic/export/seated-table-proof/*.png',
  { eager: true, query: '?url', import: 'default' });
const supportImages = import.meta.glob('../../assets/models/domestic/export/seated-dining/*.png',
  { eager: true, query: '?url', import: 'default' });
const handImages = import.meta.glob('../../assets/models/domestic/export/seated-hands-proof/*.png',
  { eager: true, query: '?url', import: 'default' });
const angles = { 0:'SW', 90:'SE', 180:'NE', 270:'NW' };
const name = (kind, facing) => `offlineDining${kind}${facing === 'SE' ? '' : facing}`;

export async function diningTableProof() {
  const width = manifest.width * 2, height = manifest.height * 2;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const gpu = await initDevice(canvas), errors = [], records = [], captures = [];
  gpu.device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  gpu.device.pushErrorScope('validation');
  const board = document.createElement('div'); board.style = `display:flex;flex-wrap:wrap;width:${width*2}px;background:#17171c;color:white`;
  try {
    const texture = await loadAtlasTexture(gpu.device);
    const renderer = new SpriteRenderer(gpu, texture);
    renderer.setStaticGeometry(new Float32Array(0), 0);
    const supportTable = packDiningSupport(SPRITES.length, SPRITE_DINING_SUPPORT);
    for (const row of manifest.frames) {
      const angle = (Math.round(row.table_angle) % 360 + 360) % 360;
      // Blender's negative Y maps to the lot's positive Y.
      const [tx, modelY] = row.table_position; const ty = -modelY;
      const positions = new Float32Array([0, 0, 0, 0, tx, ty]), none = 0xffffffff;
      const horizontal = angle % 180 === 90;
      const source = { count:3, positions:()=>positions, prevPositions:()=>positions,
        ids:()=>new Uint32Array([101,102,103]), kinds:()=>new Uint32Array([1,0,1]),
        sprites:()=>new Uint32Array([spriteIndex(name('Chair',row.facing)), spriteIndex('sim'), spriteIndex(name('Table',angles[angle]))]),
        activities:()=>new Uint32Array([0,3,0]), visualActions:()=>new Uint32Array([0,13,0]),
        interactionTargets:()=>new Uint32Array([none,101,none]), mealTables:()=>new Uint32Array([none,103,none]),
        footprintWidths:()=>new Uint32Array([1,0,horizontal?2:1]), footprintDepths:()=>new Uint32Array([1,0,horizontal?1:2]),
        simIds:()=>new Uint32Array([none,0,none]), facings:()=>new Uint32Array(3),
        itemKinds:()=>[], carrying:()=>new Uint32Array(3).fill(none) };
      const selection = new InteractionSelection(INTERACTION_SPRITES,()=> 'green');
      const data = buildInstances(source,1,manifest.anchor[0]*2,(manifest.anchor[1]-21)*2,16,null,2,false,row.frame*4+26,null,selection);
      renderer.draw(data,4,2); await gpu.device.queue.onSubmittedWorkDone();
      const copy=document.createElement('canvas'); copy.width=width;copy.height=height;
      const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);
      const actual=ctx.getImageData(0,0,width,height).data;
      const bitmap=await createImageBitmap(await(await fetch(images['../../assets/models/domestic/export/seated-table-proof/'+row.reference.path])).blob(),
        {premultiplyAlpha:'none',colorSpaceConversion:'none'});
      const expectedCanvas=document.createElement('canvas');expectedCanvas.width=width;expectedCanvas.height=height;
      const expected=expectedCanvas.getContext('2d');expected.drawImage(bitmap,0,0);bitmap.close();
      const reference=expected.getImageData(0,0,width,height).data;
      // The independent geometry mask includes both hands, cuffs, plate and spoon.
      const maskRow = supportManifest.frames.find(r=>r.facing===row.facing&&r.frame===row.frame&&r.variant==='green');
      const maskBitmap=await createImageBitmap(await(await fetch(supportImages['../../assets/models/domestic/export/seated-dining/'+maskRow.meal.path])).blob(),
        {premultiplyAlpha:'none',colorSpaceConversion:'none'});
      const maskCanvas=document.createElement('canvas');maskCanvas.width=width;maskCanvas.height=height;
      const maskContext=maskCanvas.getContext('2d');
      maskContext.drawImage(maskBitmap,(manifest.anchor[0]-maskRow.meal_anchor[0])*2,
        (manifest.anchor[1]-maskRow.meal_anchor[1])*2);maskBitmap.close();
      const maskPixels=maskContext.getImageData(0,0,width,height).data;
      const compare=(values,contact=false)=>{
        const differences=[];let worst=null;
        for(let p=0;p<reference.length;p+=4){
          if(reference[p+3]<250)continue;
          if(contact&&maskPixels[p+3]<240)continue;
          const e=Math.max(...[0,1,2].map(c=>Math.abs(values[p+c]-reference[p+c]*255/reference[p+3])));
          differences.push(e);
          if(!worst||e>worst.error)worst={error:e,x:p/4%width,y:Math.floor(p/4/width),actual:Array.from(values.slice(p,p+4)),reference:Array.from(reference.slice(p,p+4))};
        }
        differences.sort((a,b)=>a-b);
        return {p95:differences[Math.floor(differences.length*.95)],max:differences.at(-1),pixels:differences.length,worst};
      };
      const metrics=compare(actual);
      const contact=compare(actual,true);
      records.push({facing:row.facing,frame:row.frame,arrangement:row.arrangement,...metrics,contact});
      if(row.frame===4){
        const section=document.createElement('section');section.style.width=width+'px';
        const title=document.createElement('div');title.textContent=`${row.facing} ${row.arrangement}`;section.append(title,copy);board.append(section);
        captures.push({facing:row.facing,arrangement:row.arrangement,png:copy.toDataURL()});
        const broken=data.slice();broken[3*FLOATS_PER_INSTANCE+2]=broken[FLOATS_PER_INSTANCE+2];
        try{
          renderer.draw(broken,4,2);await gpu.device.queue.onSubmittedWorkDone();ctx.drawImage(canvas,0,0);
          const mutation=compare(ctx.getImageData(0,0,width,height).data);
          const contactMutation=compare(ctx.getImageData(0,0,width,height).data,true);
          records.push({facing:row.facing,arrangement:row.arrangement,mutation,contactMutation});
          gpu.device.queue.writeBuffer(renderer.diningBuffer,0,new Float32Array(supportTable.length));
          renderer.draw(data,4,2);await gpu.device.queue.onSubmittedWorkDone();ctx.drawImage(canvas,0,0);
          const missingSupport=compare(ctx.getImageData(0,0,width,height).data,true);
          records.push({facing:row.facing,arrangement:row.arrangement,mutation:missingSupport,kind:'missing-support-mask'});
          if((row.facing==='SE'||row.facing==='NE')&&(contactMutation.max<=64||missingSupport.max<=64))
            throw new Error('Table support mutation escaped the contact comparison');
          gpu.device.queue.writeBuffer(renderer.diningBuffer,0,supportTable);
          // Named hand geometry excludes the plate, food and utensil through holdouts.
          const body=data[FLOATS_PER_INSTANCE+3],bodySprite=SPRITES[body];
          const handRow=handManifest.frames.find(r=>r.facing===row.facing&&r.frame===row.frame);
          const handBitmap=await createImageBitmap(await(await fetch(handImages['../../assets/models/domestic/export/seated-hands-proof/'+handRow.path])).blob(),
            {premultiplyAlpha:'none',colorSpaceConversion:'none'});
          const handCanvas=document.createElement('canvas');handCanvas.width=160;handCanvas.height=224;
          const handContext=handCanvas.getContext('2d');handContext.drawImage(handBitmap,0,0);handBitmap.close();
          const handPixels=handContext.getImageData(0,0,160,224).data;
          const originalBody=await createImageBitmap(await(await fetch(supportImages['../../assets/models/domestic/export/seated-dining/'+maskRow.body.path])).blob(),
            {premultiplyAlpha:'none',colorSpaceConversion:'none'});
          const bodyCanvas=document.createElement('canvas');bodyCanvas.width=160;bodyCanvas.height=224;
          const bodyContext=bodyCanvas.getContext('2d');bodyContext.drawImage(originalBody,0,0);
          const handless=bodyContext.getImageData(0,0,160,224).data;
          let removed=0;
          for(let p=0;p<handless.length;p+=4){
            if(handless[p+3]>0&&handPixels[p+3]>=250){handless.fill(0,p,p+4);removed++;}
          }
          try{
            gpu.device.queue.writeTexture({texture,origin:[bodySprite.x,bodySprite.y,bodySprite.page??0]},handless,
              {bytesPerRow:160*4},[160,224]);
            renderer.draw(data,4,2);await gpu.device.queue.onSubmittedWorkDone();ctx.drawImage(canvas,0,0);
            const missingHands=compare(ctx.getImageData(0,0,width,height).data,true);
            records.push({facing:row.facing,arrangement:row.arrangement,mutation:missingHands,kind:'missing-hand-colour-contribution',removed});
            if(removed===0||missingHands.max<=32)
              throw new Error('Hand coverage mutation escaped the contact comparison: '+JSON.stringify(records.at(-1)));
          }finally{gpu.device.queue.copyExternalImageToTexture({source:originalBody},
            {texture,origin:[bodySprite.x,bodySprite.y,bodySprite.page??0]},[160,224]);originalBody.close();}
        }finally{gpu.device.queue.writeBuffer(renderer.diningBuffer,0,supportTable);renderer.draw(data,4,2);}
      }
    }
    document.body.replaceChildren(board);document.body.style.margin='0';
    const validation=await gpu.device.popErrorScope();
    // Whole-scene maximum records independently outlined silhouette differences.
    // It is diagnostic; the contact maximum is tighter than the original 64 limit.
    return {pass:!validation&&!errors.length&&records.every(row=>row.mutation||row.p95<=12&&row.contact.pixels>0&&row.contact.max<=32),validation:validation?.message??null,errors,records,captures};
  }finally{gpu.device.destroy();}
}
