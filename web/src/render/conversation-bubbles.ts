import {spriteIndex} from './atlas.js';

const TOPICS: readonly (string | null)[] = [
  null, null, null, 'Eat', 'Talk', 'Sleep', null, 'Use', 'Reading',
  'Exercise', 'WatchFish', 'Sitting', 'Shower', 'Toilet', 'TV', 'LyingDown',
  'WashHands', 'WashDishes', 'Radio', 'Correspondence', 'Bath', 'Ingredients',
  'PrepareFood', 'Cooking',
];
const LIKED = TOPICS.map(topic => topic === null ? null : spriteIndex(`conversation${topic}Like`));
const DISLIKED = TOPICS.map(topic => topic === null ? null : spriteIndex(`conversation${topic}Dislike`));

/** Topic decisions belong to the simulation; this only selects their artwork. */
export function conversationBubble(activity: number, topic: number, preference: number): number | null {
  if (activity !== 4) return null;
  return (preference < 0 ? DISLIKED : LIKED)[topic] ?? null;
}

/** The existing linen background shifts toward muted green or red; ink stays dark. */
export function conversationTint(preference: number, channel: number): number {
  const strength = Number.isFinite(preference) ? Math.min(1, Math.abs(preference)) : 0;
  const reduction = preference < 0
    ? (channel === 0 ? 0.01 : channel === 1 ? 0.22 : 0.24)
    : (channel === 0 ? 0.18 : channel === 1 ? 0.015 : 0.24);
  return 1 - strength * reduction;
}
