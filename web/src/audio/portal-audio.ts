import type { GameAudioEventSink } from './audio-controller.js';

interface PortalTrack {
  x: number;
  y: number;
  farX: number;
  farY: number;
  id: string;
  previous: number;
  current: number;
  seen: boolean;
}

/** Geometry is identity. Reuse tracks so steady ticks create no per-door objects. */
export class PortalAudioScheduler {
  private readonly tracks: PortalTrack[] = [];
  private count = 0;
  constructor(private readonly sink: GameAudioEventSink) {}
  beginFrame(): void {
    for (let i = 0; i < this.count; i++) this.tracks[i].seen = false;
  }
  observe(x: number, y: number, farX: number, farY: number, state: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(farX) || !Number.isFinite(farY)) return;
    const current = Number.isInteger(state) && state >= 0 && state <= 3 ? state : -1;
    let index = 0;
    for (; index < this.count; index++) {
      const track = this.tracks[index];
      if (track.x === x && track.y === y && track.farX === farX && track.farY === farY) break;
    }
    if (index === this.count) {
      const track = this.tracks[index] ?? (this.tracks[index] = {
        x, y, farX, farY, id: '', previous: -1, current: -1, seen: false,
      });
      track.x = x; track.y = y; track.farX = farX; track.farY = farY;
      track.id = `${x}:${y}:${farX}:${farY}`;
      track.previous = -1;
      track.seen = false;
      this.count++;
    }
    const track = this.tracks[index];
    track.current = track.seen && track.current !== current ? -1 : current;
    track.seen = true;
  }
  endFrame(): void {
    for (let i = this.count - 1; i >= 0; i--) {
      const track = this.tracks[i];
      if (!track.seen) {
        this.count--;
        this.tracks[i] = this.tracks[this.count];
        this.tracks[this.count] = track;
        continue;
      }
      if (track.previous >= 0 && track.current >= 0) {
        if (track.previous === 0 && track.current !== 0) {
          this.sink.emit({ type: 'door.opened', doorId: track.id });
        } else if (track.previous !== 0 && track.current === 0) {
          this.sink.emit({ type: 'door.closed', doorId: track.id });
        }
      }
      track.previous = track.current;
    }
  }
  reset(): void { this.count = 0; }
  activeTrackCount(): number { return this.count; }
  trackCapacity(): number { return this.tracks.length; }
}
