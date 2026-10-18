# Room browser transport checkpoint

R6 implements and verifies the native room transaction boundary, private wire V1, browser bridge and storage/persistence paths. This is a local checkpoint for fresh R6 review. R7's room controls, native Begin integration, removal of the browser baseline and deferred exit flow remain pending. Nothing was pushed or published.

The accepted base is `e9fae39a1c9316ef88e1320c060dde76cc3eab24`, containing main `513c86be2aa44fb4d5576279d0e1ae69991e870e`. The containing Git commit identifies this checkpoint. Published V1-V15 layouts, command discriminants, original fixtures, frozen workers, dependencies, target flags, all 33 models and Patio covering 4 remain unchanged.

## Implementation and contract

1. `browser_rooms.rs` owns bounded native request decoding and fallible private byte projections. [Wire V1](wire-v1.md) records every field, tag, error detail and method-specific envelope. The summary carries dimensions and native ID/anchor/name/area rows together, with explicit failure. Selection, tile and revision queries remain pure.
2. Tokens and revisions remain exact JavaScript bigint values. Stage names use bounded raw UTF-8 packets, controls-before-Rust-trim validation, 1-48 Unicode scalars, no separate 1024-byte raw cap, fatal decoding and lone-surrogate rejection. Literal leading U+FEFF survives actual-module save/reload and Chrome summary/review. Canonical names fit 192 UTF-8 bytes.
3. Native preparation retains its original sparse overlaps in private Prepared. Token-and-anchor predecessor lookup returns only actual overlaps, independently of current chosen inheritance. A real new component returns an empty success list; an invalid anchor fails. The browser does not calculate geometry or allocate provisional identities.
4. The protocol-free `prepare_build_commit_projected` borrows the validated review before changing the preparation counter or installing Prepared. Wasm supplies the fallible serializer. Its injected failure control retains a nonempty draft, staged names, counter, view revision, nonempty runtime observations and the old usable token. Preparation can still settle newly queued input at entry; this control has no new queued commands. Existing public preparation and private validator controls remain intact.
5. Duty owners are stable SimIds. Replanned/unavailable people are raw person entity indices. A native reused-slot witness proves that candidate full Entity generations can differ while raw index, SimId and name agree. The actual module resolves a reported raw index 1 whose SimId is 0. Room-bearing chore targets, object targets, tile indices and shared Dishes target 0 retain their separate meanings.
6. Native committed capture already owns persistence. The bridge adds no baseline, journal comparator or raw-draft save API. The 16 MiB request ceiling and remaining-byte/native-capacity checks precede hostile allocation. Generated duty bounds follow baseline/final key producers, without a blanket 100,000-duty or outbound byte cap.

## Gates and source scope

Every listed command exited zero. Native jobs and test threads were one; Vitest used one worker with a 4096 MiB Node heap limit. [Gate receipts](gates.json) retain exact argument arrays, exits, log hashes, per-run before/after fingerprints and generated artifacts. [Retained-file records](retained-files.json) distinguish original raw logs from normalized Git viewing copies. [Index verification](index-verification.json) records the staged bytes separately from working copies and excludes its own self-referential hash.

| Gate | Result and actual scope |
| --- | --- |
| Complete native Wasm boundary run, before the projector refinement | 307 unit tests, four example tests; one optional private-input example explicitly ignored. Exit 0. Retained executable SHA256 `8fe9c3086062e203bf0d9e94007aadc089a62b6c27655f22a3f642f1c20b3e76`. |
| Current transaction checks | 35 passed, including sparse inheritance, reused entity generations, injected projection failure, unchanged public prepare and private validator controls. The two transaction source files are byte-identical between this gate and the final checkpoint. |
| Final optimized boundary matrix | 10 passed under `--release`. Covers byte literals, every group/duty/chore tag, exact wide tokens, malformed counts/options/UTF-8, duplicate choice keys, inherited zero refusal, stale wide tokens, control/name handling, pure Outside selection, land translation and current fixture admission. |
| Final actual generated module | Eight files, 248 passed. All seven previously deferred module/storage cases ran. Includes the authentic nine-case V15 corpus with 120-update exact current continuation, sparse repartition rejection/atomicity, new-component empty eligibility, confirmed membership, west/north translation, BOM names, repeated/stale commits, successful/rejected Load and direct persistence/autosave. |
| TypeScript | Type check passed. |
| Strict workspace/all-target clippy | Passed with `-D warnings`. This is compilation/lint evidence, not another complete workspace test sweep. |
| Web build | Passed. Existing large-chunk, ineffective dynamic-import and asset-plugin timing notices remain warnings. No dependency or chunking change was made. |
| Final actual Chrome | Ten real OPFS cases plus literal BOM/cancel-token and fixed checksum witnesses passed. Browser-fetched module bytes match the final release artifact. |

The final native fingerprint is `67adab4fb28ea4bbc3f42543069939636f414f883cca00fbb2925926a20881bd` over 463 inputs. The final broader source fingerprint is `d4934194273928875a1ee056e548a7c93a08abec339d4382c99aa0bf75671dae` over 1038 inputs. [Current source](source-manifest.json) and [native source](native-source-manifest.json) retain their paths and raw file hashes. Generated-artifact hashes in host-only receipts identify files present at that time; those commands do not execute Wasm.

