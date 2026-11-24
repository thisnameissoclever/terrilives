import { expect, it } from 'vitest';
import { activityStatusLabel, decodeActivityStatus } from '../src/activity-status.js';
it('reports blocked return separately from working or waiting for another person', () => {
  const status = decodeActivityStatus(new Uint32Array([9,0xffffffff,0]));
  expect(status).toEqual({code:9,partner:null,needs:0});
  expect(activityStatusLabel(status!,'')).toBe('Waiting outside: no route home');
  expect(decodeActivityStatus(new Uint32Array([10,0xffffffff,0]))).toBeNull();
});
