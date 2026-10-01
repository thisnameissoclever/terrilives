# Provisional cooking texture

This adds a first-party synthetic simmer/sizzle texture to the existing Cook
step. It is an artistic interpretation of generic cooking, not a field recording
or a claim that the simulation distinguishes frying from boiling. No accepted
sound is replaced. The owner authorized autonomous routine sound selection;
subjective listening acceptance remains open.

## Content and preparation

The approved intake has explicitly named flowing/boiling water, generic machine
loops and ambiguously named kitchen clips. Their metadata does not establish a
suitable generic cooking recording. This texture avoids assigning boiling water
to every recipe and does not add another short oscillator tone.

`node scripts/build-stove-texture.mjs` generates
`web/public/audio/objects/stove-cooking.wav` without a dependency or download.
The source is the checked-in generator, not a third-party sound file. A fixed
seed feeds noise through a 450 Hz high-pass and 4,200 Hz low-pass filter. A quiet
bed with smooth level variation and soft 5-15 ms noise bursts provides texture.
The existing offline loop editor blends a 100 ms overlap and encodes PCM16.
There is no runtime synthesis, gain normalization or simulation randomness.

The output is four seconds, mono, 48 kHz, 384,044 bytes. SHA-256:
`c126462490ce29618b9d285ffeb0d3c05883e0723d230cbca80ce3fc7b2b07a8`.
Peak is `0.0428162`, RMS is `0.00817160`, mean is `-0.0000006313`, and the
wrap's adjacent-sample difference is `0.00942993`. These are sample measurements,
not evidence of pleasantness or an inaudible seam. The generator refuses to
overwrite differing bytes; identical regeneration is a no-op.

## Runtime contract

1. Only authoritative `stove_cooking` action 2 starts this loop, owned by the
   exact placed stove. Getting ingredients, preparing food and eating do not
   start it. Leaving Cook stops it through the existing scheduler.
2. Use the existing four-active/eight-retained object-loop limits, original
   playback rate, 0.6 clip gain and Effects/master graph. Voices has no effect.
   Four synchronized stove loops peak below 0.103 at Effects 100%.
3. Load on playable demand, never before activation, while muted, hidden,
   paused or at Effects zero. Water and cooking have independent requests and
   failure cooldowns; one unavailable file cannot prevent the other playing.
4. Cache successful recordings. Shower and sink still share one water decode.
   Retry a failed family only after five seconds and new demand or an explicit
   loader call, never every fixed tick. Keep one in-flight request per family.
5. Manual clips remain authoritative. A delayed fetch cannot revive a source
   that ended or crossed a global cancellation boundary. Existing normal fades,
   interruption disposal and pause behavior remain in force.
6. Keep Rust, content definitions, saves, simulation timing and dependencies
   unchanged. Do not waive the separate retained-memory hold on PR 178.

## Verification

The generator test first failed against an empty output, expecting 384,044
bytes and receiving zero. The implementation then passed waveform bounds,
reproducibility, shipped-byte equality and fixed-hash checks.

`web/proofs/stove-recording.js` renders the actual asset through the controller
and native offline audio nodes. It checks one/four sources, looping and silence
after exact-source end, Load, mute, Effects zero, background and pause. The
running-state adapter provides exact offline scheduling; it is not evidence of
browser autoplay or speaker output.

Local verification on 2026-10-01:

1. `npm test -- --maxWorkers=1`: 1,706 tests in 114 files passed, exit 0.
   The controller/catalog subset passed 211 tests. Stove tests first produced
   the expected demand and failure-isolation failures before implementation.
2. `npm run typecheck`, release `wasm-pack build crates/terri-wasm --target web
   --out-dir ../../web/src/wasm`, and `npm run build`: passed, exit 0.
   Final production JS is `index-B9wQm15e.js`; no Rust source changed.
3. All eight actual stove-render cases passed. One source peaked at
   `0.0256904829`; four at `0.1027619317`. Repetition error was zero. Each of the
   six stop boundaries rendered exact silence from one second onward.
   All fourteen existing shower/sink cases passed with their unchanged levels.
4. Four compiling runtime mutations failed assertions: omitted stove demand
   (one failure), shared water/stove state (seven), omitted decoded cache (two),
   and reversed manual precedence (two). All source bytes were restored.
5. Generator mutations for silence, changed seed and removed CLI refusal each
   failed assertions. The CLI test runs a copied generator/editor in its own
   temporary directory, proves creation and idempotence, then requires differing
   bytes to survive rejection unchanged. A first large-buffer diff was stopped
   because formatting it was expensive; boolean byte equality made the repeated
   negative check finish promptly. The cancelled attempt is not counted as proof.
6. Independent review found the missing CLI guard test; the added test and
   killed guard-deletion mutation resolved it. Final review had no actionable
   findings. Generator SHA-256 after restoration:
   `49ab528ee86753c9232efa352f2a807c0da11d64d4163694d1e91eecd7d63f39`.
7. `node --check` for the generator/proof, `python check-doc-ids.py`, and
   `git diff --check`: passed, exit 0.

## Played inspection

