# Next main integration preflight

This is a read-only plan against frozen branch `477ca9ced027aad14d8c134435cb96d5bf5a3d76` and incoming main `513c86be2aa44fb4d5576279d0e1ae69991e870e` (PR 289). No fetch, reference/index change, tracked edit, build, test or browser run occurred. Only this ignored report was written. Parent retains the active full-native/clippy run and will explicitly release source and heavy-command ownership.

## Merge scope

1. The GitHub comparison from `b7ee082af` confirms three appended models: `pool`, `pool_lounger`, `patio_umbrella`. All classify under the Yard store room and Outdoor category. Pool and umbrella are decorative; lounger has its existing shared Sit action and one seat. The new content test preserves the prior model prefix and separately asserts those three appended IDs. The compiler/lib changes are tests; there is no new save schema or core envelope change.
2. Preserve the complete incoming atlas, twelve appended outdoor sprite records, registered outdoor depth, depth loader, activity-category entry, tests and source/provenance assets. The incoming architecture descriptor starts at sprite ID 30939; the branch starts at 30927. The twelve-row increase is expected. The branch has no independent `atlas.ts` conflict to resolve.
3. The six known overlaps are architecture configuration, inherited-runtime pack, simulation render tests, FEATURES, GAME-SYSTEMS and generated architecture registration. Preserve the added lounger test row and both sets of documentation. Resolve configuration by retaining both `catalogueExtensions` for Patio and the incoming `historicalExtensions` entry for `static-props-07.json` (canonical SHA256 `ad19cb6b272360a9979e122a3b55eda335ea3b28f7ce00d79d9093cbc05470ce`). Do not hand-merge generated IDs or choose the branch's packed bytes.
4. After release, fetch the inspected revision through normal Git history and verify its identity before the normal no-commit merge. Use one mutation/session/exit receipt at a time. If main advances again, inventory that delta before selecting a new target. Do not reset, rebase, retry an unknown merge outcome or alter MERGE_HEAD manually.

## Architecture-only regeneration

The normal full command is `python -B assets/sprites/gen/build.py`, with `--check` for verification. Its parser currently exposes only `--check`; there is no architecture-only CLI flag. Running it imports and repacks all character/furniture art, which is unnecessary for composing this branch's unchanged Patio catalogue with an already-generated incoming atlas.

The existing generator module offers the smaller route. `assets/sprites/gen/offline_architecture.py` exports `load_reviewed_architecture`, `generated_files`, `is_current` and `obsolete_files`. Its own `test_offline_architecture.py` uses these functions to generate architecture independently and verify the complete historical offset. Use those functions in a small ignored integration driver after release, without adding a new public generator interface:

1. Verify that incoming `assets/sprites/atlas.toml`, `web/src/render/atlas.ts`, outdoor depth inputs and atlas resources remain exact incoming-main files. Count the incoming atlas records with `tomllib`; assert 30939. Do not derive the count from the branch's stale descriptor or hardcode it as an unverified replacement.
2. Merge the architecture configuration as described above. Call `load_reviewed_architecture()` to retain its source hashes, reviewed manifest, pixel/registration checks and validated Patio catalogue extension. Call `generated_files(batch, count)` using the verified incoming atlas count.
3. Compare every generated output before writing. The only expected change from the incoming generated set is `web/src/render/architecture-data.ts`, adding Patio catalogue entries while retaining incoming base 30939 and every corresponding sprite ID. Require every other generated resource to satisfy `is_current`, and require no obsolete architecture-owned output. Stop on an unexpected resource difference instead of expanding into a full art rebuild automatically.
4. Write the descriptor through the generator's returned bytes. Require Patio covering ID 4, the unchanged first three covering mappings, and unchanged floor geometry, baked-pixel identities, resources, hashes and registration. A generated base descriptor with no catalogue extensions must match exact incoming architecture data; the combined descriptor may differ only in the declared Patio catalogue additions.
5. Run the existing targeted Python architecture import/catalogue tests, including `test_patio_extension_preserves_accepted_catalogue_and_baked_pixels`, `test_generated_ids_follow_the_complete_historical_prefix`, and compressed-resource checks. Parent can separately retain any broader required asset gate. No Blender render, new art acceptance or full character import is justified by these two configuration additions alone.

