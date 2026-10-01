import { describe, expect, it, vi } from 'vitest';
import { ObjectLoopPlayer, type ObjectLoopClips } from '../src/audio/object-loops.js';

class Param {
  calls: Array<[string, number, number?]> = [];
  cancelScheduledValues(time: number): void { this.calls.push(['cancel', time]); }
  setValueAtTime(value: number, time: number): void { this.calls.push(['set', value, time]); }
  linearRampToValueAtTime(value: number, time: number): void { this.calls.push(['ramp', value, time]); }
}
class Gain {
  gain = new Param();
  connections: unknown[] = [];
  disconnected = false;
  connect(output: unknown): void { this.connections.push(output); }
  disconnect(): void { this.disconnected = true; }
}
class Source extends Gain {
  buffer: { duration: number } | null = null;
  playbackRate = new Param();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  starts: Array<[number, number]> = [];
  stops: number[] = [];
  start(when = 0, offset = 0): void { this.starts.push([when, offset]); }
  stop(when = 0): void { this.stops.push(when); }
}
class Context {
  currentTime = 10;
  gains: Gain[] = [];
  sources: Source[] = [];
  createGain(): Gain { const gain = new Gain(); this.gains.push(gain); return gain; }
  createBufferSource(): Source { const source = new Source(); this.sources.push(source); return source; }
}
const shower = { buffer: { duration: 4 }, gain: 0.3, loopStart: 0.5, loopEnd: 3.5 };
const stove = { buffer: { duration: 2 }, gain: 0.2, loopStart: 0, loopEnd: 2 };
const clips: ObjectLoopClips = new Map([[1, shower], [2, stove]]);
function setup() {
  const context = new Context();
  const output = {};
  const player = new ObjectLoopPlayer(context, output);
  player.setClips(clips);
  return { context, output, player };
}

