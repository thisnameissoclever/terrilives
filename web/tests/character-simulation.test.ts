import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import init from '../src/wasm/terri_wasm.js';
import { createMotionStudy } from '../proofs/character-simulation.js';
import { distanceAnimationFrame, tickAnimationFrame } from '../src/render/sim-animation.js';

let memory: WebAssembly.Memory;
beforeAll(async()=>{memory=(await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;});

it('samples real walking and reading states in all four simulation facings',()=>{
  for(const mode of ['walk','read'] as const)for(const facing of [1,2,3,4]){
    const study=createMotionStudy(memory,mode,facing);
    try{
      const value=study.sample();
      expect(value.action).toBe(mode);expect(value.facing).toBe(facing);
      expect(value.entity).toBe(study.entity);
      const expected=mode==='walk'?distanceAnimationFrame(value.x,value.y,facing,8,1,false)
        :tickAnimationFrame(value.tick,value.entity%24,4,12,false);
      expect(Math.floor(value.frame)).toBe(expected);
      const hash=study.sim.worldHash(),paused=study.sample();study.advance(1000);
      expect(study.sim.worldHash()).toBe(hash);expect(study.sample()).toEqual(paused);
      if(mode==='read') {
        study.play(true);
        for(let i=0;i<24;i++) {
          study.advance(50);const reading=study.sample();
          expect(reading.action).toBe('read');
          expect([reading.x,reading.y]).toEqual([value.x,value.y]);
        }
        expect((study.sample().frame-value.frame+4)%4).toBeCloseTo(1,8);
      } else {
        study.play(true);const frames=new Set<number>();
        for(let i=0;i<8;i++) {
          study.advance(50);const walking=study.sample();
          const row=study.sim.ids().indexOf(study.entity),current=study.sim.positions(),previous=study.sim.prevPositions();
          expect(walking.x).toBe(previous[row*2]+(current[row*2]-previous[row*2])*walking.alpha);
          expect(walking.y).toBe(previous[row*2+1]+(current[row*2+1]-previous[row*2+1])*walking.alpha);
          expect(Math.floor(walking.frame)).toBe(distanceAnimationFrame(walking.x,walking.y,walking.facing,8,1,false));
          frames.add(walking.frame);
        }
        expect(frames.size).toBeGreaterThan(1);
      }
      study.destroy();
    }catch(error){study.destroy();throw error;}
  }
});

it('gives the same real motion at 30 and 60 presentation frames per second',()=>{
  const a=createMotionStudy(memory,'walk',1),b=createMotionStudy(memory,'walk',1);
  try{
    a.play(true);b.play(true);
    for(let i=0;i<30;i++)a.advance(1000/30);
    for(let i=0;i<60;i++)b.advance(1000/60);
    expect(a.sim.worldHash()).toBe(b.sim.worldHash());
    expect(a.sample().x).toBeCloseTo(b.sample().x,5);expect(a.sample().frame).toBeCloseTo(b.sample().frame,5);
    expect(a.sample().simulationTick).toBe(b.sample().simulationTick);
    expect(a.sample().tick).toBeCloseTo(b.sample().tick,12);
  }finally{a.destroy();b.destroy();}
});

it('resumes from an explicit step without retaining an older fractional tick',()=>{
  const study=createMotionStudy(memory,'walk',1);
  try{
    study.play(true);study.advance(50);expect(study.sample().alpha).toBeCloseTo(.5,10);
    study.step();const stepped=study.sample();expect(stepped.alpha).toBe(0);
    study.play(true);study.advance(10);
    expect(study.sample().alpha).toBeCloseTo(.1,10);
    expect(study.sample().simulationTick).toBe(stepped.simulationTick);
  }finally{study.destroy();}
});
