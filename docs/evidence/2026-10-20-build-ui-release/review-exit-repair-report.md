# Review exit correction repair

The room-review refusal callback previously invalidated every pending exit. After an invalid room name was corrected and the reviewed arrangement committed, footer Confirm and exit-dialog Confirm left Build open. The repair invalidates the continuation only when a pending tool destination exists. Land refusal still cancels its destination; ordinary exit can complete after correction.

## Verification

The commands below ran from `D:/VIBES/.worktrees/f19a/terrilives/web`. Raw command outputs were returned through tool sessions and were not redirected or saved as log files. There are no retained red, green or typecheck log paths. This report records the observed results; it is not a raw command log. Passing checks were not rerun to manufacture logs.

1. RED: `npm test -- --maxWorkers=1 tests/main-build-wiring.test.ts -t 'correcting refused review input'`. Exit code 1. Two failures, one pass, 34 skipped. Footer and exit cases failed at `expect(f.builder.active).toBe(route === 'land')`, receiving true instead of false after successful adoption. The Land control passed. Vitest reported 11.90s, start 07:41:29. Execution session 1530, final output chunk 695b3f.
2. GREEN: `npm test -- --maxWorkers=1 tests/main-build-wiring.test.ts tests/build-exit.test.ts tests/build-exit-destination.test.ts tests/room-review.test.ts`. Exit code 0. Four test files passed, 114 tests passed. Vitest reported 17.83s, start 07:41:59. Execution session 26013, final output chunk 8ca3c1.
3. Typecheck: `npm run typecheck`. Exit code 0, no diagnostics. Execution session 36880, final output chunk 63de55.
4. `git diff --check`. Exit code 0. Git printed only the existing CRLF normalization warning for `web/tests/build-exit.test.ts`.

The added actual-page tests cover footer Confirm, exit-dialog Confirm and Land through blank-name refusal, corrected-name review update and final adoption. They check committed baseline preservation before adoption, one commit, corrected name, unchanged simulation clock, ordinary exit once and canceled Land activation. Existing focused tests retain Back, Load and graphics-interruption cancellation coverage.

## Source hashes

SHA-256 values read after verification, before root's build/reference refresh:

| File | SHA-256 |
| --- | --- |
| `web/src/ui/build-exit.ts` | `EF132E576274557752C37383D8875A95F25E4CD9F2F59D5E0B041EACA99336F3` |
| `web/src/main.ts` | `1746F520F2FA9CAED45F0863656770634C2B4828E220CB7DC59491C6D9F9D596` |
| `web/tests/main-build-wiring.test.ts` | `FBB719FBB328D3E75E70412C53395BEA62D1BE468DB57DFDC97FE94A76F69CE7` |
| `web/tests/build-exit.test.ts` | `3E8CC45AF4476DAC51A1596660495D3D2ED95F586BE987C0BD0206B68DD074B8` |

No dependency, documentation, Git reference or commit changes were made by this repair task. Root owns build validation, documentation and delivery. This report is local evidence.
