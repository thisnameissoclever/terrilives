# Audio lifecycle identity diagnostic

Status: predeclared diagnostic, not a replacement acceptance gate.

The corrected six-run gate failed at median 123,972 bytes. Matched snapshot
categories suggest compiled code is substantial, but net totals cannot rule
out replacement of old objects by newly retained objects. This experiment
distinguishes persistent ownership from one-time cost. It cannot approve release.

## Fixed procedure

1. Use the first already declared seed `(104729,130363)`, one enabled session
   then one disabled session, isolated contexts, viewport 1400 by 900.
2. Keep the normal renderer, audio clocks and fixed-step path. Start paused at
   zero through the existing opt-in probe. Deliver trusted Help/Options gestures.
3. Run to tick 60. Normalize selection/HUD, drain all source families, collect
   the existing raw sample, then take a heap snapshot. This is the baseline.
4. Restore selection and run to 600, then repeat at 1140 and 1680. Each interval
   is exactly 540 ticks. Normalize, drain and sample/snapshot after each one.
   Later epochs are measured diagnostics, never relabeled as extra warm-up.
5. Record exact world hashes and compare them across modes at all four endpoints.
   Record existing successful room starts and all active/retained source counts.
   These are not independent native allocation/disposal totals; do not claim
   that they prove every native node has disconnected.
6. Compare snapshot node identities within each context, including anonymous
   objects, arrays and closures rather than only audio-named groups. Identify
   objects first present after baseline that survive subsequent drained epochs.
   Follow retaining paths for growing cohorts and document intentional owners.
7. Preserve raw snapshots locally with hashes and small derived reports in the
   repository. Record code, ordinary-object and backing-store growth separately
   for diagnosis, without subtracting anything from the failed acceptance.
8. Close both contexts and the task-owned browser in finally blocks. No saves,
   host settings, dependencies, browser optimization flags or purchases change.

## Predictions and interpretation

1. An increasing cohort of ended sources, callbacks or associated objects that
   survive multiple drains through a persistent owner supports a source-level
   lifecycle fix. A root path and violated ownership boundary must identify it.
2. Stable owner populations and diminishing code growth support bounded startup
   or compilation cost. Three finite intervals cannot prove indefinite bounds.
3. If ordinary objects remain stable but raw growth fails because of code cost,
   do not speculatively rewrite rendering or manipulate warm-up to pass. A
   before/after feature diagnostic may attribute incremental cost; changing the
   acceptance budget or its meaning is a separate owner decision.

Heap snapshots perturb execution. This experiment cannot explain every byte
of the earlier uninstrumented result, clear PR 178, or establish subjective
sound quality or 120 Hz performance. The known paused-interruption lifecycle
bug is fixed and verified separately before this experiment runs.
