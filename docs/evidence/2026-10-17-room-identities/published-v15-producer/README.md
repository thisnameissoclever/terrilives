# Published V15 save producer

These saves were written by the unchanged published game at commit `a481d7c7be0708c4523d9a156513b6696aaff6f6`. They test the published conversation envelope, which predates the room envelope in V16. The current room implementation did not produce these bytes.

The [fixture manifest](../../../../crates/terri-wasm/tests/fixtures/room-identities-v15/manifest.json) records each save's SHA-256, byte length, capture tick and verified replay length. Each adjacent JSON file records the original request phases, exact player order IDs, entity indices, stable person IDs and command trace. Person ID zero, request ID zero and order ID zero are valid.

## Producer verification

1. Export the exact published revision into an ignored directory. The retained source receipt identifies the full archive and its SHA-256. Only the native workspace, content, sprite atlas and voice build inputs are needed for the producer build; unused artwork was omitted from the build directory.
2. Check every compiled input against the published Git blob and SHA-256 in `published-v15-inputs.json`. The build script checks the inputs again after compilation.
3. Build the original WebAssembly module with the locked dependencies and one Cargo build job. `published-v15-build.json` records the command, actual exit code, tool versions and output hashes. The build passed without changing its source inputs.
4. Generate scenarios through the original public command interface and normal simulation updates. The retained scripts show the commands used. They do not edit requests, saved fields, positions or WebAssembly memory.
5. Load every captured save into a second instance of that same original module. Require an exact immediate resave, identical world hash and at least 120 further updates with identical save bytes and hashes between the uninterrupted and reloaded instances.

The small Rust codec strictly decodes the exact published V15 outer type, checks that no payload remains, and requires byte-identical reencoding. Its linked older core artifacts provide the unchanged V1-V14 and command types. The codec only observes saves and encodes commands; the original WebAssembly module writes every retained save. Its compilation command is in `published-v15-codec-build.json`.

## Scenario meaning

| Save | Original state at capture |
| --- | --- |
| `fresh.sav` | Seed 42 at tick zero, with no conversation requests. |
| `chat-queued.sav` | A real player chat command is still in the unprocessed input queue. |
| `chat-approaching.sav` | The player request owns its target and matching rendezvous. |
| `chat-waiting-owned.sav` | The request owns a waiting destination; its target is represented by the V15 request rather than a raw saved Target. |
| `chat-waiting-arrived.sav` | The initiator reached the waiting tile through normal movement. The recipient remains unreserved by this request. |
| `chat-waiting-private.sav` | The recipient is taking a bath while a player request waits outside the private interaction. A new person was created through the public spawn API with hunger 100; the script verifies that this new person and the bath state roundtrip before requesting chat. |
| `chat-talking.sav` | The player request has started an actual timed conversation. |
| `chat-talking-later-identical.sav` | The active request owns the first player order, and a later identical chat remains queued. Original replay confirms that completing the first order preserves the later order. |
| `chat-suspended.sav` | A front-inserted chat suspends the original request without deleting its exact order. Another real request is approaching. |

The private-wait scenario's first exploratory attempt used an existing person who had other work and did not reach the requested capture condition. That attempt produced no fixture. The retained successful script uses a newly spawned person and records that choice explicitly. An earlier chat harness lookup used `chat` where the intent queue stores `social:chat`; the corrected successful runs provide the retained replay evidence.

The retained scripts preserve the local paths used for this dated run. To reproduce elsewhere, restore the exact published source and adjust only those tool and output paths. Original producer binaries, the large archive and temporary build outputs remain ignored. No video is retained.

This record proves original V15 production and replay. Current V16 migration, malformed-input rejection, Build transaction conservation and browser recovery require separate checks against the integrated implementation.

The [independent corpus review](corpus-review.md) accepted the original-save evidence without a Critical or Important finding. Its minor fixture backlink finding is corrected in this README. The private-wait and suspended cases prove bounded replay; only the duplicate-order shared trace separately asserts the first chat's completion while the later order survives.

## Published checksum reference

After the corpus review, `probe-published-v15-golden.mjs` independently exercised the unchanged original public module with the native checksum scenario: a blank 24-by-24 lot, the shipped fridge at `(18,14)`, eight public person creations at `(1..8,1)` with hunger `30 + 5 * index`, then 100 updates. Its world hash is `4676206450852028819`, matching published main's literal native golden. The adjacent `published-v15-golden-public-100.json` records the resulting state, byte hash and exact original load/resave check; its `.sav` retains the observed bytes. This separate reference was not part of the nine-file corpus review and does not establish the integrated room scenario's expected checksum.

The `text-retention.json` record distinguishes original copied text from Git-stored text where Git converts CRLF line endings to LF. It records both hashes and byte lengths. Source-input hashes, produced module hashes and binary saved-game bytes retain their original meanings; saved-game bytes must match exactly.