describe('ObjectLoopPlayer', () => {
  it('immediately releases only the exact source and action without waiting for its clock', () => {
    const { context, player } = setup();
    player.play(41, 1);
    player.play(42, 1);
    player.play(41, 2);
    player.stop(41, 1, true);
    expect(player.activeLoopCount()).toBe(2);
    expect(context.sources[2].disconnected).toBe(false);
    player.stop(41, 2, true);
    expect(player.activeLoopCount()).toBe(1);
    expect(player.retainedLoopCount()).toBe(2);
    expect(context.sources[2].disconnected).toBe(true);
    expect(context.sources[2].onended).toBe(null);
    expect(context.gains[2].disconnected).toBe(true);
    expect(context.sources[1].stops).toEqual([]);
    expect(context.sources[1].disconnected).toBe(false);
  });

  it('replaces only changed installed clips and releases removed clips', () => {
    const { context, player } = setup();
    player.play(1, 1);
    player.play(2, 2);
    player.setClips(new Map([[1, { ...shower }], [2, { ...stove, gain: 0.4 }]]));
    expect(context.sources[0].stops).toEqual([]);
    expect(context.sources[1].stops).toEqual([10.02]);
    expect(player.play(2, 2)).toBe(true);
    expect(context.gains[2].gain.calls[1]).toEqual(['ramp', 0.4, 10.02]);
    player.setClips(new Map());
    expect(player.activeLoopCount()).toBe(0);
    expect(player.play(1, 1)).toBe(false);
  });
  it.each(['gain', 'connect', 'parameter', 'start'] as const)('cleans every allocated node after %s construction failure', stage => {
    const { context, player } = setup();
    if (stage === 'gain') vi.spyOn(context, 'createGain').mockImplementationOnce(() => { throw Error('hardware'); });
    if (stage === 'connect') vi.spyOn(Source.prototype, 'connect').mockImplementationOnce(() => { throw Error('hardware'); });
    if (stage === 'parameter') vi.spyOn(Param.prototype, 'setValueAtTime').mockImplementationOnce(() => { throw Error('hardware'); });
    if (stage === 'start') vi.spyOn(Source.prototype, 'start').mockImplementationOnce(() => { throw Error('hardware'); });
    expect(player.play(41, 1)).toBe(false);
    expect(context.sources.every(source => source.disconnected)).toBe(true);
    expect(context.gains.every(gain => gain.disconnected)).toBe(true);
    expect(player.retainedLoopCount()).toBe(0);
    expect(player.activeLoopCount()).toBe(0);
    expect(player.play(41, 1)).toBe(true);
    vi.restoreAllMocks();
  });

  it('isolates stop and disconnect failures and still clears all ownership', () => {
    const { context, player } = setup();
    player.play(1, 1);
    player.play(2, 2);
    vi.spyOn(context.sources[0], 'stop').mockImplementation(() => { throw Error('hardware'); });
    vi.spyOn(context.sources[0], 'disconnect').mockImplementation(() => { throw Error('hardware'); });
    expect(() => player.stopAll(true)).not.toThrow();
    expect(context.gains.every(gain => gain.disconnected)).toBe(true);
    expect(context.sources[1].disconnected).toBe(true);
    expect(player.retainedLoopCount()).toBe(0);
    expect(player.activeLoopCount()).toBe(0);
  });

  it('tears down a loop if its release scheduling fails', () => {
    const { context, player } = setup();
    player.play(1, 1);
    vi.spyOn(context.gains[0].gain, 'cancelScheduledValues').mockImplementation(() => { throw Error('hardware'); });
    expect(() => player.stop(1, 1)).not.toThrow();
    expect(context.sources[0].disconnected).toBe(true);
    expect(player.retainedLoopCount()).toBe(0);
  });
  it('admits four stable sources and at most eight retained nodes during same-clock churn', () => {
    const { context, player } = setup();
    for (let source = 1; source <= 4; source++) expect(player.play(source, 1)).toBe(true);
    expect(player.play(5, 1)).toBe(false);
    expect(context.sources).toHaveLength(4);
    player.stop(2, 1);
    expect(player.play(5, 1)).toBe(true);
    expect(context.sources[0].stops).toEqual([]);
    player.stopAll();
    for (let source = 6; source <= 8; source++) expect(player.play(source, 1)).toBe(true);
    expect(player.play(9, 1)).toBe(false);
    expect(player.retainedLoopCount()).toBe(8);
    context.currentTime = 11;
    player.sweep();
    expect(player.play(9, 1)).toBe(true);
    expect(player.activeLoopCount()).toBe(4);
    player.stopAll(true);
    expect(player.retainedLoopCount()).toBe(0);
    expect(context.sources.every(source => source.disconnected)).toBe(true);
  });

  it.each([
    { buffer: { duration: 0 } }, { buffer: { duration: NaN } },
    { gain: NaN }, { gain: -0.1 }, { gain: Infinity },
    { loopStart: -1 }, { loopStart: NaN }, { loopEnd: Infinity },
    { loopEnd: 5 }, { loopEnd: 0.5 },
  ])('rejects invalid prepared clip %j without allocating audio nodes', invalid => {
    const { context, player } = setup();
    player.setClips(new Map([[1, { ...shower, ...invalid }]]));
    expect(player.play(1, 1)).toBe(false);
    expect(context.sources).toHaveLength(0);
  });

  it('owns an installation snapshot without editing or accepting later caller mutations', () => {
    const { context, player } = setup();
    const clip = { ...shower };
    const supplied = new Map<1, typeof shower>([[1, clip]]);
    player.setClips(supplied);
    supplied.clear();
    clip.loopStart = 3;
    expect(player.play(1, 1)).toBe(true);
    expect(context.sources[0].loopStart).toBe(0.5);
  });
  it('stops only the exact action and source, preserving an unrelated loop', () => {
    const { context, player } = setup();
    player.play(41, 1);
    player.play(42, 1);
    context.currentTime = 11;
    player.play(41, 2);
    player.stop(41, 1);
    expect(context.sources).toHaveLength(3);
    expect(context.sources[0].stops).toEqual([11.02]);
    expect(context.sources[1].stops).toEqual([]);
    expect(context.sources[2].stops).toEqual([]);
    expect(player.activeLoopCount()).toBe(2);
    expect(player.retainedLoopCount()).toBe(3);
    context.sources[0].onended?.();
    expect(context.sources[0].disconnected).toBe(true);
    expect(player.retainedLoopCount()).toBe(2);
    player.stop(41, 2);
    expect(context.sources[2].stops).toEqual([11.02]);
    expect(player.activeLoopCount()).toBe(1);
  });

  it('preserves attack trajectory on early stop and drains only after audio time advances', () => {
    const { context, player } = setup();
    player.play(41, 1);
    context.currentTime = 10.005;
    player.stop(41, 1);
    const calls = context.gains[0].gain.calls;
    expect(calls[3][0]).toBe('ramp');
    expect(calls[3][1]).toBeCloseTo(0.075);
    expect(calls[3][2]).toBe(10.005);
    expect(calls[4]).toEqual(['set', calls[3][1], 10.005]);
    expect(calls[5]).toEqual(['ramp', 0, 10.025]);
    player.sweep();
    expect(context.sources[0].disconnected).toBe(false);
    context.currentTime = 10.026;
    player.sweep();
    expect(context.sources[0].disconnected).toBe(true);
    expect(context.gains[0].disconnected).toBe(true);
    expect(player.retainedLoopCount()).toBe(0);
  });
  it('plays one exact object/action with authored loop bounds and gain', () => {
    const { context, output, player } = setup();
    expect(player.play(41, 1)).toBe(true);
    expect(player.play(41, 1)).toBe(true);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]).toMatchObject({ buffer: shower.buffer, loop: true, loopStart: 0.5, loopEnd: 3.5, starts: [[10, 0.5]] });
    expect(context.sources[0].connections).toEqual([context.gains[0]]);
    expect(context.gains[0].connections).toEqual([output]);
    expect(context.gains[0].gain.calls).toEqual([['set', 0, 10], ['ramp', 0.3, 10.02]]);
  });
});