The normal release build ran at broader fingerprint `ce7487c3e8e1e66ba8e077daccaf46a6ec31b37a9004e248fc40a4a07c9ddb2d`. Later changes touch only `room_transport_tests.rs`, `room-codec.test.ts` and `room-bridge.test.ts`. [The exact delta](post-build-test-delta.json) proves production source is unchanged. The optimized boundary, actual-module, type and strict lint receipts retain their own real source scopes; no final hash is applied retroactively to older gates. The web-build receipt is similarly before the last test-only assertion.

No contemporaneous pre-run source manifest was captured for the earlier 307-test run. Its actual log and executable are retained. [Its reconstructed snapshot](full307-source-reconstruction.json) has fingerprint `1c922aad22fbc78bf4f6a0861d720171e41b72681e41633a44e7cea29df94f9b`, obtained afterward by reversing the recorded projector/BOM edits in ignored copies. It is explicitly labeled reconstructed and is not presented as a live before/after manifest. The dated [prior native yard review](native-v16-yard-review.md) remains prior scoped acceptance, not R6 approval.

## Release artifact and browser evidence

The unchanged command was `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm`.

| Artifact | SHA256 |
| --- | --- |
| `terri_wasm_bg.wasm` | `6c0562aca59fe17b20000845ebeddb71337859b2b39bd8e212a10ec5ab3154c1` |
| `terri_wasm.js` | `9c9504d64f536e175ca02ebd842e204fd518286f58b329ea0420a0fd1597508e` |
| `terri_wasm.d.ts` | `fcf9afe47b6fa648877ca852f8f02af2e861bfb6c9ab5dcb5d650c44a66867f3` |
| `terri_wasm_bg.wasm.d.ts` | `8d6732a90ab775b6e4b14510a7f6930870fc8fe92faae3462af26dd85399c5a3` |

The independent fixed 100-tick release-Wasm and Chrome measurement is `4661132544113609906`, equal to the pinned native value. It was not calculated as the test's expected value from the tested module. The original published control remains `4676206450852028819`. A separate actual-module check loads the untouched original public-100 V15 file with SHA256 `e4d329c36b81dbe109d639bbfbca14760fb29b7dc567ddc7c1b4a647109d7325`, preserves its empty LegacyCells representation, strictly round-trips V16 and continues exactly for 120 updates. [That proof](legacy-golden-continuation.json) preserves historical coverage after the stale blank-constructor tests were corrected.

[Chrome results](chrome-opfs.json) and the [retained harness](chrome-opfs-proof.html) use actual Chrome 155, actual OPFS handles/streams, real workers and Web Locks. Each case uses a fresh task-owned directory in an isolated temporary browser profile at `127.0.0.1:5192`. The fault harness redirects only the production worker's OPFS root to that actual directory and injects throws at actual open/write/close boundaries; it does not emulate filesystem state.

1. V14 and V15 first writes preserve exact backup bytes before opening the current primary, repeated writes preserve them, actual cached old workers refuse V16, and current New game removes only the primary while retaining older backups.
2. All six backup/primary open/write/close failure cases preserve the appropriate primary/backup state and then retry successfully. Malformed existing backup refusal and concurrent real workers also pass.
3. The page proof frees native handles and terminates workers in finally. The wrapper closes its browser and stops its own strict-port Vite server in finally. Only task-owned OPFS directories are removed. Cleanup is retained; parent server session 59193 on port 5189 was untouched.

For reproduction, copy the harness into ignored `web/.scratch/r6-room-proof.html`, copy the unchanged V14 fresh and V15 chat-waiting-owned inputs to its two named scratch files, start the existing dev command on a task-owned strict port, and run `window.runRoomProof()` through Playwright CLI in a fresh Chrome session. The parent retains the exact ignored wrapper and original logs. This proves API failure handling on real browser storage, not power-loss durability or a played UI pass.

## Failed receipts and acceptance limits

The original failures remain separate from final success: missing getter/exports/codec during test-first work; invalid fixture assumptions about default flooring, Entity generations and work admission; stale header-15 assertions; stale legacy-constructor/byte-tail assumptions; a wrongly shaped doorway test argument; a numeric land-success assertion; the missing projector; and clippy's unnecessary borrow. Their retained logs are not relabeled green. Current blank tests exercise the explicit empty edge constructor and strict loading. Authentic historical inputs remain unchanged; no byte-tail mutation, retagging or reader relaxation was used.

The direct PersistenceController proofs cover its real native byte capture, including a genuine daily autosave trigger reached before entering Build. Actual DOM manual Save, visibility events, graphics Retry handle preservation and session/exit behavior remain R7 integration gates. No absent update-save or recovery-save control was invented. The old BuildSession and main hooks are untouched, and the existing exit controller remains R7-owned.

The optional funded play setup also loads the untouched seed to a 30x26 lot with seven enclosed rooms plus one Outside. [Its receipt](play-seed-setup.json) identifies the original seed and the new ignored `.local-build/r6-room-play-current16.sav` output. This is play setup, not a compatibility fixture. Current transport fixtures are separately identified and reproduced in their [fixture README](../../../../crates/terri-wasm/tests/fixtures/room-transport-v16/README.md).

No public changelog note is added for this internal transport checkpoint. The parent owns the complete player-facing room note, fresh R6 review, R7 integration, played responsive/visual acceptance and final broad workspace gates before delivery.

**Next steps**: Parent reviews this checkpoint, then releases R7 after acceptance. No user action is needed for R6.
