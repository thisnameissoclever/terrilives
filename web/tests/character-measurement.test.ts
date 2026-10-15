import {afterEach,expect,it,vi} from 'vitest';
import {CharacterFrameMeasurement} from '../src/render/character/measurement.js';

afterEach(()=>vi.restoreAllMocks());

it('keeps callback delay, execution, and graphics completion separate without discarding latency',async()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const pending:(()=>void)[]=[];
  const queue={onSubmittedWorkDone:()=>new Promise<void>(resolve=>pending.push(resolve))} as GPUQueue;
  const measurement=new CharacterFrameMeasurement(()=>queue),result=measurement.start(1000);
  measurement.frame(980,988,990);
  now=995;pending[0]();await Promise.resolve();
  measurement.frame(1000,1010,1016);
  now=1020;pending[1]();
  const report=await result;
  expect(report.timingVersion).toBe(2);
  expect(report.cpuMs).toEqual([2,6]);
  expect(report.callbackDelayMs).toEqual([8,10]);
  expect(report.frameLatencyMs).toEqual([10,16]);
  expect(report.completionMs).toEqual([7,10]);
  expect(report.latencyMs).toEqual([15,20]);
  expect(report.intervalMs).toEqual([20]);
  expect(report.timestamps).toEqual({animation:[980,1000],entered:[988,1010],cpuEnd:[990,1016],completed:[995,1020]});
});

it('waits for all submitted frames before finishing a measurement',async()=>{
  let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now);
  const pending:(()=>void)[]=[];
  const measurement=new CharacterFrameMeasurement(()=>({onSubmittedWorkDone:()=>new Promise<void>(resolve=>pending.push(resolve))}) as GPUQueue);
  let finished=false;const result=measurement.start(1000).then(report=>{finished=true;return report;});
  measurement.frame(980,981,983);measurement.frame(1000,1001,1004);
  now=1008;pending[1]();await Promise.resolve();expect(finished).toBe(false);
  now=1010;pending[0]();expect((await result).samples).toBe(2);
});
