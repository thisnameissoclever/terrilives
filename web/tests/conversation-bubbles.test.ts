import {readFileSync} from 'node:fs';
import {beforeAll, describe, expect, it} from 'vitest';
import init, {SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {conversationBubbles} from '../src/render/conversation-bubbles.js';
import {spriteIndex} from '../src/render/atlas.js';
import {RANDOM_FIGHT_BIT, type TopicRow} from '../src/topic-table.js';

/** A small table: the topic value of a row is its place plus one. */
const TABLE: readonly TopicRow[] = [
  {kind: 'smalltalk', icon: 'Talk', label: ''},
  {kind: 'activity', icon: 'Reading', label: 'reading'},
  {kind: 'activity', icon: 'Cooking', label: 'cooking'},
  {kind: 'fight', icon: 'WashDishes', label: 'the dishes'},
  {kind: 'fight', icon: 'Talk', label: ''},
];
const [SMALLTALK, READING, COOKING, DISHES, PLAIN_FIGHT] = [1, 2, 3, 4, 5];
const bubbles = conversationBubbles(TABLE);

describe('conversation bubbles', () => {
  it('uses topic and personal reaction without changing the activity', () => {
    expect(bubbles.bubble(4, READING, 0.5)).toBe(spriteIndex('conversationReadingLike'));
    expect(bubbles.bubble(4, READING, -0.5)).toBe(spriteIndex('conversationReadingDislike'));
    expect(bubbles.bubble(4, COOKING, 0)).toBe(spriteIndex('conversationCookingLike'));
    expect(bubbles.bubble(4, SMALLTALK, 0)).toBe(spriteIndex('conversationTalkLike'));
    expect(bubbles.bubble(8, READING, 1)).toBeNull();
    expect(bubbles.bubble(4, 0, 1)).toBeNull();
    expect(bubbles.bubble(4, 999, 1)).toBeNull();
  });

  it('draws a fight in its disapproval symbol and a strong red whatever the preference', () => {
    expect(bubbles.bubble(4, DISHES, 1)).toBe(spriteIndex('conversationWashDishesDislike'));
    expect(bubbles.bubble(4, DISHES, 0)).toBe(spriteIndex('conversationWashDishesDislike'));
    expect(bubbles.bubble(4, PLAIN_FIGHT, -1)).toBe(spriteIndex('conversationTalkDislike'));
    expect(bubbles.bubble(8, DISHES, -1)).toBeNull();
    expect([0, 1, 2].map(channel => bubbles.tint(-1, channel, DISHES))).toEqual([1, 0.42, 0.42]);
    expect([0, 1, 2].map(channel => bubbles.tint(1, channel, PLAIN_FIGHT))).toEqual([1, 0.42, 0.42]);
    expect(bubbles.tint(-1, 1, COOKING)).toBe(0.78);
  });

  it('draws a random fight as its activity row in red', () => {
    const random = COOKING | RANDOM_FIGHT_BIT;
    expect(bubbles.bubble(4, random, 1)).toBe(spriteIndex('conversationCookingDislike'));
    expect(bubbles.bubble(4, random, 0)).toBe(bubbles.bubble(4, COOKING, -1));
    expect([0, 1, 2].map(channel => bubbles.tint(0, channel, random))).toEqual([1, 0.42, 0.42]);
  });

  it('keeps neutral white and smoothly increases readable green or red', () => {
    expect([0, 1, 2].map(channel => bubbles.tint(0, channel))).toEqual([1, 1, 1]);
    expect([0, 1, 2].map(channel => bubbles.tint(1, channel))).toEqual([1 - 0.18, 0.985, 0.76]);
    expect([0, 1, 2].map(channel => bubbles.tint(-1, channel))).toEqual([0.99, 0.78, 0.76]);
    expect(bubbles.tint(0.5, 0)).toBeCloseTo(0.91);
    expect(bubbles.tint(-0.5, 1)).toBeCloseTo(0.89);
    expect(bubbles.tint(Infinity, 0)).toBe(1);
    expect(bubbles.tint(NaN, 0)).toBe(1);
    expect(bubbles.tint(2, 0)).toBeCloseTo(0.82);
  });

  it('draws no bubble without a table, and builds each table once', () => {
    expect(conversationBubbles(undefined).bubble(4, 1, 1)).toBeNull();
    expect(conversationBubbles([]).bubble(4, 1, 1)).toBeNull();
    expect(conversationBubbles(TABLE)).toBe(bubbles);
  });
});

/**
 * The 54-entry code-indexed table the shell used before topics moved into
 * content, kept here only to prove the table-built lookup draws the same
 * sprite and tint for every old code.
 */
const LEGACY_TOPICS: readonly (string | null)[] = [
  null, null, null, 'Eat', 'Talk', 'Sleep', null, 'Use', 'Reading',
  'Exercise', 'WatchFish', 'Sitting', 'Shower', 'Toilet', 'TV', 'LyingDown',
  'WashHands', 'WashDishes', 'Radio', 'Correspondence', 'Bath', 'Ingredients',
  'PrepareFood', 'Cooking', 'WashDishes', 'WashDishes', 'Talk',
  'Toilet', 'TV', 'Radio', 'Exercise', 'Use', 'Talk',
  'Eat', 'Talk', 'Sleep', null, 'Use', 'Reading', 'Exercise', 'WatchFish',
  'Sitting', 'Shower', 'Toilet', 'TV', 'LyingDown', 'WashHands', 'WashDishes',
  'Radio', 'Correspondence', 'Bath', 'Ingredients', 'PrepareFood', 'Cooking',
];
const LEGACY_FIRST_FIGHT = 24;
const legacySprite = (topic: number, reaction: 'Like' | 'Dislike'): number | null => {
  const icon = LEGACY_TOPICS[topic];
  return icon === null || icon === undefined ? null : spriteIndex(`conversation${icon}${reaction}`);
};
function legacyBubble(topic: number, preference: number): number | null {
  if (topic >= LEGACY_FIRST_FIGHT) return legacySprite(topic, 'Dislike');
  return legacySprite(topic, preference < 0 ? 'Dislike' : 'Like');
}
function legacyTint(preference: number, channel: number, topic: number): number {
  if (topic >= LEGACY_FIRST_FIGHT) return channel === 0 ? 1 : 0.42;
  const strength = Number.isFinite(preference) ? Math.min(1, Math.abs(preference)) : 0;
  const reduction = preference < 0
    ? (channel === 0 ? 0.01 : channel === 1 ? 0.22 : 0.24)
    : (channel === 0 ? 0.18 : channel === 1 ? 0.015 : 0.24);
  return 1 - strength * reduction;
}

/** Every saved chat tag and the activity code it has always saved. */
const LEGACY_CHAT_TAGS: readonly (readonly [string, number])[] = [
  ['reading', 8], ['exercise', 9], ['aquarium', 10], ['fish', 10], ['television', 14], ['tv', 14],
  ['music', 18], ['radio', 18], ['socialising', 4], ['smalltalk', 4], ['lounging', 15],
  ['correspondence', 19], ['cooking', 23], ['eating', 3], ['food', 3], ['sleeping', 5], ['sleep', 5],
  ['sitting', 11], ['comfort', 11], ['showering', 12], ['shower', 12], ['toilet', 13], ['bathing', 20],
  ['bath', 20], ['washing', 16], ['hygiene', 16], ['cleaning', 17],
  // Not in the code list, so it has always saved the generic code 7.
  ['bathroom_privacy', 7],
];
const LEGACY_FIGHT_TAGS: readonly (readonly [string, number])[] = [
  ['fight-dishes', 24], ['fight-chore', 25], ['fight', 26], ['fight-privacy', 27],
  ['fight-television', 28], ['fight-music', 29], ['fight-exercise', 30], ['fight-nuisance', 31],
  ['fight-interruption', 32],
];
/** A random fight about activity code n saved as code n + 30. */
const RANDOM_FIGHT_CODES = [3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const PREFERENCES = [-1, -0.5, -0.01, 0, 0.01, 0.5, 1];

let memory: WebAssembly.Memory;
beforeAll(async () => { memory = (await init({module_or_path: readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory; });

describe('the topic table from the simulation', () => {
  it('names a sprite for every icon, in both reactions', () => {
    const handle = SimHandle.from_lot();
    try {
      const table = new SimBridge(handle, memory).conversationTopicTable();
      expect(table.length).toBeGreaterThan(30);
      for (const row of table) {
        expect(() => spriteIndex(`conversation${row.icon}Like`), row.icon).not.toThrow();
        expect(() => spriteIndex(`conversation${row.icon}Dislike`), row.icon).not.toThrow();
      }
    } finally {
      handle.free();
    }
  });

  it('legacy_topic_codes_keep_their_art', () => {
    const handle = SimHandle.from_lot();
    try {
      const bridge = new SimBridge(handle, memory);
      const table = bridge.conversationTopicTable();
      const labels = bridge.activityLogLabels();
      const values = bridge.activityLogTopicRows();
      const lookup = conversationBubbles(table);
      const valueOf = (tag: string): number => {
        const at = labels.indexOf(tag);
        expect(at, `the label table holds ${tag}`).toBeGreaterThanOrEqual(0);
        return values[at];
      };
      const cases = [
        ...LEGACY_CHAT_TAGS,
        ...LEGACY_FIGHT_TAGS,
        ...RANDOM_FIGHT_CODES.map(code => [`fight-random-${code}`, code + 30] as const),
      ];
      const covered = new Set<number>();
      for (const [tag, code] of cases) {
        const value = valueOf(tag);
        expect(value, `${tag} names a topic`).not.toBe(0);
        covered.add(code);
        for (const preference of PREFERENCES) {
          expect(lookup.bubble(4, value, preference), `${tag} bubble at ${preference}`).toBe(legacyBubble(code, preference));
          for (const channel of [0, 1, 2]) {
            expect(lookup.tint(preference, channel, value), `${tag} tint ${channel} at ${preference}`)
              .toBe(legacyTint(preference, channel, code));
          }
        }
      }
      // Every code the old table drew is reached by some saved tag. Codes 21
      // and 22 (ingredients, preparing food) are only ever a random fight's.
      const fightOnly = new Set([21, 22]);
      for (let code = 3; code < LEGACY_TOPICS.length; code++) {
        if (LEGACY_TOPICS[code] === null || fightOnly.has(code)) continue;
        expect(covered.has(code), `code ${code}`).toBe(true);
      }
    } finally {
      handle.free();
    }
  });
});
