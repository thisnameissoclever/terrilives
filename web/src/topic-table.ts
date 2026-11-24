/**
 * The conversation topic table the simulation owns ([RT-identity] in
 * docs/specs/2026-11-22-richer-topics.md). A topic is a row of
 * `content/topics.toml`; the render column and the activity log name it by a
 * value that is the row plus one, with bit 16 set for an argument about an
 * everyday activity. Zero means no topic. The shell reads the table once.
 */

export interface TopicRow {
  /** `smalltalk`, `activity`, `fight` or `subject`. */
  readonly kind: string;
  /** The name of a conversation bubble sprite, without its `conversation` prefix or `Like` suffix. */
  readonly icon: string;
  /** The word after "about"; empty for a topic that names no subject. */
  readonly label: string;
}

/** Set in a topic value for a random fight, which draws its row's art in a fight's red. */
export const RANDOM_FIGHT_BIT = 1 << 16;
const ROW_MASK = RANDOM_FIGHT_BIT - 1;

/** The table's rows from the simulation's text: one tab separated line per row. */
export function parseTopicTable(text: string): TopicRow[] {
  if (text === '') return [];
  return text.split('\n').map(line => {
    const [kind = '', icon = '', label = ''] = line.split('\t');
    return { kind, icon, label };
  });
}

/** The row a topic value names, or null for zero or a row the table does not hold. */
export function topicRow(table: readonly TopicRow[], value: number): TopicRow | null {
  return table[(value & ROW_MASK) - 1] ?? null;
}

/** Whether a topic value is an argument, a fight row or a random fight. */
export function isFightTopic(table: readonly TopicRow[], value: number): boolean {
  return (value & RANDOM_FIGHT_BIT) !== 0 || topicRow(table, value)?.kind === 'fight';
}
