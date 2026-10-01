# Marginal room diagnostic: qualified evidence, not acceptance

The [predeclared pair](../../../../specs/2026-10-01-ambience-marginal-diagnostic.md)
ran once on `index-ChVIKHes.js`. Both conditions kept all fixed-tick audio
sampling enabled; only initial Ambience changed from 25% to 0%.

The process exited **1**, after capturing all four snapshots. Its clean-browser
assertion found two localStorage SecurityErrors. Do not report this as a clean
or passing diagnostic, and do not use it to clear the six-run release gate.

## Test-setup defect and focused verification

The initialization script accessed localStorage on the initial opaque-origin
`about:blank` page as well as the intended game origin. A separate routed
browser fixture reproduced one such error per unguarded context before
navigation. With an exact origin check, the fixture produced no page errors
and stored the exact requested preferences. The fixture exited 0; its
[receipt](marginal-room/preference-init-regression.json) preserves the original
failure and guarded result. It did not rerun the game experiment.

The complete failed [diagnostic receipt](marginal-room/diagnostic.json) is
unchanged. Each game endpoint nevertheless records the intended preferences,
the same seed and tick 60/600 hashes, drained room sources, and ordinary audio
activity. In both conditions footsteps advanced from 43 to 111 and page turns
from three to four. Door cue totals differ slightly, so identical hashes do
not imply identical wall-clock audio execution. Room starts advanced from one
to two at 25%, and remained zero at 0%.

## Observations from the captured data

1. Raw pre-snapshot JS growth was 330,120 bytes at 25% and 329,876 at 0%:
   a marginal difference of 244 bytes in this pair. This is a qualified lead,
   not a repeatable estimate, leak bound or substitute acceptance result.
2. Snapshot code totals grew 297,028 and 296,936 bytes respectively. Each
   condition gained only 40 shallow bytes in two plain objects, and zero net
   closure bytes. Net counts do not establish that every identity stayed fixed.
3. Direct native-node counting, without the generic summary's truncated name
   filter, found AudioBuffers stable at 16 in the 25% condition and 15 at 0%.
   GainNodes stayed at four and AudioContexts at one in both. Their
   [native identities](marginal-room/native-audio-identities.json) are unchanged
   within each context between endpoints. These are sampled identities and
   shallow counts, not decoded-buffer byte measurements or a lifetime bound.
4. The two new plain objects in each condition are retained by compiler
   allocation-site feedback for `play` and the browser helper's `innerSerialize`.
   The largest sampled new arrays belong to WASM feedback vectors. Sampled
   new closure paths include the renderer and pending measurement timers or
   promises. These paths do not identify an accumulating ended room source.

The original 94,496-byte whole-audio median still fails the unchanged 65,536-byte
contract. This pair suggests investigating the broader existing execution path
rather than inventing an ambience cleanup fix. It does not prove that all
growth is harmless, bounded or unrelated to audio. Snapshot instrumentation,
the setup errors, one-pair sampling and wall-clock execution remain limitations.

## Preserved artifacts and decision

The four raw snapshots remain under
`web/output/playwright/indoor-ambience/marginal-room-diagnostic-01/`; their hashes
are in the diagnostic receipt. The category summary and both selected-owner
reports are included beside the receipt. The original helper, origin-scoped
initializer and focused fixture are archived together for reproduction. The
working helper was then wired to that tested initializer, but the pair was not
rerun. The original archive still reproduces the setup failure.

No second pair or new acceptance sweep followed these observations. No product
code, threshold, user settings, dependency or source asset changed. PR 184
stays draft; PR 178 remains separate. Task-owned browser contexts and server
5221 were closed. Further production edits require a specific demonstrated
mechanism, not the desire to make one aggregate number smaller.
