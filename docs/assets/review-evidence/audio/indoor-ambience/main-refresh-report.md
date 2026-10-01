# Held ambience main refresh

Completed a local preparation merge, not feature acceptance or publication.
Commit: `f613be61addfffa1d34fa675ee4ad83bc98ff3e8`.
Parents: `c4ab832b3fdfaa00927c74cc1e4b61638eeb852e` and
`26145f4f8dedfe966bf7e3cf0ffae3cf9751d122`.

## Resolution

1. `web/src/audio/audio-controller.ts`: kept main's Event-compatible context port and single captured-context handler. Kept room cleanup in graph failure, closed-context replacement and stale room-load protection. Both parents already used immediate global player cleanup and scheduler reset, so no second handler was needed.
2. `web/tests/audio-controller.test.ts`: retained both parents' unique regressions. Kept one fake state transition method with a real Event argument, and updated the room stale-handler regression to that signature.
3. `web/proofs/room-ambience.js`: forwarded the native Event to the compatible controller port. The native state-event proof and its queued-hold failure cleanup were imported unchanged.
4. Both lessons and all documentation entries survived. Read the complete resolved text diff, including incoming proof and historical evidence. Incoming binary screenshots were carried unchanged, not treated as fresh visual acceptance.

## Checks

| Exact command | Exit | Output and verdict |
| --- | --- | --- |
| `npm run typecheck` in `web/` | 0 | PASS: `tsc --noEmit`, no errors |
| `npm test -- --maxWorkers=1 tests/audio-controller.test.ts tests/room-ambience.test.ts tests/room-ambience-source.test.js tests/frame-audio.test.ts tests/audio-memory-report.test.js tests/stress-memory-probe.test.ts tests/object-loops.test.ts tests/voice-clips.test.ts` in `web/` | 0 | PASS: 435 tests in 8 files, 2.29 seconds |
| `node --check web/proofs/audio-state-events.js` | 0 | PASS: no output |
| `node --check web/proofs/room-ambience.js` | 0 | PASS: no output |
| `python check-doc-ids.py` | 0 | PASS: Documentation ids are unique and allocation-free. |
| `git diff --cached --check` | 0 | PASS: no output |
| `git diff --check` | 0 | PASS: no output |
| `git rev-list --parents -n 1 HEAD` | 0 | PASS: exact requested parents shown above |
| `git status --short` after commit | 0 | PASS: only preserved untracked `web/output/` remains |

An initial explicit staging command ran from `web/` with repository-root paths
and exited 128. It staged nothing. Repeating it from the repository root staged
only the three resolved files; checks were unaffected.

## Holds and proof limits

No push, PR creation, feature-to-main merge, dependency change, Rust build,
browser verification or full memory sweep occurred. Root owns browser checks
and delivery. The original unmatched raw memory acceptance remains preserved
with its failed 69,120-byte median. The latest matched six-run result is the
current failed gate: median 123,972 bytes versus the unchanged 65,536-byte budget.
Draft PR 184 and PR 178
holds remain intact. The separate simulation correction is not included.

No incompatible contract or unresolved merge concern was found. Focused tests
are preparation evidence, not integrated sound-feature or listening acceptance.

**Next steps**: Root can review this merge and continue the separate simulation
correction and integrated verification. Nothing is needed from the owner for
this completed preparation step.
