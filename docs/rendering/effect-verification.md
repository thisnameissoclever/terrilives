# Verify nonselectable visual effects

Visual effects may change scene color without becoming an object the player can
click or a solid surface that hides later drawing. Keep those properties separate
from judgments about appearance. The existing steam effect is unchanged by this
verification work.

## Check ownership and visibility on the graphics device

1. Freeze the production effect and scene modules before testing. Record their
   hashes. Run deliberate defects only in an isolated copy.
2. Draw a known opaque background and a nearer opaque foreground into the real
   `SceneTarget`. Require nonzero visible effect coverage on the exposed background.
   Require no color changes over the nearer foreground.
3. Compare every byte of the scene identity and physical-surface attachments
   before and after the effect. The identity attachment names the selectable object;
   the surface attachment records its physical depth. Do not omit edge samples.
4. Exercise `SceneTarget.pick()` against known owners before and after the effect.
5. Draw a depth-tested witness behind the effect but in front of the background.
   Require the witness to remain visible. This checks the hardware depth buffer
   without assuming `depth24plus` supports portable depth copying.
6. Clear the effect's retained fields. Repaint the opaque scene and require the
   empty effect to leave color unchanged. Require a held phase to reproduce its
   pixels. Require drawing after disposal to be inert.
7. Inject missing drawing, retained fields, identity writes, surface writes and
   hardware-depth writes into the isolated production copy. Require each defect
   to fail its specific assertion.

The direct check for the shipped steam class is
`node scripts/check-steam-contracts.cjs`. Set `PLAYWRIGHT_MODULE` to an existing
installed Playwright module before running it. The command installs nothing,
starts its own localhost server on an available port, and closes its browser and
server in `finally` cleanup. Results default to `.local-build/steam-contracts/`;
set `TERRI_STEAM_EVIDENCE` to another output directory when needed.
Use an installed Chrome browser with an available graphics adapter; the command
does not install a browser or replace unavailable hardware with a mock.

This direct check verifies the effect class, not native action completion,
`CharacterWorld.reset()`, appearance fitting, phone performance or visual appeal.
Keep actual-game evidence for those separate. Existing shower gameplay review is
in the [seating and shower report](../evidence/2026-10-15-seating-selection-shower/report.md).

## Preserve thin strokes without inventing width

A stroke narrower than the distance between sample centers can miss every
sample column. Increasing its opacity cannot restore samples the geometry never
covers. Rasterize the stroke's filtering support and weight each covered sample
by the true stroke coverage instead.

For a vertical stroke with half-width `h`, sample-center distance `x` from its
center, and sample half-width `r`, the one-dimensional box-filtered coverage is:

```text
coverage = clamp(min(h, x + r) - max(-h, x - r), 0, 2*r) / (2*r)
```

With the current two scene samples per display-pixel axis, `r` is `0.25` display
pixels. Extend the raster bounds by `r`; do not enlarge `h`. For normalized stroke
coordinates, half of `fwidth(x)` supplies the sample radius. Preserve depth and
ownership rules while filtering coverage.

Check translations across a complete sample interval. Require nonzero coverage
and stable integrated color. Check normal-size motion separately; a passing
coverage test does not establish that a player can recognize the effect.

## Order overlapping transparent contributions

Opaque depth testing alone cannot order two transparent contributions that both
avoid depth writes. A fixed final draw is wrong whenever the effect lies behind
a nearer transparent wall.

The retired experiment demonstrated a limited alternative: sort constant-depth
effect quads from far to near, then draw variable-depth wall fragments only in
the intervening, non-overlapping depth intervals. Compare each fragment's final
physical depth. Use uploaded Float32 boundaries and separate immutable uniform
records for encoded draws. Define equal-depth order explicitly.

This technique depends on every effect quad having constant depth. It does not
directly handle the current steam volume, and it is not installed in the game.
It also redraws wall batches for each interval; its cost requires measurement
before reuse. The [retirement record](../evidence/2026-10-17-shower-retirement/README.md)
retains the reference implementation and historical test results.
