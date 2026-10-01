# Recover missing conversation recordings

## Defect

A temporary fetch or decode failure left an undefined slot in the voice library.
The controller treated the array length as a complete-cache check, even when
every slot was missing. Calling `loadVoiceLibrary` again did not retry, and the
normal game had no recovery trigger after its initial load. Any conversation
that selected a missing clip stayed silent until page reload.

A read-only runtime probe imported the real controller, failed the initial two
requests, then restored a healthy fetch implementation. Explicitly requesting the
library again and unlocking audio again left the request count at two and the
active conversation count at zero. The probe exited 1.

## Intended behavior

1. Preserve successfully decoded recordings at their simulation-selected indices.
   A retry fetches missing recordings, not the entire successful library again.
2. A new semantic conversation start may request recovery if its pair needs a
   missing recording. Do not fetch from fixed ticks, ordinary controls, pending
   playback replay, or a background polling timer.
3. Automatic recovery shares one in-flight batch and waits at least five seconds
   between attempts, measured with the browser's monotonic clock. A later new
   conversation can try again after another failure. No callback repeatedly
   retries itself.
4. Initial loading remains gesture-gated. Mute, Effects zero, background state,
   and locked audio must not initiate a demand retry.
5. Recovery may start only a conversation whose pending ownership still exists.
   End, Load, mute, Effects zero, or background transitions invalidate that
   ownership. The successful download itself does not grant playback authority.
6. Keep accepted recordings, gains, playback speed, fades, and routine-control
   silence unchanged. Do not change simulation timing, randomness, or saves.

## Browser proof

`web/proofs/voice-download-recovery.js` fetches and decodes two shipped first-party
WAV files through the real loader. It replaces only the first second-file response
with HTTP 503, then holds recovery across a conversation end when requested.
After the cooldown, a new semantic start must retry only that second file.

An `OfflineAudioContext` renders the output without speaker playback. A lifecycle
adapter exposes a running context for this test, so this is not evidence about
browser autoplay or physical audio devices. The current pair must produce nonzero
samples after recovery. A pair ended before recovery must produce silence. Both
cases require request counts of one for the good clip and two for the failed clip.

## Verification

1. Initial failing tests reproduced both loader cache replacement and controller
   failure to issue a recovery request. Fetch and decode failures are covered.
2. `npm test -- --maxWorkers=1 tests/audio-controller.test.ts tests/voice-clips.test.ts`:
   130 passed. Final `npm test -- --maxWorkers=1 --reporter=dot`: 1,446 tests across
   103 files passed, exit 0. `npm run typecheck` and `npm run build` passed, exit 0.
3. Nine temporary mechanism deletions failed assertions, exit 1: the complete-slot
   check, semantic-start fetch, cooldown, duplicate guard, successful-buffer reuse,
   in-flight guard, relevant missing-slot guard, global pending cancellation, and
   ended-pair cancellation. The relevant-demand mutation initially survived:
   its good-only conversation began before cooldown expired. Moving that start
   past the cooldown made the test detect the missing guard.
4. Actual mutation failures included `expected 4 to be 2` for cooldown and
   duplicate guards, `expected 8 to be 4` for in-flight deduplication, expected
   two requests but received three for relevance, and expected zero sources but
   received two for cancellation. Cache reuse failed buffer identity; restoring
   the length-only check left explicit recovery at two requests instead of four.
   Removing semantic-start fetching omitted the expected failed-clip retry.
5. Inverse patches restored production sources byte-for-byte. SHA-256:
   controller `465363D89AE98634A4ADC7DD847078C8E84BBB8724B45B8EA2A7DE0E7544BD25`;
   voice clips `3C0C277D6680AB3AF2BC15893D0F10DB46F8F654BAFBCF6C035C2E7D80A65DC8`.
6. Chromium executed `proveVoiceDownloadRecovery()` against Vite on port 5198.
   Both scenarios made request counts `[1, 2]`. The current pair had one active
   voice and rendered peak `0.017466353252530098`; the ended pair had zero active
   voices and rendered peak exactly zero. Exit 0. The first two fixture attempts
   used module-relative asset URLs that Vite rewrote incorrectly; the successful
   fixture resolves the public URL against its browser page instead.
7. The production build was opened separately on loopback port 5199 and visually
   inspected during play. The household advanced from Day 1 00:01 through 03:25;
   Options showed Sound on, Effects 70%, and Voices 100%. No console errors or
   warnings were reported. No Save, Load, reset, or audio-preference changes were
   made. Task-owned pages and both local servers were closed afterward.
8. Independent read-only review found no actionable regressions and mapped each
   new invariant test to a specific failing mutation. `python check-doc-ids.py`
   and `git diff --check` passed. These checks do not establish physical-device
   listening acceptance or browser autoplay behavior; recordings and mix are
   unchanged. Rust simulation, content, saves, and dependencies were not changed.
