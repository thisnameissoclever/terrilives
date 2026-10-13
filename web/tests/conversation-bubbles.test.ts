import {describe, expect, it} from 'vitest';
import {conversationBubble, conversationTint} from '../src/render/conversation-bubbles.js';
import {spriteIndex} from '../src/render/atlas.js';

describe('conversation bubbles', () => {
  it('uses topic and personal reaction without changing the activity', () => {
    expect(conversationBubble(4, 8, 0.5)).toBe(spriteIndex('conversationReadingLike'));
    expect(conversationBubble(4, 8, -0.5)).toBe(spriteIndex('conversationReadingDislike'));
    expect(conversationBubble(4, 23, 0)).toBe(spriteIndex('conversationCookingLike'));
    expect(conversationBubble(8, 8, 1)).toBeNull();
    expect(conversationBubble(4, 0, 1)).toBeNull();
    expect(conversationBubble(4, 999, 1)).toBeNull();
  });

  it('keeps neutral white and smoothly increases readable green or red', () => {
    expect([0, 1, 2].map(channel => conversationTint(0, channel))).toEqual([1, 1, 1]);
    expect([0, 1, 2].map(channel => conversationTint(1, channel))).toEqual([1 - 0.18, 0.985, 0.76]);
    expect([0, 1, 2].map(channel => conversationTint(-1, channel))).toEqual([0.99, 0.78, 0.76]);
    expect(conversationTint(0.5, 0)).toBeCloseTo(0.91);
    expect(conversationTint(-0.5, 1)).toBeCloseTo(0.89);
    expect(conversationTint(Infinity, 0)).toBe(1);
    expect(conversationTint(NaN, 0)).toBe(1);
    expect(conversationTint(2, 0)).toBeCloseTo(0.82);
  });
});
