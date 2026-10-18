# Automatic beds and condition help verification

Observed 2026-10-18 in the Windows desktop worktree, starting from `10ced796b`. `source-hashes.json` identifies the inspected sources and release WebAssembly build.

## Simulation evidence

The three initial automatic-assignment tests failed with missing assignments before implementation. They passed after implementation: distinct double-bed places and individual -20 mood penalties; preservation of a manual assignment and automatic selection after clearing; unreachable place rejection and claims on newly added beds.

The actual game started with Tim and Bill assigned to distinct double-bed places and Casey assigned to the supported lower bunk. Selling that bunk in the task-owned paused test world and advancing one tick left Casey with `No assigned bed -20`. Tim and Bill kept their assignments and had no missing-bed condition. The condition contributes to overall mood. Sustained mood affects life satisfaction through the existing shared calculation.

## Interface evidence

The inspected actual game used `http://127.0.0.1:5194/?stress=0&audio=0`, with simulation paused. The viewport sizes were 1280 by 900 and 390 by 844. Audio was disabled for this task-owned page.

1. `desktop-number-help.png`: the Low spirits number shows its signed mood effect and the mood range in short, literal text. The tooltip is legible above the selected row.
2. `missing-bed-condition.png`: Casey's missing-bed condition shows -20. The explanation agrees with that value.
3. `phone-number-help.png`: the condition label and number remain visible, and the explanation fits inside the phone viewport.

Real pointer checks confirmed that labels and the empty middle of the row show no help, while number hover shows help. Keyboard focus shows the explanation. Escape dismisses help while keeping Sim details open. Selection changes dismiss help. Live score updates change the explanation. Removing a condition closes its help. The controller retains one tooltip element.

A browser fault check expanded a numeric span to fill the row gap. The same gap check rejected that target. Restoring the span restored the passing result. This probe changed only task-owned browser styles.

An independent reviewer inspected all three captures and found no actionable visual defects. Code review identified repeated ownership scans, Escape ordering, selection cleanup and an unrelated encoding error; the corrections passed the reviewer's recheck. The revised tooltip text passed the banned-phrase and prose-structure scans.

The browser console reported a missing favicon request. The rendered game and tooltip checks remained usable.
