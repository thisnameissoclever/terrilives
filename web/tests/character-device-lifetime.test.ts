import { expect, it } from 'vitest';
import { DeviceLifetime } from '../src/render/character/device-lifetime.js';

it('rejects a replacement lost while its resources are rebuilding', async () => {
  let lose!: (info: GPUDeviceLostInfo) => void;
  const device = { lost: new Promise<GPUDeviceLostInfo>(resolve => { lose = resolve; }) } as GPUDevice;
  const lifetime = new DeviceLifetime();
  let rebuilding = true, callbacks = 0;
  lifetime.watch(device, () => { if (!rebuilding) callbacks++; });
  lifetime.assertAvailable(device);
  lose({ reason: 'destroyed', message: 'second device loss' } as GPUDeviceLostInfo);
  await device.lost;
  rebuilding = false;
  expect(callbacks).toBe(0);
  expect(() => lifetime.assertAvailable(device)).toThrow('lost during recovery');
});
