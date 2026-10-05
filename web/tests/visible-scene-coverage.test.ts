import { describe, expect, it } from 'vitest';
import { visibleSceneOwner } from '../src/render/visible-scene-coverage.js';

describe('additive visible scene ownership', () => {
  it('does not attenuate already visible contributions a second time', () => {
    expect(visibleSceneOwner(.22, .18, .12, .1)).toBe('body');
  });
  it('assigns each opaque pixel to its visible owner, including ink', () => {
    expect(visibleSceneOwner(.1, .6, .2, .01)).toBe('furniture');
    expect(visibleSceneOwner(.1, .2, .6, .55)).toBe('body');
    expect(visibleSceneOwner(.1, .2, .6, .02)).toBe('furniture');
  });
  it('ignores transparent canvas and gives a tie to the body', () => {
    expect(visibleSceneOwner(.1, .1, .1, .02)).toBeNull();
    expect(visibleSceneOwner(.25, .25, 0, 0)).toBe('body');
  });
});
