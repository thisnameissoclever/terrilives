import { initDevice } from '../src/render/device.js';
import { SpriteRenderer } from '../src/render/sprites.js';
import { spriteIndex } from '../src/render/atlas.js';
import { buildInstances, instanceCount, type RenderSource } from '../src/frame.js';
import { InteractionSelection } from '../src/render/interaction-sprites.js';
import type { TileLighting } from '../src/render/lighting.js';

const canvas = document.querySelector<HTMLCanvasElement>('#review')!;
const gpu = await initDevice(canvas);
const renderer = await SpriteRenderer.create(gpu);
let scale = 1;
let people = false;
let night = false;
function draw() {
  const positions: number[] = [], sprites: number[] = [], widths: number[] = [], depths: number[] = [];
  const dirty: number[] = [], food: number[] = [], kinds: number[] = [];
  for (let row = 0; row < 3; row++) for (let facing = 0; facing < 4; facing++) {
    const suffix = ['', 'NW', 'SW', 'NE'][facing];
    const sx = 165 + facing * 300, sy = 155 + row * 185;
    const x = ((sx-640)/32 + sy/21)/2/scale, y = (sy/21-(sx-640)/32)/2/scale;
    positions.push(x,y); sprites.push(spriteIndex((row === 2 ? 'table' : 'offlineCounter') + suffix));
    kinds.push(1); widths.push(row === 2 && facing < 2 ? 2 : 1); depths.push(row === 2 && facing >= 2 ? 2 : 1);
    dirty.push(row === 0 ? 1 : row === 1 ? 3 : 4); food.push(row === 1 ? 3 : 0);
    if (people) for (const offset of [-.8,.8]) {
      positions.push(x,y+offset); sprites.push(spriteIndex('sim'));
      kinds.push(0); widths.push(0); depths.push(0); dirty.push(0); food.push(0);
    }
  }
  const count = sprites.length;
  const data = new Float32Array(positions);
  const source: RenderSource = {
    count, positions:()=>data, prevPositions:()=>data,
    ids:()=>Uint32Array.from(sprites,(_,i)=>i), simIds:()=>new Uint32Array(count),
    kinds:()=>new Uint32Array(kinds), sprites:()=>new Uint32Array(sprites),
    activities:()=>new Uint32Array(count), visualActions:()=>new Uint32Array(count),
    facings:()=>new Uint32Array(count).fill(1), carrying:()=>new Uint32Array(count).fill(0xffffffff),
    dirtyDishes:()=>new Uint32Array(dirty), mealPortions:()=>new Uint32Array(food),
    footprintWidths:()=>new Uint32Array(widths), footprintDepths:()=>new Uint32Array(depths), itemKinds:()=>[],
  };
  const selection = new InteractionSelection();
  const lighting: TileLighting = {width:64,height:64,stride:66,values:new Float32Array(66*66).fill(.35)};
  const instances = buildInstances(source,1,640,0,64,null,scale,false,0,lighting,selection);
  renderer.draw(instances,instanceCount(source,null),scale,night ? [.3,.35,.5,1] : [1,1,1,1]);
  document.querySelector('#status')!.textContent = `${scale}x; SE / NW / SW / NE; snack / prep + 3 meals / 4 used plates`;
}
document.querySelector('#zoom')!.addEventListener('click',()=>{scale=scale===1?2:1;draw();});
document.querySelector('#people')!.addEventListener('click',()=>{people=!people;draw();});
document.querySelector('#light')!.addEventListener('click',()=>{night=!night;draw();});
draw();
