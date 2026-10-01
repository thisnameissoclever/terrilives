# Paused DOM count diagnosis

The original memory report failed exact equality only in disabled-audio
repetition 1: 1,435 baseline nodes and 1,434 final nodes. Its counter-only data
cannot identify the historical node instance.

## Reproduction

`node .tmp/audio-dom-diagnostic.cjs memory --url http://127.0.0.1:5221/ --output .tmp/audio-dom-caption-probes.json`

The diagnostic copies the official harness and uses its stress setup, warmup,
pause, empty selected-person panels, audio drainage, collection and counters.
It replaces the measured interval with repeated paused-baseline samples.
Instrumentation records text setter values, never retained DOM references.
The browser and context close in finally. Exit 1 is intentional: diagnostic
reports do not claim the official retained-memory gate passed.

In the same browser page, 250 samples per phase produced:

1. Original writes: 242 at 1,434 nodes, eight at 1,447 nodes.
2. Diagnostic-only suppression of unchanged text writes: all 250 at 1,434.
3. Re-enable only unchanged needs-caption writes: 245 at 1,434, five at 1,435.

At the first 1,435-node caption-only sample (tick 71), the entire recorded write
list was one entry: id needs-caption, before and value both "Select a person",
one existing child, timestamp 8235.5. Documents remained one, listeners 157,
and all playback counts zero. Connected tree count stayed 1,102.

The exact connected parent is #sim-dock #sim-identity > #needs-caption. Its
text child is replaced by NeedsPanel.showEmptyState, leaving the old text node
disconnected until collection. Periodic rendering can occur after explicit GC
and before Memory.getDOMCounters. Those counters include the transient old node.

Thirteen nonempty unchanged writes were observed per full refresh:
needs-caption, clock-value, funds-value, satisfaction-value, activity-value,
orders-value, three roster buttons, people-caption, people-empty, mood-empty,
traits-empty. This is wider than the caption-only reproduction.

## Smallest root repair

Guard unchanged text assignments at the observed UI writers. Test existing
text-node identity across unchanged updates and replacement for changed text.
Correct the needs-panel comment claiming an unchanged textContent assignment
is a browser no-op. Keep exact DOM/document/listener equality and the retained
heap allowance unchanged. Rerun the official gate after production repair.

The diagnostic setter is not a proposed production monkeypatch. These probes
are causal evidence, not retained-heap acceptance results.

The complete 750-sample report and diagnostic script are preserved in
`dom-diagnostic.zip` beside this note. The script is a diagnostic snapshot,
not the production acceptance harness. Extract it to a temporary directory
inside the repository to reproduce the command above.
