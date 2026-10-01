# Compiled-code attribution after the third failed sweep

Fresh adversarial review recommended offline code-identity attribution before
another browser experiment. The previous helper tracked object, array, closure
and native identities, but only aggregate code totals. That omission left the
largest growth category without identity evidence.

Root analyzed the same eight historical snapshots, without changing them or
running the browser. `summarize-compiled-code.cjs` tracks every `code` node by ID
within each context, including instruction streams, Code, FeedbackVector and
SharedFunctionInfo. It reports births, deaths, surviving sizes and bounded
strong paths to nearest function owners. It never matches numeric IDs across
the independent enabled and disabled contexts.

The first helper draft traversed past function owners into their enclosing
contexts and therefore listed unrelated functions as additional ancestors.
The corrected search stops at the nearest function depth. The final report is
[`compiled-code-identity.json`](compiled-code-identity.json), copied from the
local `compiled-code-identity-v3.json`; earlier local draft reports remain preserved
but are not the basis for the owner conclusions below. Its identity arithmetic
self-test passes, including same-ID size changes. Every real interval also
asserts that births minus deaths plus surviving size changes equals net growth.

## Findings

1. Code growth is a mixture of new, surviving, replaced and resized nodes.
   In the enabled 60-to-600 interval, 402,068 bytes appear under new code IDs,
   36,452 disappear and surviving IDs shrink by 79,188, giving the previously
   measured net 286,428. Aggregate growth is not the number of new retained bytes.
2. Of the 1,103 code nodes first observed at tick 600 in that context, 1,029
   remain at tick 1680. Their shallow size is 300,476 bytes; this includes
   130 instruction streams totaling 174,400 bytes. This finite survival does
   not prove an engine leak, unbounded accumulation or eventual release.
3. The renderer's `Fr` instruction stream, ID 221953, is 45,632 bytes at
   tick 600 and absent at 1140/1680. ID 256187 replaces it at 1140 and remains
   at 1680. Both attach to closure ID 90513 and SharedFunctionInfo ID 61919.
   These sampled versions replace one another; they are not two accumulating
   copies of that stream. The disabled context has its own 47,616-byte version
   that survives from 600 through 1680. Cross-context IDs are not compared.
4. Enabled `Xs`, the fixed-tick Sim-audio sampler, contributes an instruction
   stream of 20,352 bytes first seen at 600 and still present at 1680. `Js`,
   the portal sampler, similarly contributes 7,232 bytes. These are existing
   audio paths, not dedicated ambience owners. Their survival cannot attribute
   the full acceptance difference to the room loop.
5. The source string embedded in both final snapshots has SHA-256
   `868ea09623fb59c25a3bcbef705cc21bffc067f48f6b27593f558a04f29ad1af`.
   Recorded function excerpts identify `Fr` by its packed instance buffer and
   interaction selection, `Xs` by Sim/audio columns and observation calls, and
   `Js` by portal columns and observations. This mapping uses the snapshots'
   actual source, not similarly named functions in a newer minified bundle.

## Limits and next experiment

These snapshots predate PR 186. They do not identify every owner in the latest
94,496-byte failure, prove a code-size plateau or clear any acceptance condition.
The raw 65,536-byte contract includes compiled code; nothing is subtracted.

The fresh review also identified duplicated production work: instance packing
already knows the written count, while the separate count pass recomputes
interaction selection and traverses entities. Simplifying that may be useful,
but this evidence does not establish it as the cause of the audio difference.
No renderer change is justified merely to chase this aggregate number.

The next bounded experiment is the separately predeclared
[marginal room diagnostic](../../../../specs/2026-10-01-ambience-marginal-diagnostic.md):
all existing audio remains enabled in both conditions and only Ambience changes
from 25% to 0%. It is diagnostic, not a fourth acceptance attempt.
