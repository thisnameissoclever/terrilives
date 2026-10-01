# Ottoman sitting source package

This is the accepted offline candidate, not a shipped animation. The local atlas
now imports its occupied frames; GPU review and played-action acceptance remain
open. The four existing static ottoman sprites stay unchanged.

`bundle.json` maps 119 historical input and evidence paths to repository files.
Of these, 96 are byte-preserved copies under `archive/`; 23 refer to existing
shared source files. The accepted model, rejected palm-intersection fixture,
original journals, encoded sprites and review images retain their original bytes.
`ottoman_bundle.py` resolves these paths without consulting temporary `output/`
files. It rejects missing mappings, changed hashes, path escapes and aliases.

The render journal recorded 25 inputs. Two additional import-time dependencies,
`armchair_layout.py` and `render_provenance.py`, were found during source-package
review. Their current hashes are recorded as supplemental replay dependencies.
They were not retroactively inserted into the historical render journal.

The 196 full-resolution contribution PNGs remain in the original local output
directory. They are not copied into this package. Their hashes and complete
coverage are retained in the raw journal. Clean atlas builds use the retained
encoded exports and validated receipts; checking all original pixels is a separate
local verification step. A clean build must not claim to have re-encoded originals
it does not contain.

## Replaying the recipes

Run from the repository root with an absolute, nonexistent destination:

```powershell
python assets/models/living/ottoman_replay.py --stage source-tests --destination D:/path/to/new/ottoman-source-check
```

The replay tool copies inputs, never links them, and starts a separate process
without the original `PYTHONPATH`. It refuses existing destinations and verifies
that retained source bytes and the bundle catalog remain unchanged afterward.
Each stage gets its own directory; do not reuse a directory between stages.

1. `source-tests` runs the archived geometry and render-record tests with isolated
   Python. It needs the existing Pillow installation, not Blender. This stage has
   been executed successfully: 19 tests passed using only the copied inputs.
2. `contact` copies the accepted model and authoring status, then runs the strict
   contact checker and occupancy regression. It does not seed their output journals
   or the raw render journal. Newly written receipts are separate evidence.
3. `render` copies the accepted model and accepted contact receipt, then regenerates
   all contributions, encodes sprites and builds the review animation at its saved
   cadence. It does not seed raw or encoded outputs. This verifies fresh output;
   it does not replace or automatically approve the accepted output.
4. `author` reruns the additive pose builder from the original static ottoman and
   Sim rig. The candidate directory starts absent, as the unchanged builder requires.
   Its result is a new candidate, not an approved replacement.

The final three stages require `--blender` pointing to Blender 4.5.14 LTS, build
`62c1db4208e8`, on Windows. The wrapper checks that exact build before preparing
the replay. The archived scripts retain Windows path identifiers. These stages
have not yet been replayed from this package. Embedded Blender resource paths
have not been audited, so the successful Python replay alone does not establish
full Blender reproducibility.

## Checks and evidence boundaries

Fourteen archive-loader tests pass, including a 119-file clean-copy test with no
temporary originals. Three replay tests cover stage inputs, absolute executable
paths and failed journals when sources or catalog hashes change. Eleven
in-memory guard deletions fail their named assertions; all 17 tests pass after
restoration and source hashes stay unchanged. `bundle-guard-proof.json` retains
that proof, and `source-tests-replay.json` retains the separate 19-test archived
recipe run. Regenerate the guard proof with:

```powershell
python assets/models/living/prove_ottoman_bundle.py --output D:/path/to/new/ottoman-bundle-guards.json
```

The archive loader establishes file provenance, not mechanical correctness.
`assets/sprites/gen/ottoman_receipt.py` also validates complete contact samples,
collision and support measurements, raw coverage, reconstruction limits, cadence
and cross-file bindings. A null dependency digest is rejected, never treated as
permission to skip the expected hash. The reviewed importer appends 72 occupied
records and reuses existing empty records 1358..1361.

`receipt-guard-proof.json` records 28 deliberate defects detected by named tests,
followed by 32 passing restored tests and unchanged source hashes. The separate
original-image verifier re-encoded all 196 originals and matched all 48 occupied
comparisons. `originals-verified.json` binds that run to its starting catalog and
bundle hashes. A changed but internally valid evidence bundle cannot replace
the starting evidence during verification.

`prefix-guard-proof.json` records four deliberate atlas faults detected by their
specific assertions, followed by three passing restored tests and unchanged file
hashes. `runtime-guard-proof.json` records eight renderer/cancellation defects and
two proof-classifier defects, followed by 28 passing restored tests. These are
local contract checks, not browser playback evidence. Reproduce them with:

```powershell
python assets/sprites/gen/prove_ottoman_prefix.py --output D:/path/to/new/ottoman-prefix-guards.json
node web/proofs/prove-ottoman-runtime.mjs D:/path/to/new/ottoman-runtime-guards.json
```

```powershell
python assets/sprites/gen/prove_ottoman_receipt.py --output D:/path/to/new/ottoman-receipt-guards.json
python assets/sprites/gen/ottoman_originals.py --catalog assets/models/living/ottoman-reviewed.json --originals output/ottoman-sit-candidate-02/contributions --output D:/path/to/new/ottoman-originals.json
python assets/sprites/gen/build.py --check
```

Clean builds validate retained receipts and encoded exports without the original
PNGs or Blender. Full original verification requires the explicit local directory;
it does not silently fall back to another location. Neither tier proves played
acceptance. See `docs/assets/review-evidence/living/ottoman-sitting.md` for the
current runtime boundary.
