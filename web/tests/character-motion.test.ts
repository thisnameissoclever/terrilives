import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Bundle } from '../src/render/character/bundle.js';
import { neutralAppearance } from '../src/render/character/appearance.js';
import { configuredPose } from '../src/render/character/pose.js';
import { anatomicalHeight, shapePoint } from '../src/render/character/shape.js';
import { boneFrame, inverseAffine, length, multiply, sub, transform } from '../src/render/character/math.js';

const bundle = JSON.parse(readFileSync(new URL('../../assets/models/sims/appearance-proof/export-v2/manifest.json', import.meta.url), 'utf8')) as Bundle;
const asset = new URL('../../assets/models/sims/appearance-proof/export-v2/', import.meta.url);
const vertices = new Float32Array(Uint8Array.from(readFileSync(new URL(bundle.runtime.vertices,asset))).buffer);
const indices = new Uint32Array(Uint8Array.from(readFileSync(new URL(bundle.runtime.indices,asset))).buffer);
const top = anatomicalHeight(vertices);

function shoePoints(side:string):[number,number,number][] {
  const bone=bundle.bones.findIndex(b=>b.name===`foot.${side}`);
  const part=bundle.runtime.parts.find(p=>p.name.startsWith('Fitted rounded shoe sole')&&vertices[indices[p.start]*16+6]===bone)!;
  const ids=[...new Set(indices.slice(part.start,part.start+part.count))];
  const lowest=ids.reduce((a,b)=>vertices[a*16+2]<vertices[b*16+2]?a:b);
  return [ids[0],lowest,ids.at(-1)!].map(i=>[vertices[i*16],vertices[i*16+1],vertices[i*16+2]]);
}

describe('continuous character motion', () => {
  it('keeps both wrist grips attached to the book through standing and seating transitions', () => {
    const book=bundle.bones.findIndex(b=>b.name==='book'),bone=bundle.bones[book];
    const bookRest=boneFrame(bone.head,bone.tail,bone.rest),source=bundle.actions.read[0];
    for(const presentation of ['masculine','feminine'] as const)for(const height of [0,50,100])for(const build of [0,50,100]) {
      const a={...neutralAppearance(),presentation,height,build};
      for(let frame=0;frame<=24;frame+=.5){
        const pose=configuredPose(bundle,a,'sit_down',frame,top);
        const bookInverse=inverseAffine(multiply(pose.subarray(book*16,book*16+16),bookRest));
        for(const side of ['L','R']){
          const hand=bundle.bones.findIndex(b=>b.name===`hand.${side}`);
          const expected=transform(inverseAffine(source[book]),[source[hand][12],source[hand][13],source[hand][14]]);
          const wrist=transform(pose.subarray(hand*16,hand*16+16),shapePoint(bundle.bones[hand].head,4,a,top));
          expect(length(sub(transform(bookInverse,wrist),expected))).toBeLessThan(.00002);
        }
      }
    }
  });
  it('preserves configured limb lengths and connected joint endpoints throughout the clips', () => {
    const chains=[['upper_arm.L','forearm.L'],['forearm.L','hand.L'],['upper_arm.R','forearm.R'],['forearm.R','hand.R'],
      ['thigh.L','shin.L'],['shin.L','foot.L'],['thigh.R','shin.R'],['shin.R','foot.R']];
    for(const presentation of ['masculine','feminine'] as const)for(const height of [0,50,100])for(const build of [0,50,100]) {
      const a={...neutralAppearance(),presentation,height,build};
      for(const action of ['walk','read','sit_down','stand_up'])for(let frame=0;frame<=(action==='walk'?8:action==='read'?4:24);frame+=.5){
        const pose=configuredPose(bundle,a,action,frame,top);
        for(const [name,next] of chains){
          const index=bundle.bones.findIndex(b=>b.name===name),child=bundle.bones.findIndex(b=>b.name===next);
          const region=name.includes('arm')?4:3,tailRegion=name.startsWith('shin')?6:region;
          const head=shapePoint(bundle.bones[index].head,region,a,top),tail=shapePoint(bundle.bones[index].tail,tailRegion,a,top);
          const matrix=pose.subarray(index*16,index*16+16);
          const start=transform(matrix,head),end=transform(matrix,tail);
          expect(Math.abs(length(sub(end,start))-length(sub(tail,head)))).toBeLessThan(.00002);
          const joint=transform(pose.subarray(child*16,child*16+16),shapePoint(bundle.bones[child].head,tailRegion,a,top));
          expect(length(sub(end,joint))).toBeLessThan(.00002);
        }
      }
    }
  });
  it('keeps the planted shoe point fixed as world travel advances', () => {
    for (const presentation of ['masculine', 'feminine'] as const) for (const height of [0,50,100]) for (const build of [0,50,100]) {
      const a = { ...neutralAppearance(), presentation, height, build };
      for (const side of ['L','R']) {
        const index = bundle.bones.findIndex(b => b.name === `foot.${side}`), start = side === 'L' ? 0 : 4;
        for (const source of shoePoints(side)) {
        const sole = shapePoint(source,6,a,top);
        let anchor: number[] | null = null;
        for (let frame=start;frame<=start+4;frame+=.25) {
          const pose=configuredPose(bundle,a,'walk',frame,top);
          const point=transform(pose.subarray(index*16,index*16+16),sole);
          const world=[point[0],-point[1]+frame/8,point[2]];
          if(!anchor)anchor=world;
          expect(Math.hypot(...world.map((v,i)=>v-anchor![i]))).toBeLessThan(.00002);
        }
        }
      }
    }
  });
  it('joins both transition endpoints exactly and keeps configured limbs reachable', () => {
    for(const presentation of ['masculine','feminine'] as const)for(const height of [0,50,100])for(const build of [0,50,100]) {
      const a={...neutralAppearance(),presentation,height,build};
      const pose=(action:string,frame:number)=>configuredPose(bundle,a,action,frame,top);
      const hip=bundle.bones.findIndex(b=>b.name==='hips');
      const restHip=shapePoint(bundle.bones[hip].head,3,a,top);
      const standingHip=transform(pose('standing_read',0).subarray(hip*16,hip*16+16),restHip);
      const seatedHip=transform(pose('read',0).subarray(hip*16,hip*16+16),restHip);
      expect(standingHip[1]).toBeCloseTo(-.355,5);
      expect(standingHip[2]-seatedHip[2]).toBeGreaterThan(.1);
      expect(pose('sit_down',0)).toEqual(pose('standing_read',0));
      expect(pose('sit_down',24)).toEqual(pose('read',0));
      expect(pose('stand_up',0)).toEqual(pose('read',0));
      expect(pose('stand_up',24)).toEqual(pose('standing_read',0));
      expect(pose('sit_down',100)).toEqual(pose('read',0));
      for(let frame=0;frame<=24;frame+=.5)expect([...pose('sit_down',frame)].every(Number.isFinite)).toBe(true);
      for(const side of ['L','R'])for(const source of shoePoints(side)) {
        const index=bundle.bones.findIndex(b=>b.name===`foot.${side}`),sole=shapePoint(source,6,a,top);
        const anchor=transform(pose('sit_down',0).subarray(index*16,index*16+16),sole);
        for(let frame=0;frame<=24;frame+=.5){
          const point=transform(pose('sit_down',frame).subarray(index*16,index*16+16),sole);
          expect(Math.hypot(...point.map((v,i)=>v-anchor[i]))).toBeLessThan(.00002);
        }
      }
    }
  });
});
