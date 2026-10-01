# Exact remaining one-node failure

Current repaired production build: index-B9wQm15e.js.

`node .tmp/audio-dom-startup-diagnostic.cjs memory --url http://127.0.0.1:5221/ --output .tmp/audio-dom-startup-probes.json`

The bounded diagnostic opens twelve fresh disabled-audio contexts, warms each
through the official setup, collects its normalized baseline, then samples again
200 ms later at the same paused tick. There is no measured 540-tick interval and
no full enabled/disabled sweep. Text writes and mutations are observed, not
suppressed. Diagnostic exit 1 is intentional, not an acceptance result.

Repetition 10 reproduced exactly 1,435 to 1,434 nodes at tick 71. The connected
baseline tree contained 1,103 nodes instead of the settled 1,102. It retained
the connected text node #career-value/#text with value "Office clerk".

At baseline the old normalizer had passed, but #needs-caption still read "Tim"
and #dock-activity still read "Sitting / Low". These are directly recorded in
runs[10].baselineDom. The earlier completed panel refresh at 3425.7 ms had removed
moodlets, traits and people rows, satisfying the old predicate. At 3492.5 ms the
needs/GameHud refresh then produced:

1. needs-caption: "Tim" to "Select a person", replacing one text node.
2. satisfaction-value: "0.0" to "unavailable", replacing one text node.
3. career-value: removed "Office clerk", adding no node.
4. activity-value: "Sitting" to "Nothing selected", replacing one text node.
5. dock-activity: "Sitting / Low" to "Nothing selected", replacing one text node.

Item 3 accounts for the exact single-node decrease. The other four preserve
their node count. Full events are in runs[10].baselineProbes[0].sample.mutations.
Both samples have one document, 157 listeners and zero playback counts.

This is a second mechanism, distinct from the already-repaired unchanged-text
churn. The old normalizer observes only part of the empty selection projection;
independently throttled panels can satisfy it before the career/summary render.
The smallest repair is a complete semantic empty-projection wait before GC,
including the cleared career value and summary state. Keep exact structural
equality and all heap thresholds unchanged. Do not use a fixed delay as the fix.

Earlier bounded checks narrowed the cause: 750 steady paused samples were all
1,434 with zero further text writes or mutations; sixty same-page selection
cycles also remained 1,434 at immediate and settled samples. They do not prove
initial convergence, which the fresh-page trace above exposes directly.

All twelve task-owned contexts and the browser closed in finally. No tracked
files were changed by this diagnostic task.
