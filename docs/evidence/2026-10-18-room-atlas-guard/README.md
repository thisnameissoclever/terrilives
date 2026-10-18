# Architecture preservation guard repair

The historical architecture assertion now accepts the four approved Outdoor patio catalogue entries while retaining its original digest. The original failure reproduced locally; the repaired guard and its negative controls pass. No player-facing behavior changed in this follow-up.

## Cause and exact source scope

Main CI run `39113866004` failed the historical descriptor assertion inside the step named `Sprite atlas is reproducible`: 250 generator tests ran, with one failure. That assertion failure does not establish changed atlas pixels or generated-file nonreproducibility. The old guard hashed the whole architecture catalogue after removing derived drawing IDs, so the reviewed Patio append changed its digest from `2c76b1dd414f57a69ecd72582454588fdbc28f20b54c2eb98f01e7d1688ba245` to `a7671aabbe542ec2b311246bf9f12c016392da6c91c6f7256563ab6af2ba7eb9`.

The independent Git comparison in `architecture-delta.json` covers the approved Patio commit `e8fdeefad9666085fbaf29bb5661711ddf288647`, its parent, fresh-base main `513c86be2aa44fb4d5576279d0e1ae69991e870e`, and merged main `10ced796be86ede188e1fd104cf916d5db58fd6b`. Both relevant comparisons find exactly four catalogue additions: covering 4, pattern and finish `floor.outdoor-patio`, and palette `stone-gray`. Every other architecture field and all 472 sprites match after removing only their derived IDs. Fresh-base and merged main use the same base ID, 30939.

The patch changes only `assets/sprites/gen/test_aquarium_prefix.py`, appends two lessons to `docs/lessons-learned.md`, and retains this evidence. The lessons cover approved catalogue extensions and delivery reports that distinguish completed repairs from actual unresolved defects. Runtime code, generators, generated assets, dependencies, workflows, saves and public changelog entries are unchanged. A public release note is unnecessary because this follow-up repairs an internal assertion without changing player behavior.

## Preserved guarantees and negative controls

1. The architecture helper checks its base against the actual full atlas length and checks every sprite ID against its local position. It asserts every exact reviewed Patio entry independently of the live source file, removes only those four entries from a copy, then applies the unchanged historical digest. Original geometry, resources, resource hashes, local order, prior catalogue values and every other descriptor field remain covered.
2. The existing original-record and decoded-pixel test remains unchanged. It checks all 2445 released sprite records with the unchanged `892bb76d3c6ae84b0aeb5aae9cd49ce3c0689ce90a8d6a5c23d36f0641f2b149` pixel/record digest. The existing bed, dining, coverage, surface and other registration-table test also remains unchanged and passes.
3. Nine descriptor mutations must fail: base offset, drawing ID, anchor geometry, sprite order even with reassigned consecutive IDs, resource name, resource pixel hash, old covering identity, undeclared covering and undeclared palette. Fifteen Patio mutations must fail: each missing entry, each changed field, every extra object field and changed covering identity. They exercise the same preservation helper as the real descriptor test.
4. Existing architecture-extension tests reject altered historical pixels, missing history, undeclared records, swapped extension identity or pixels, duplicate/escaping catalogues and changed pinned catalogue hashes. Existing Patio tests verify accepted catalogue preservation, byte-identical generated resource payloads, and invalid append/resource/palette/finish rejection.
5. `preserved-assets.json` records identical Git blob/tree identities between fresh-base and merged main for the entire `web/public` tree, sprite TOML, atlas TypeScript, coverage descriptor and accepted architecture export directory. This proves those source bytes were preserved across the Patio merge independently of the test repair. It is a byte comparison, not a new browser playthrough.

## Actual verification

All commands run from the worktree root with `PYTHONPATH=assets/sprites/gen`, one process at a time. Raw logs remain in `.local-build/room-atlas-followup/`; normalized copies are retained beside this document.

1. Red: `python -B -m unittest test_aquarium_prefix.AquariumPrefixTests.test_architecture_keeps_geometry_resources_and_local_order_when_its_base_moves`. Exit 1; one failure in 0.958 seconds, matching the CI digest mismatch. Log: `focused-red.log`.
2. Focused green: `python -B -m unittest -v test_aquarium_prefix.AquariumPrefixTests.test_architecture_keeps_geometry_resources_and_local_order_when_its_base_moves test_aquarium_prefix.AquariumPrefixTests.test_architecture_guard_rejects_unrelated_descriptor_drift test_aquarium_prefix.AquariumPrefixTests.test_architecture_guard_rejects_missing_or_corrupt_patio_entries`. Exit 0; three tests in 0.963 seconds. Log: `focused-green.log`.
3. Relevant regression: `python -B -m unittest -v test_aquarium_prefix test_architecture_extensions test_offline_architecture.ArchitectureImport.test_patio_extension_preserves_accepted_catalogue_and_baked_pixels test_offline_architecture.ArchitectureImport.test_catalogue_extensions_refuse_overwrites_gaps_and_invalid_resources test_offline_architecture.ArchitectureImport.test_catalogue_extension_hash_is_pinned`. Exit 0; 18 tests in 97.777 seconds. Log: `regression-green.log`. Pillow emits existing `getdata` deprecation warnings during historical extension imports.
4. Independent revision comparison: `python -B .local-build/room-atlas-followup/compare-architecture.py`. Exit 0; exact four-entry delta retained in `architecture-delta.json`. `preserved-assets.json` separately records the asserted equal Git objects.

The full sprite suite, regeneration check, Rust suite, web suite and browser verification were not rerun for this internal test-only patch. Main CI's other 249 generator tests had passed; this follow-up adds focused negative controls and reruns relevant preservation and Patio checks. Fresh review and authorized delivery belong to the parent agent.

**Next steps**: The parent reviews this patch and completes the authorized commit, push and merge. No decision or action is needed from the owner for this repair.
