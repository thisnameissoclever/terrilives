/** Reject resources rebuilt on a device that was lost while construction awaited. */
export class DeviceLifetime {
  private readonly lost = new WeakSet<GPUDevice>();
  watch(device: GPUDevice, onLoss: () => void): void {
    void device.lost.then(() => { this.lost.add(device); onLoss(); });
  }
  assertAvailable(device: GPUDevice): void {
    if (this.lost.has(device)) throw new Error('Graphics device was lost during recovery.');
  }
}