This uses the production generator functions rather than editing its generated TypeScript. It avoids rerendering or repacking the incoming atlas. The complete historical-pixel validator in the full `build.py` pipeline is not claimed to have run by this targeted route; byte equality to exact incoming atlas inputs and the focused generator checks are its stated proof boundary.

## Combined inherited-runtime fixture

The exact incoming pack was read through the GitHub contents API at the pinned main revision:

1. Path: `crates/terri-data/tests/fixtures/inherited-runtime.pack`.
2. Length: 22982 bytes.
3. SHA256: `76f1feeb977863df7e5220ca66fe5e78c578417978a917ed7e4ccab0d4d11b42`.
4. Git blob: `fce0fe0940475c521fc885d28e3862174ec838f0`.

Use exact incoming-main bytes as the input for regeneration, after recording the branch's existing pack and confirming its history is retained. This is a baseline for proof, not a final ours/theirs binary resolution.

The existing test/writer is `inherited_runtime_fixture_compiles_real_model_actions_and_rounding` in `crates/terri-data/tests/inherited_runtime.rs`. It already decodes the input completely, checks three prior coverings and their values, checks four combined coverings, removes only the appended `Outdoor patio`, and requires byte-for-byte encoding equality with the input. Therefore it will also protect all incoming Yard models, sprite references, actions, metadata and every unrelated compiled field.

Run the following command serially in two separately recorded subprocesses, with the indicated environment variable set only in that subprocess:

```text
cargo test -p terri-data --test inherited_runtime --locked --jobs 1 inherited_runtime_fixture_compiles_real_model_actions_and_rounding -- --exact --nocapture --test-threads=1
```

1. `TERRI_PROVE_RUNTIME_FIXTURE=1`: require exit zero and unchanged input bytes/hash. Removing only Patio from the combined compiled pack must reproduce the exact 22982-byte new-main pack above. Earlier a481 proof cannot substitute for this.
2. `TERRI_WRITE_RUNTIME_FIXTURE=1`: only after the proof succeeds, use the existing `.pack.staged` write plus atomic rename. Record the new hash and require a normal run without either variable to pass.
3. The old ignored `.local-build/v16-patio.py` is pinned to a481 and old filenames. Do not rerun it unchanged. A new ignored driver must use the new revision/hash and unique logs, preserve input bytes until the proof exits, and capture native exit immediately.
4. Validate the inherited-runtime and content-hierarchy targets, the incoming lounger render row and the relevant architecture/depth tests. Preserve historical V14/V15 saves and frozen producers unchanged. No save-version bump is needed for this merge.

## Narrow public V15 lifecycle coverage

The current `every_public_snapshot_writer_reads_the_committed_baseline` test admits a V15 projection before Build and checks both V15 writers plus V16 during a Patio draft. It stops before Cancel and Confirm. Extend that existing test after the current assertions:

1. Cancel the draft, assert Build remains active, and require both `try_save_snapshot_v15() == Ok(original_v15)` and `save_snapshot_v15() == original_v15`, plus unchanged V16 baseline.
2. Prepare and commit a no-op review from the restored baseline, require Build to remain active, and repeat those exact V15/V16 assertions.
3. Stage another draft, Cancel again, and repeat the same assertions. This checks the reset baseline after Confirm without assuming an arbitrary edited household has a historical representation.

The source supports this bounded expectation: preparation detects `same_authored`, restores the complete original baseline, and uses `unchanged_duties` when topology is unchanged; it skips final maintenance for no-net change (`build_transaction.rs:367-430`). Cancel restores the recorded V16 baseline and leaves Build active. Both V15 writers route through `committed_projection`.

This control establishes writer routing across those lifecycle boundaries on an admitted representable baseline. It does not claim that a newly confirmed outside-duty state projects to V15, or that every changed confirmation preserves the old V15 bytes. Keep existing V16 changed-confirmation and strict historical refusal controls. Execute the extended test only after source release; representability here is a source-backed proposal, not an executed result.

**Next steps**: Parent finishes the frozen native gates and scoped review, then releases the normal merge, targeted architecture generation, pack proof/write and lifecycle-test extension as one coherent integration batch. No user action is needed for this preflight.
