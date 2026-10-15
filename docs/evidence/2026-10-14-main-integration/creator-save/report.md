# Creator and disk-save integration

The reviewed browser check passed all four independent scenarios: 89 assertions, exit code 0, and no browser or graphics diagnostics. Chrome 155.0.8059.39 ran visibly at 1440 x 1000 with muted audio. Each scenario used a fresh browser context and isolated storage. All contexts and the browser closed; a subsequent process check found no remaining helper or Playwright Chrome process.

The accepted receipt is [pass-05/report.json](pass-05/report.json). Its source-before and source-after hashes match, including the current creator controls, application load path, save worker, WebAssembly wrapper, final WebAssembly binary, and verification script. The exact executed script is retained in [pass-05/verification-script.cjs](pass-05/verification-script.cjs).

Command, run from the repository root:

```powershell
$env:CREATOR_SAVE_RUN='pass-05'; node .scratch/main-integration-20261014/creator-save-check.cjs
```

Use a fresh run label when repeating it; existing evidence directories are preserved.

| Scenario | Assertions | Result |
| --- | ---: | --- |
| Authentic main schema 9 save with an active conversation | 15 | PASS |
| Preserved local character schema 9 save | 14 | PASS |
| Creator Apply, disk Save, and browser reload | 33 | PASS |
| Active Build Load, Cancel, and Exit | 24 | PASS |
| Aggregate result, diagnostics, and unchanged sources | 3 | PASS |

Both historical fixtures were written to the isolated origin's real `terri-save-1.bin` before the game loaded. Startup and the actual Load controls preserved the expected character snapshots, conversation topics, preferences, ownership, end times, and tick. Save wrote schema 10 with exact current serialized bytes and retained the original schema 9 bytes in `terri-save-1.v9-backup.bin`. Browser reload preserved the resulting state and recovery backup.

The creator scenario applied a new character with a changed name, height 67, default activity preferences, and Reading Level 1. Saved bytes were identical before and after reload, and both observations were at tick 49. Nonzero reading practice retained the exact stored bits, `1036831949`. Opening Edit reproduced the actual reloaded snapshot exactly. Applying a new name and a 125% hunger drain rate, then saving and reloading again, preserved that edited character exactly.

The save format intentionally omits zero-practice skill rows. The character-projection comparison removes only those explicit zero entries; nonzero progress and every other field remain exact. Immediate Apply and edit-preload comparisons use the complete records without normalization. The raw byte comparison is also exact. [created-reload-comparison.json](pass-05/created-reload-comparison.json) records both character projections, both byte arrays, and both ticks.

The Build scenario gave the live household an unsaved name change before entering Build, then staged a legal furniture move through the diagnostic bridge. This made both the pre-Build baseline and the pending world differ from the disk save. The actual Load confirmation replaced that world and closed its dialog. Cancel and Exit retained the newly loaded bytes. Exit also restored `data-building="false"`, hid the builder controls, and showed the normal Build button.

## Captures inspected

All seven accepted PNGs were inspected at their recorded resolution:

1. [main-v9-migration-loaded.png](pass-05/main-v9-migration-loaded.png): loaded household at 00:49, Pause selected, conversation bubbles visible, and no Load dialog covering the game.
2. [local-v9-migration-loaded.png](pass-05/local-v9-migration-loaded.png): loaded household at 00:00 with three visible people, Pause selected, and a Saved game loaded status.
3. [creator-save-loaded.png](pass-05/creator-save-loaded.png): the separate creator scenario starts from the loaded three-person household at 00:49.
4. [activity-preferences-reset.png](pass-05/activity-preferences-reset.png): one Activity preferences disclosure heading, visible category values of 1, and Walking with a Pause button beside the character preview. The screenshot shows the upper categories; the browser assertions checked all ten values and persistence of a deliberate collapse across navigation.
5. [creator-applied.png](pass-05/creator-applied.png): Migration Test appears as the fourth roster entry and as the selected person at the arrival tile after Move in.
6. [build-load-cancel-loaded.png](pass-05/build-load-cancel-loaded.png): the separate Build scenario starts from the original loaded three-person household.
7. [build-load-cancel.png](pass-05/build-load-cancel.png): Build remains open after Cancel, with Pending changes cancelled displayed and the visible Exit build control. The later exit state is established by the recorded UI assertions.

These captures establish their recorded interface states, not full animation or sleeve acceptance. The expected startup projection comes from the current native decoder; this check establishes browser storage and interface integration. Independent migration correctness is covered by the frozen-fixture native tests. The pending furniture move uses the diagnostic bridge, so this is a Load/Cancel test rather than a test of mouse placement controls.

Earlier receipts remain preserved. Pass 01 stopped at a character-projection mismatch without recording its field diff. Pass 02 established that only explicit zero-practice entries differed. Pass 03 passed its persistence and Build Cancel checks before targeting a hidden exit control. Pass 04 was interrupted when the coordinator requested a fresh review. The [independent harness review](../browser-harness-review.md) led to the separate scenarios, narrow skill comparison, and explicit dialog/Build state assertions used by pass 05. No production changes were needed during these browser checks.
