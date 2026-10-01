import { expect, it, vi } from 'vitest';
import { RoomAmbiencePlayer } from '../src/audio/room-ambience.js';
const param = () => ({setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn()});
function setup() {
  const sources: any[] = [], gains: any[] = [];
  const context = {currentTime: 10, createGain() { const node = {gain: param(), connect: vi.fn(), disconnect: vi.fn()}; gains.push(node); return node; },
    createBufferSource() { const node = {buffer: null, playbackRate: param(), onended: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn()}; sources.push(node); return node; }};
  return {context, sources, gains, player: new RoomAmbiencePlayer(context, {})};
}
it('owns one source and disconnects immediately without an end callback', () => {
  const {player, sources} = setup();
  expect(player.play({duration: 8})).toBe(true);
  expect(player.play({duration: 8})).toBe(true);
  expect(player.activeCount()).toBe(1);
  expect(sources).toHaveLength(1);
  player.stop(true);
  expect(player.retainedCount()).toBe(0);
  expect(sources[0].disconnect).toHaveBeenCalledOnce();
});
it('bounds rapid replacements to one active and one releasing source, preserving stale callback identity', () => {
  const {player, context, sources, gains} = setup();
  player.play({duration: 8});
  const stale = sources[0].onended;
  context.currentTime += 0.05;
  player.stop();
  expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenLastCalledWith(0, 10.15);
  for (let i = 0; i < 20; i++) { player.play({duration: 8}); player.stop(); }
  player.play({duration: 8});
  expect(player.activeCount()).toBe(1);
  expect(player.retainedCount()).toBe(2);
  stale();
  expect(player.activeCount()).toBe(1);
  player.stop();
  expect(player.retainedCount()).toBe(1);
  context.currentTime += 0.2;
  player.sweep();
  expect(player.retainedCount()).toBe(0);
});
it.each(['gain', 'connect', 'parameter', 'start', 'stop'])('cleans all ownership after %s failure', stage => {
  const {player, context, sources, gains} = setup();
  if (stage === 'gain') vi.spyOn(context, 'createGain').mockImplementationOnce(() => { throw Error('hardware'); });
  if (stage === 'connect' || stage === 'parameter' || stage === 'start') {
    const create = context.createBufferSource.bind(context);
    vi.spyOn(context, 'createBufferSource').mockImplementationOnce(() => {
      const source = create();
      const method = stage === 'parameter' ? source.playbackRate.setValueAtTime : source[stage];
      method.mockImplementationOnce(() => { throw Error('hardware'); }); return source;
    });
  }
  expect(player.play({duration: 8})).toBe(stage === 'stop');
  if (stage === 'stop') { sources[0].stop.mockImplementationOnce(() => { throw Error('hardware'); }); player.stop(); }
  expect(player.retainedCount()).toBe(0);
  expect(sources.every(source => source.disconnect.mock.calls.length === 1)).toBe(true);
  expect(gains.every(gain => gain.disconnect.mock.calls.length === 1)).toBe(true);
});
it.each([0, -1, NaN, Infinity])('rejects invalid duration %s before allocating nodes', duration => {
  const {player, sources} = setup(); expect(player.play({duration})).toBe(false); expect(sources).toHaveLength(0);
});
