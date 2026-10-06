# Usage-driven grime and area cleaning

Implement the approved behavior in the household chore system. Dirt comes from
real use: floor chance is 10% minus 8% times cleanliness, surface chance is twice
that. Each success adds ten percentage points, capped at 100%. Unused areas stay
clean. Food waste and dish creation remain independent.

Clean up to nine walkable tiles around a standing Sim, within one room and with
wall-aware contact, over 24 ticks. Reduce actual dirt as the animation progresses.
Keep partial work through interruptions and preserve claims, queue ordering,
legacy saves and deterministic replay. Surface wiping retains 45 ticks and gains
the same progressive fade. Grime intensity scales floor and surface mood effects.

Add explicit opacity data and a transparent grime draw with no depth writes.
Preserve existing art, sprite indices, floor coverings and lighting. Append an
optional save envelope extension for random state and active floor patches;
do not change published nested records or command encodings.

Verify event probability and timing, nine-tile patches, walls and diagonals,
interruption, new dirt, edited rooms and furniture, save continuation, malformed
state rejection, mood scaling and transparent depth. Run native and browser gates,
measure ordinary seeded households, and prove critical regressions by temporarily
breaking their mechanisms and restoring byte-identical files. Obtain independent
review and capture played evidence. Keep dependencies unchanged.
