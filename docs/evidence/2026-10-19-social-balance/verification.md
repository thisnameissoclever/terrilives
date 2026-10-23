# Social and household balance verification

Work started from main `a15d543d6` on 2026-10-19 in the Windows desktop worktree.

## Requirements and failing checks

Issue 310 requests positive Social for both chat participants and positive opinion effects from shared interests. The owner clarified that chats should double their Social reward, with the existing 100-point cap. Letter writing also provides Social. The owner then requested stronger family support, reduced negative family effects, delayed household resentment and one-third lower base need drain.

Before implementation, `cargo test --workspace balance_ -- --test-threads=4` exited 101. Eight new tests failed on the intended behaviors: both-person double Social, shared-interest completion under unmet needs, family opinion scaling, solo correspondence, all seven base drain rates, fresh full grime, fresh dishes and a duty appearing at 23:59. One existing balance test passed. The local raw record is `.local-build/social-balance-red.log`.

The implementation plan records the chosen balance values. Published save records remain frozen; independent neglect timing uses the V19 envelope around V18.

## Browser and deterministic behavior

The final release WebAssembly binary has SHA-256 `3dba220ce517712e3483567ccb8aed543264534977357cdf8b59930c7de520c7`. The native and release WebAssembly builds independently produced `7530373376785939268` for the same nine-entity, 100-tick scenario, and the final suites retain that expected value. The prebalance V15 checksum controls retain their original constants and pass with explicitly reconstructed historical content. Career verification compares the original saved jobs, schedules, pay, attendance states and career random draws.

The final browser suite passed 3,809 tests in 277 files in 963.99 seconds. Type checking and the production build passed. Rust formatting and lint with warnings denied passed. The final native simulation target passed all 1,786 tests in 1113.10 seconds, including its bounded six-day calendar scenario.

The complete final native workspace run passed 2,646 tests with no failures, including all 325 native bridge tests, migration examples and documentation targets. One existing replay test remains opt-in because it requires an explicitly supplied private save path. The final changelog tests passed all 12 cases and generated the public page. All 24 CI-routing script tests passed, and documentation IDs are valid. Unrelated sprite and model generation checks were omitted because their inputs and consumers did not change.

The production build was played at 1280 by 900 with the shipped house and three people, using `?stress=0&audio=0`. Its WebAssembly SHA-256 was `ae5d348cb76cfea20f6771a93738e2262cfd81bf624a2e0dc73595f129419333`; the later migration-only repair changed the final binary without changing reward delivery or presentation. Ordinary player-order and character-edit APIs set up the scenarios; no needs or relationships were assigned directly. [Letter measurements](played-letters.json) record Casey's Social increasing from 57.7816 to 70.4407 across a completed desk-writing session. [Conversation measurements](played-chat.json) record a reading topic enjoyed by both partners, both Social meters reaching 100, and both directional opinions increasing to 0.64179. Audio was muted for this pass; voice selection, duration and playback code were unchanged.

The coordinating reviewer inspected `letters-running.png`, `chat-running.png` and `chat-after.png`. A fresh independent reviewer inspected the same files. Casey is seated at the desk with an envelope indicator and readable activity text. The chatting participants have conversation bubbles, and the third person's waiting indicator is distinct. The final People panel names Bill as Casey's partner and shows a Close relationship without clipping. Stills establish these recorded phases; the completed-action measurements establish the rewards. The pass does not measure phone performance or long-term household balance. Task-owned pages and the preview server were closed afterward.

## Fault checks and restoration

Three temporary faults removed the family opinion multiplier, disabled the solitary correspondence exception and changed the maximum-dirt grace from 120 ticks to zero. The focused balance run reached assertions and failed ten tests, including each targeted mechanism. [Actual failures](fault-assertions.txt) retain their assertion output. [Restoration receipts](fault-restoration.json) show identical SHA-256 hashes before and after for all three files. This is targeted fault injection; a complete mutation sweep was not run.

A separate fault replaced household timing's contribution to the world hash with empty timing. The exact hash regression failed with identical values of `6116417910321485984` where different timing must produce different hashes. The [failure output](hash-fault.txt) and [byte-identical restoration receipt](hash-restoration.json) are retained.

The automated family-opinion check ran six non-equivalent guard and arithmetic mutations. All six were caught; none survived, timed out or failed to compile. The unmodified baseline passed 35 focused balance and relationship tests. The `>` to `>=` mutation at zero was excluded because both branches return the same signed zero. [Per-mutation results](automated-mutations.json) retain the failing test names and result lines.

The runner's restored file did not match the original bytes, so the wrapper restored its exact backup. The [restoration receipt](automated-mutation-restoration.json) records both facts. All 95 bound source and test files then matched the full-suite inputs, and the 35 focused tests passed again after restoration.

The first fault attempt encountered a Windows linker lock while a prior test executable was still running. That attempt did not test the assertions. The prior executable finished normally; the second attempt supplied the recorded assertion failures. No other task's process was stopped.

## Review

Fresh code review checked social effects and saved neglect behavior. Findings about gradual cleaning erasing an overdue obligation, old maturity leaking into fresh work, and quadratic membership checks were repaired. Matured episode identities now retain their history only while the original work or its active cleanup continues. Indexed membership handles the admitted inventory bounds. Independent re-review found no remaining concrete issue in those repairs.

The final full-diff review also found no additional issue in reward delivery, forecasts, family effects, save envelopes or historical fixture assertions. A separate source check confirmed that existing saved games use current base drain rates each tick. Saves retain personality multipliers, so custom profiles preserve their relative differences while receiving the lower base rates.

## Historical conversation ownership repair

The final room-history regression exposed an older migration gap. A schema-fourteen household loaded successfully but produced a current save that could not reload. Three version-level diagnostic runs did not identify the failed guard. A fresh reviewer used the installed Windows debugger and matching symbols to stop at `save/v15.rs:354`, inside `restore_requests_with_executions`. The stack passed through the V16 reader; the failure was an unowned chat target.

The debugger showed entity 34 targeting Bill at 35, Casey at 36 also targeting Bill, and only one request: SimId 0 to SimId 1, `LegacyUnattributed`, `Approaching`, created at tick 1. Legacy adoption had recovered the admitted approach while omitting Casey's unreserved waiting intent. No change to household timing or permissive current validation was justified.

The new historical-waiter test first failed because Casey's waiting request was absent. Migration now imports valid unmatched historical targets as explicitly unattributed waiting requests. The test checks the admitted owner's reservation and rendezvous, the waiter's target, path and Blocked marker, both random streams, the clock, exact V19 reload, and rejection of an orphan inserted directly into a current payload. The original room-history fixture keeps its trigger and also passes. Read-only capture and strict current validation remain unchanged.

Independent review found that the initial migration helper scanned all requests for each target, despite save admission allowing 100000 entities. Indexed initiator and target sets replaced that scan. Re-review found no remaining issue in the indexed helper. Its allocator overflow branch is unreachable through the examined valid public legacy loaders; no unrelated allocator change was made.