The production build ran in a fresh task-owned browser at `?stress=0`.
After a trusted Help dismissal, the public command API directed Bill to the
discovered Cook dinner interaction. At tick 407 the live row reported action 2,
source entity 2 (the stove), and one active object loop. Pause then held the
scene for [visual inspection](../assets/review-evidence/audio/stove-cooking/game.png).
The HUD read `Cook dinner - step: Cook (carrying ingredients)`. Bill stood at
the stove; no visible pan or utensil animation is present. That existing visual
gap is not claimed fixed by audio. No save was created or loaded. Console errors
were only the missing favicon. Game and proof pages closed in `finally`, and
their CLI sessions were closed.

After the UI write repair, a fresh normal game with Tim selected was paused at
midnight and [inspected again](../assets/review-evidence/audio/stove-cooking/ui-after.png).
The clock, household controls, selected-person caption and needs bars remained
legible and aligned. The nighttime lighting was unchanged. The task-owned
browser closed after capture.

## Whole-game memory check

The first `node scripts/audio-browser-proof.cjs memory --url
http://127.0.0.1:5221/ --output web/output/playwright/stove-memory.json` run
exited 1. Its [complete report](../assets/review-evidence/audio/stove-cooking/memory.json)
retains all six enabled/disabled runs. Enabled-minus-disabled retained JavaScript
deltas were -100,428, 78,032 and 45,252 bytes. The 45,252-byte median passed the
unchanged 65,536-byte allowance.

The structural check failed because audio-disabled repetition 1 ended with one
fewer DOM node. The other five endpoints had identical node counts. Every run
had unchanged listener/document counts, zero active and retained playback at
both endpoints, and unchanged scheduler capacity. A declining node count is not
growth, but this is still a failed exact-equality gate, not a passing run. The
cause was repeated unchanged `textContent` writes in paused HUD panels, not
audio retention. The [causal diagnostic](../assets/review-evidence/audio/stove-cooking/dom-diagnosis.md)
reproduced the one-node difference with only the needs caption's unchanged
write enabled. Suppressing unchanged writes kept all 250 samples stable.
No threshold or equality guard was changed.

The repair compares live DOM text before writes in the HUD, needs, roster,
People, mood and traits panels. It preserves source reads, text, throttling,
focus and selection. All six new public-panel tests first failed on unchanged
writes. The helper and panel subset then passed 97 tests. Removing the shared
guard caused seven assertion failures; restored production hashes matched.
Independent review found no actionable issue. The full web suite above includes
these tests, and the final production build includes this repair.

The browser identity probe first rejected the old bundle: all 13 unchanged
labels replaced their text nodes and caused 195 child-list mutations over 1.5
seconds while paused. This negative control is separate from memory measurement.
The identical probe passed on the repaired build: all 13 nodes retained identity
across 91 frames with zero child-list mutations. Resuming changed the caption
from `Select a person` to `Tim` and advanced the clock, replacing those nodes as
required. The [before](../assets/review-evidence/audio/stove-cooking/dom-identity-before.json)
and [after](../assets/review-evidence/audio/stove-cooking/dom-identity-after.json)
reports and zipped probe are preserved beside the diagnostic evidence.

The subsequent [complete memory run](../assets/review-evidence/audio/stove-cooking/memory-after.json)
still exited 1: its audio-disabled repetition 2 had 1,435 baseline nodes and
1,434 final nodes. The other five endpoints were equal. Audio-specific retained
deltas were 89,560, 58,236 and 54,848 bytes, with a passing median of 58,236.
This was not a passing release check. A separate startup diagnostic then caught
the remaining cause directly: the baseline still contained the `Office clerk`
text child in `career-value`, with the selected person's caption and activity
also stale. The old normalization predicate had already passed because the
mood, action and warning rows were empty. A later independently throttled HUD
refresh removed the career text child, decreasing the connected node count by
one. This second failure was incomplete endpoint setup, not steady text churn.
All 750 settled samples had already been stable on the repaired UI.

The complete twelve-context startup diagnostic and script are preserved in
`dom-startup-diagnostic.zip` beside the reports. Fresh-context review confirmed
that normalization must wait for the full unselected presentation before the
unchanged collector runs. Freezing rendering, weakening equality, increasing
the allowance and selecting favorable repeated runs are not acceptance methods.

The corrected setup waits for the complete semantic unselected projection;
collection and analysis remain unchanged. Its focused suite passed 65 tests,
including stale fields that satisfy the old predicate and missing elements.
Omitting the career-value check failed its named regression test; restored
source then passed. Both increased and decreased structural counts still fail.
In the [native browser check](../assets/review-evidence/audio/stove-cooking/normalizer-browser.json),
normalized endpoints at ticks 69 and 129 both had one document, 1,434 nodes and
157 listeners. An intentionally retained detached text node produced 1,435
nodes after GC; an added event listener produced 158 listeners. Removing each
test injection restored baseline counts. The probe script is archived beside
the report. No counter polling, setter patch or fixed-delay repair was used.

The [final six-run acceptance report](../assets/review-evidence/audio/stove-cooking/memory-final.json)
passed, exit 0. Every normalized endpoint retained one document, 1,434 nodes
and 157 listeners. All playback endpoints drained and scheduler bounds held.
Enabled-minus-disabled retained JavaScript deltas were 65,368, 53,820 and
-69,716 bytes; the median was 53,820, below the unchanged 65,536-byte allowance.
Both structural and retained-audio acceptance passed. The two earlier failures
remain preserved with their distinct diagnosed causes.

120 Hz performance, physical-device output and subjective listening remain
unverified. PR 178's separate release hold remains unchanged; this check does
not validate that different branch or waive its own acceptance requirements.
