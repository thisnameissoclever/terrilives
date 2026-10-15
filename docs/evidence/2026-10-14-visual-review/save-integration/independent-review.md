# Independent save integration review

Reviewed on 2026-10-14 in `D:/VIBES/.worktrees/5637/terrilives`, with HEAD at
`e999fdf8f496756b16ddd1670e77b922c924cc0b`. The implementation was uncommitted;
HEAD identifies the published-main baseline, not the complete reviewed source.

No actionable defect was found in the reviewed integration. This is a scoped
source review with a small independent runtime probe, not full-suite or browser
acceptance. No production files were changed by this reviewer. This report is
the reviewer's only write.

## Source review

1. `crates/terri-wasm/src/lib.rs:2575` decodes the published social V9 envelope
   and unpublished character V9 envelope separately. Both decoders require an
   empty remainder; a successful prefix decode is insufficient.
2. `crates/terri-sim/src/lib.rs:1274` validates both candidates without adopting
   either first. Exactly one valid candidate is required. Two valid candidates,
   two invalid candidates, or absent candidates return an error.
3. `crates/terri-core/src/save_v10.rs` retains the local character V9 layout as
   `LegacyCharacterSnapshotV9`. The current V10 envelope stores social state,
   character records, and character command ordering separately. The published
   `save_v9.rs` and embedded V6/V8 source files have no diff from HEAD.
4. `crates/terri-sim/src/save/v10.rs:50` restores the base and social state before
   attaching validated character records. `validate_characters` checks the
   combined command count through the existing zero-as-unlimited helper.
   `restore_characters` requires exactly one record per living person and the
   correct number of ordinary-command placeholders before reconstructing the
   interleaved queue.
5. `crates/terri-sim/src/lib.rs:1392` adopts through the current-world path.
   `crates/terri-sim/src/character_draft/application.rs` supplies missing
   historical appearance components using fixed defaults and saved SimIds,
   without drawing simulation randomness.
6. `web/src/storage/save-worker.ts:123` preserves V9 bytes under the V9 recovery
   filename before writing V10. The frozen V9 worker refuses a V10 primary
   header. The worker remains a header guard; it does not validate full payloads.
7. Inspected the existing authentic-fixture, interleaved-command, RNG,
   invalid-state, and ambiguous-candidate tests in
   `crates/terri-wasm/src/character_tests.rs` and
   `crates/terri-sim/src/save/v10.rs`. Those test sources provide coverage intent;
   this reviewer did not rerun their native test commands.

## Independent runtime probe

The following exact PowerShell command ran from the repository root against the
already-built WASM. It did not rebuild, start a browser, or write saves to disk.

```powershell
node --input-type=module -e 'import fs from "node:fs"; import init,{SimHandle} from "./web/src/wasm/terri_wasm.js"; await init({module_or_path:fs.readFileSync("web/src/wasm/terri_wasm_bg.wasm")}); for (const name of fs.readdirSync("crates/terri-wasm/tests/fixtures/schema-v9").filter(x=>x.endsWith(".sav"))) {const bytes=fs.readFileSync("crates/terri-wasm/tests/fixtures/schema-v9/"+name);const sim=SimHandle.from_lot();const restored=SimHandle.from_lot();try {if(!sim.load_bytes(bytes))throw Error("load "+name);const current=sim.save_bytes();if(new DataView(current.buffer,current.byteOffset).getUint16(8,true)!==10)throw Error("version");if(!restored.load_bytes(current)||!Buffer.from(restored.save_bytes()).equals(Buffer.from(current)))throw Error("roundtrip "+name);for(const bad of [Buffer.concat([bytes,Buffer.from([0])]),bytes.subarray(0,bytes.length-1)]){if(sim.load_bytes(bad)||!Buffer.from(sim.save_bytes()).equals(Buffer.from(current)))throw Error("rejection "+name)}console.log("PASS "+name+" load, exact V10 roundtrip, transactional tail/truncation rejection");}finally{sim.free();restored.free()}}'
```

Exit code: `0`. Verdict: **PASS** for the checks above. Observed output:

