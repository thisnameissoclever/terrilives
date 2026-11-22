import {spriteIndex} from './atlas.js';
import {isFightTopic, topicRow, type TopicRow} from '../topic-table.js';

/** A bubble sprite by name, or null for a name the atlas lacks. */
function sprite(icon: string, reaction: 'Like' | 'Dislike'): number | null {
  try {
    return spriteIndex(`conversation${icon}${reaction}`);
  } catch {
    return null;
  }
}

/**
 * The sprite and tint for each topic, built from the simulation's topic table
 * so that content, not this file, says what each topic looks like. A fight row
 * and a random fight draw the Dislike sprite and a strong red whatever the
 * preference; any other topic draws Like or Dislike by the preference's sign
 * and tints by its size. A random fight draws the art of its activity row.
 * Topic decisions belong to the simulation; this only selects artwork.
 */
export class ConversationBubbles {
  private readonly liked: (number | null)[];
  private readonly disliked: (number | null)[];

  constructor(private readonly table: readonly TopicRow[]) {
    this.liked = table.map(row => sprite(row.icon, 'Like'));
    this.disliked = table.map(row => sprite(row.icon, 'Dislike'));
  }

  /** The bubble sprite for a person's topic value and own preference, or null for none. */
  bubble(activity: number, value: number, preference: number): number | null {
    if (activity !== 4 || topicRow(this.table, value) === null) return null;
    const at = (value & 0xffff) - 1;
    const reactions = isFightTopic(this.table, value) || preference < 0 ? this.disliked : this.liked;
    return reactions[at] ?? null;
  }

  /**
   * The existing linen background shifts toward muted green or red; ink stays
   * dark. A fight topic goes a strong red regardless of preference, so both
   * participants' bubbles read as an argument at a glance.
   */
  tint(preference: number, channel: number, value = 0): number {
    if (isFightTopic(this.table, value)) return channel === 0 ? 1 : 0.42;
    const strength = Number.isFinite(preference) ? Math.min(1, Math.abs(preference)) : 0;
    const reduction = preference < 0
      ? (channel === 0 ? 0.01 : channel === 1 ? 0.22 : 0.24)
      : (channel === 0 ? 0.18 : channel === 1 ? 0.015 : 0.24);
    return 1 - strength * reduction;
  }
}

const NONE = new ConversationBubbles([]);
const built = new WeakMap<readonly TopicRow[], ConversationBubbles>();

/** The lookup for a topic table, built once per table. A missing table draws no bubbles. */
export function conversationBubbles(table: readonly TopicRow[] | undefined): ConversationBubbles {
  if (table === undefined || table.length === 0) return NONE;
  let bubbles = built.get(table);
  if (bubbles === undefined) {
    bubbles = new ConversationBubbles(table);
    built.set(table, bubbles);
  }
  return bubbles;
}
