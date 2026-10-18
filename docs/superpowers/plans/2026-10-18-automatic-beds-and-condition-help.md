# Automatic beds and condition help implementation plan

**Goal:** Assign reachable unclaimed sleeping places automatically and explain condition scores only over the numbers in Sim details.

**Approved behavior:** Preserve existing assignments. Never take another person's assigned place. Apply the existing -20 mood penalty only to people without an assignment. Explain signed mood points rather than percentages; mood can affect life satisfaction over time. Keep labels and empty row space outside the tooltip trigger.

**Architecture:** Run deterministic assignment before action selection on simulation ticks, using existing physical sleeping places, navigation and saved ownership. Derive the individual mood condition from that ownership. Keep tooltip presentation in the existing mood panel without a new simulation or save field.

**Constraints:** No dependencies or save-format changes. Preserve paused-world clocks, explicit assignment commands, ongoing actions and historical save readers. Double beds retain two distinct places.

## Work

1. Add failing simulation tests for distinct automatic claims, preserved manual assignments, unreachable places, bed additions/removal and save continuation. Implement assignment in `crates/terri-sim/src/beds/automatic.rs`, schedule it in `lib.rs`, and replace household shortage with individual assignment checks in `mood.rs`.
2. Add failing mood panel tests for signed explanations and score-only trigger ownership. Implement accessible hover/focus help in `web/src/ui/mood-panel.ts` and its stylesheet. Verify actual pointer hit areas, live updates, clipping and phone layout in the browser.
3. Update bed, mood, glossary and player text documentation and today's changelog. Run focused tests, full local checks, deliberate fault checks and a fresh independent code and visual review. Retain selected screenshots and dated evidence; close task-owned pages and servers.

## Review focus

1. Multiple people must never claim the same physical place in one tick.
2. Sleeping-place reachability must use the same authored approaches as sleep routing.
3. Clearing or selling an assignment must allow automatic selection on the next simulation tick without interrupting current use.
4. Tooltip text must update when scores change, and disappear with removed rows or changed selection.
5. Hovering labels or the gap must never reveal help; keyboard users must reach the number's explanation.