```text
PASS local-character-0.sav load, exact V10 roundtrip, transactional tail/truncation rejection
PASS local-character-1200.sav load, exact V10 roundtrip, transactional tail/truncation rejection
PASS local-character-400.sav load, exact V10 roundtrip, transactional tail/truncation rejection
PASS main-social-0.sav load, exact V10 roundtrip, transactional tail/truncation rejection
PASS main-social-1200.sav load, exact V10 roundtrip, transactional tail/truncation rejection
PASS main-social-400.sav load, exact V10 roundtrip, transactional tail/truncation rejection
PASS main-social-active.sav load, exact V10 roundtrip, transactional tail/truncation rejection
```

The malformed variants were one appended zero byte and removal of the final
byte. This was not exhaustive truncation or fuzz testing. Byte equality compared
the migrated V10 save with its V10 reload and checked unchanged live bytes after
rejection. It did not compare historical and current execution over future ticks.

## Provenance checks

These read-only commands ran from the repository root:

```powershell
git diff HEAD -- crates/terri-core/src/save_v9.rs crates/terri-core/src/save_v6.rs crates/terri-core/src/save_v8.rs
git hash-object web/tests/fixtures/v9-worker/save-worker.ts
git rev-parse HEAD:web/src/storage/save-worker.ts
git hash-object web/tests/fixtures/v9-worker/save-header.ts
git rev-parse HEAD:web/src/storage/save-header.ts
Get-ChildItem crates/terri-wasm/tests/fixtures/schema-v9/*.sav | Get-FileHash -Algorithm SHA256
Get-FileHash web/src/wasm/terri_wasm_bg.wasm -Algorithm SHA256
git rev-parse HEAD
```

The successful command batches exited `0`. The core-layout diff was empty.
Both worker comparisons matched:

| File | Fixture and HEAD Git blob hash |
| --- | --- |
| `save-worker.ts` | `6970043ea326446d679779d3c2bced19edba7bd8` |
| `save-header.ts` | `d0af8be979612f9f834f28d5fe58a6e543d2acdd` |

All seven observed save hashes matched
`crates/terri-wasm/tests/fixtures/schema-v9/provenance.json` and the copy in this
evidence directory:

| Fixture | Observed SHA-256 |
| --- | --- |
| `local-character-0.sav` | `8fa748db328864248779f97df1082a146293f442603e4775333cd83039fda989` |
| `local-character-1200.sav` | `fa87f14865f2ee239d685c3a884cc71d51631feb47070c76edd86624c8aba2cf` |
| `local-character-400.sav` | `90b3cff33cb953df7ff41c2ce667f6780060da7a13a4c798e65ddd5745f969f4` |
| `main-social-0.sav` | `995d1f84cf4c2d621cc346988df719a263d9122d2d2636f9972b0a98531a2149` |
| `main-social-1200.sav` | `ad0e6025d11cc1df81cf8744cae22427d6a78de0cf32574cc5842d60144cbe47` |
| `main-social-400.sav` | `91551537c1cd34140abe2338e1d568738a0e9cf97054bfc70c98be960c0ee224` |
| `main-social-active.sav` | `b3bf436324ee55f459d7883c60f6a345b65a562ab5ecdf337f2e0f8cd0c68dda` |

The inspected WASM SHA-256 was
`c57dd4776779113f7c5f8639b9344afa8de15a9aed786ab08d161900e53effcd`, matching
`verification.json`. These checks establish artifact identity against the
receipts. This reviewer did not independently rebuild the historical producers.

An initial comparison against the producer snapshot's nonexistent `web/` path
failed because that snapshot contains only the producer's required source.
The successful comparisons above use the actual published HEAD Git blobs.
One earlier `rg` command using a Windows wildcard path also failed; it supplied
no review evidence.

## Limits and pending evidence

1. The complete native suite was still pending when this report was written.
   The root coordinator reported core/data passing and the simulation suite
   running; this report does not independently certify those runs.
2. Actual browser filesystem Save/Load and visual acceptance remained pending
   with the root coordinator. The Node probe does not establish browser OPFS,
   cached-tab behavior, or interface acceptance.
3. No heavy tests, browser sessions, publication, or production edits were
   performed by this reviewer. Subsequent implementation changes require
   assessing whether this scoped review still applies.
