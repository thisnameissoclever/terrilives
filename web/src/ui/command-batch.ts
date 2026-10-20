/**
 * How many edits a Build tool stages in one frame when one choice covers many
 * lines or tiles ([WT-run], [FL-area]). The simulation's queue holds
 * `max_queued_commands` (64 in `content/tuning.toml`) between drains and
 * refuses the rest, so a large area goes in batches, one per drain, leaving
 * room for the player's other orders.
 */
export const EDITS_PER_FRAME = 32;
