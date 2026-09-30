# Independent conversation playback

## Problem and scope

The audio scheduler represents all talking Sims as one household-wide event.
Starting or ending an unrelated conversation can restart the selected recording.
Its bitmask also aliases stable Sim IDs above 30. Household size is not an ID
limit: IDs keep increasing as people leave and new housemates arrive.

Give each real conversation independent playback ownership. Keep the accepted
recordings, gain, fades, speed policy, footsteps and silent routine controls.
Do not change simulation duration, rewards, random draws or the save format.

## Identity from simulation state

Only the initiator has `Socialising`; its partner is reserved. The render
projection uses that authoritative relationship, never proximity or row order.
Both participants receive the same three additional aligned `u32` columns:

1. `conversation_owners`: the initiator's stable Sim ID, or `u32::MAX` when absent.
2. `conversation_end_lows`: low word of the completion token.
3. `conversation_end_highs`: high word of the completion token.

The completion token is `clock.tick.wrapping_add(remaining_ticks as u64)`.
Each live tick increments the clock and decrements the countdown, keeping this
token stable. It is an identity token, not a calendar value. Preserve both words
instead of converting it to a JavaScript number, which loses integer precision
above `2^53`. The owner sentinel leaves every token value usable.

The complete key contains owner, high word, low word and both clip indices.
Including clips distinguishes an interrupted conversation from a shorter
replacement that happens to have the same completion token. Repeating the same
clips later gets a later token. All source fields already round-trip in saves;
render projection adds no saved state and consumes no randomness.

## Playback lifecycle

Deduplicate the two participant rows by that key. Start and stop only the
conversation that entered or left the frame. Row ordering and unrelated talkers
must not restart an existing pair. Preserve the player's three-pair capacity.
End events and pending clip-library starts must carry the same identity.

Global boundaries still stop everything: load, mute, backgrounding and audio
recovery clear active and pending ownership. Completing library decoding must
not revive a conversation that ended while the files were loading.

Recovery must be exercised through `unlockFromGesture()` after an externally
suspended context, not a fabricated `reset('recovery')` call. The old
household-wide start happened to stop stale recordings there; independent
playback needs explicit cleanup at the actual recovery boundary.

## Verification contract

1. Exact owner/token projection on both participants; inactive clearing and
   aligned columns after memory growth.
2. Stable identity across ticks, independent simultaneous pairs, consecutive
   same-clip instances, changed clips at the same token and IDs above 30.
3. Low-word carry, tokens above `2^53`, wraparound and save/load reconstruction
   without modifying save bytes, world hash or random state during projection.
4. Independent controller starts/stops and pending decode cancellation; all
   existing lifecycle resets still clear every pair.
5. Real browser audio rendering must keep one pair audible while another ends.
   This proves sample output and ownership, not subjective mix acceptance.
6. Focused regression and mechanism-deletion checks, then integrated Rust,
   WASM, web, type and production-build checks before delivery.

## Rendered-sample evidence

`web/proofs/conversation-ownership.js` connects the real activity scheduler to
the real voice player in Chromium's `OfflineAudioContext`. A rising waveform
exposes source restarts that a constant buffer could hide. It starts a second
pair, ends that pair, then starts a new same-clip instance of the first pair.
Both participant rows are supplied, in changing order, using owners 31 and 32
and adjacent tokens `2^53` and `2^53 + 1`. Combining the words into one
JavaScript number would collapse those two identities and fail the proof.

With Vite on port 5198, this command exited zero:

```powershell
playwright-cli --session terri-audio-owner eval "async () => (await import('/proofs/conversation-ownership.js')).proveConversationOwnership()"
```

Three independent starts and three ends were emitted. Rendered samples matched
the six hand-derived checkpoints within 0.00002: 0.0448 at 0.2 seconds, 0.2016
while both pairs played, 0.168 after only the second pair ended, 0.224 during
the first pair's second clip, 0.0557013 after the new instance restarted, and
zero after both ended. The existing ten-case `proveVoiceFades()` also passed.
The isolated page reported an unrelated missing favicon; its browser session
was closed. Integrated and displayed-game evidence follows below.

## Integrated verification

All commands below exited zero on the integrated branch:

1. `cargo test --workspace`: 1,214 tests passed.
2. `cargo fmt --all -- --check` and
   `cargo clippy --workspace --all-targets -- -D warnings`.
3. `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.
4. `cargo test -p terri-wasm --release --lib conversation_identity_columns_survive_load_and_render_growth`:
   one release-boundary test passed.
5. In `web/`, `npm test -- --maxWorkers=1 --reporter=dot`: 1,304 tests across
   92 files passed, including actual rebuilt-WASM save/load and memory growth.
6. In `web/`, `npm run typecheck` and `npm run build`.

The simulation projection first failed an assertion with expected identity
`(101, 6, 2097154)` and actual `(4294967295, 0, 0)`. A wrong-column pointer
fixture also failed assertions before its three getters were corrected. Seven
initial scheduler assertions and two real recovery assertions failed before
their corresponding fixes.

Compiling mechanism-deletion checks all failed assertions with exit 1:

| Mutation | Observed failure |
| --- | --- |
| Remove Rust high word | Expected 2097154; received 0 |
| Remove owner from the playback key | Three ownership failures |
| Remove high word from the playback key | One replacement failure |
| Combine words into one JavaScript number | Adjacent wide-token identity failure |
| Globally stop on an individual end | Surviving-pair assertion failed |
| Leave an ended pending key in the map | Ended pair played after decoding |

Inverse patches restored exact production bytes after each mutation. Before
the later formatting-only pass, Rust `lib.rs` matched SHA-256
`0B928524CD06D8F5A593920CA1D6CE1A6D94513AC80839D002F791FBD4AA61F2`.
The scheduler matched
`C6B6C64A538C764EA35C1088FD907F9C1DF4DFF656369C37C7C115B030F41C88`;
the controller matched
`80574884E65AF490C228B94E5AEA0DE8DF088FD529ED03657EB542512E515A51`.
Independent review found no remaining code findings after recovery and
owner-sentinel/wide-token test gaps were repaired.

The displayed development build used the rebuilt release WASM on an isolated
local origin. Bill's directed Chat with Casey was observed during approach,
mutual facing and Talking state, paused, resumed, and followed by separate
activities. It reported no browser warnings/errors. See
`[A-independent-conversation-audio]` in `docs/alpha-feel-notes.md` for visual
findings and the screenshot. This is not a listening acceptance or a displayed
two-conversation proof; concurrent playback is covered by the sample and
integration tests above.
The production bundle also loaded, advanced the household and accepted Pause
without browser warnings/errors. Both task-owned game pages and both local
servers were closed after verification; no user-owned page or save was changed.
