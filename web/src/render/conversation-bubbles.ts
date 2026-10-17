import {spriteIndex} from './atlas.js';

/**
 * Codes 24 to 26 are fights (issue 248): over the dishes, over another
 * chore, and with no reason. No broom art is authored, so a fight over
 * another chore borrows the dish-washing symbol.
 */
const TOPICS: readonly (string | null)[] = [
  null, null, null, 'Eat', 'Talk', 'Sleep', null, 'Use', 'Reading',
  'Exercise', 'WatchFish', 'Sitting', 'Shower', 'Toilet', 'TV', 'LyingDown',
  'WashHands', 'WashDishes', 'Radio', 'Correspondence', 'Bath', 'Ingredients',
  'PrepareFood', 'Cooking', 'WashDishes', 'WashDishes', 'Talk',
];
/** The first topic code that is a fight rather than a conversation subject. */
export const FIRST_FIGHT_TOPIC = 24;
const LIKED = TOPICS.map(topic => topic === null ? null : spriteIndex(`conversation${topic}Like`));
const DISLIKED = TOPICS.map(topic => topic === null ? null : spriteIndex(`conversation${topic}Dislike`));

/** Topic decisions belong to the simulation; this only selects their artwork. */
export function conversationBubble(activity: number, topic: number, preference: number): number | null {
  if (activity !== 4) return null;
  if (topic >= FIRST_FIGHT_TOPIC) return DISLIKED[topic] ?? null;
  return (preference < 0 ? DISLIKED : LIKED)[topic] ?? null;
}

/**
 * The existing linen background shifts toward muted green or red; ink stays
 * dark. A fight topic goes a strong red regardless of preference, so both
 * participants' bubbles read as an argument at a glance.
 */
export function conversationTint(preference: number, channel: number, topic = 0): number {
  if (topic >= FIRST_FIGHT_TOPIC) return channel === 0 ? 1 : 0.42;
  const strength = Number.isFinite(preference) ? Math.min(1, Math.abs(preference)) : 0;
  const reduction = preference < 0
    ? (channel === 0 ? 0.01 : channel === 1 ? 0.22 : 0.24)
    : (channel === 0 ? 0.18 : channel === 1 ? 0.015 : 0.24);
  return 1 - strength * reduction;
}
