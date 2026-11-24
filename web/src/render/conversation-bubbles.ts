import {spriteIndex} from './atlas.js';
import {isFightTopic, topicRow, type TopicRow} from '../topic-table.js';
import {preferenceHundredths, reactionOf, type ReactionBands} from '../reaction-band.js';

/** A bubble sprite by name, or null for a name the atlas lacks. */
function sprite(icon: string, reaction: 'Like' | 'Dislike' | 'Neutral'): number | null {
  try {
    return spriteIndex(`conversation${icon}${reaction}`);
  } catch {
    return null;
  }
}

/** Which of a topic's three bubbles a preference draws. */
type Face = 'like' | 'dislike' | 'neutral';

/**
 * The sprite and tint for each topic, built from the simulation's topic table
 * so that content, not this file, says what each topic looks like. A fight row
 * and a random fight draw the Dislike sprite and a strong red whatever the
 * preference. Any other topic reads its reaction from the band edges the Log
 * uses, so a bubble and its Log line always agree: Likes and Loves draw the
 * Like sprite, Dislikes and Hates the Dislike sprite, and a reaction between
 * the edges the Neutral sprite on plain linen (issue 360). Without edges the
 * preference's sign decides. A random fight draws the art of its activity row.
 * Topic decisions belong to the simulation; this only selects artwork.
 */
export class ConversationBubbles {
  private readonly liked: (number | null)[];
  private readonly disliked: (number | null)[];
  private readonly neutral: (number | null)[];

  constructor(private readonly table: readonly TopicRow[], readonly bands?: ReactionBands) {
    this.liked = table.map(row => sprite(row.icon, 'Like'));
    this.disliked = table.map(row => sprite(row.icon, 'Dislike'));
    this.neutral = table.map(row => sprite(row.icon, 'Neutral'));
  }

  private face(value: number, preference: number): Face {
    if (isFightTopic(this.table, value)) return 'dislike';
    if (this.bands === undefined) return preference < 0 ? 'dislike' : 'like';
    const reaction = reactionOf(preferenceHundredths(preference), this.bands);
    return reaction === 'neutral' ? 'neutral'
      : reaction === 'likes' || reaction === 'loves' ? 'like' : 'dislike';
  }

  /** The bubble sprite for a person's topic value and own preference, or null for none. */
  bubble(activity: number, value: number, preference: number): number | null {
    if (activity !== 4 || topicRow(this.table, value) === null) return null;
    const at = (value & 0xffff) - 1;
    const face = this.face(value, preference);
    const sprites = face === 'like' ? this.liked : face === 'dislike' ? this.disliked : this.neutral;
    return sprites[at] ?? null;
  }

  /**
   * The existing linen background shifts toward muted green or red; ink stays
   * dark. A fight topic goes a strong red regardless of preference, so both
   * participants' bubbles read as an argument at a glance. A neutral reaction
   * keeps plain linen.
   */
  tint(preference: number, channel: number, value = 0): number {
    if (isFightTopic(this.table, value)) return channel === 0 ? 1 : 0.42;
    if (this.face(value, preference) === 'neutral') return 1;
    const strength = Number.isFinite(preference) ? Math.min(1, Math.abs(preference)) : 0;
    const reduction = preference < 0
      ? (channel === 0 ? 0.01 : channel === 1 ? 0.22 : 0.24)
      : (channel === 0 ? 0.18 : channel === 1 ? 0.015 : 0.24);
    return 1 - strength * reduction;
  }
}

const NONE = new ConversationBubbles([]);
const built = new WeakMap<readonly TopicRow[], ConversationBubbles>();

/**
 * The lookup for a topic table and band edges, built once per table while the
 * edges stay the same object. A missing table draws no bubbles.
 */
export function conversationBubbles(table: readonly TopicRow[] | undefined, bands?: ReactionBands): ConversationBubbles {
  if (table === undefined || table.length === 0) return NONE;
  let bubbles = built.get(table);
  if (bubbles === undefined || bubbles.bands !== bands) {
    bubbles = new ConversationBubbles(table, bands);
    built.set(table, bubbles);
  }
  return bubbles;
}
