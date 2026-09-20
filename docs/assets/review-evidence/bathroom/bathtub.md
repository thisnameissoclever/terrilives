# Bathtub replacement

This records the original art release. The later quarter-turn keeps these
same source/atlas bytes but pairs SW art with a migrated 1x2 collision strip;
see `bathtub-quarter-turn.md` for that release's separate evidence.

Candidate 02 replaces the existing Long Soak Directive art. Its identity,
2x1 footprint, placement, needs effects and duration remain unchanged. Four
static views append atlas records 1121 through 1124. This adds no bathing
pose, water or faucet animation.

## Source and placement

Primary and independent review accepted the source, GPU and static SE
played-room result at 90/100. Saved-scene checks
verify its cavity, physical bounds, drain/deck support, six sampled solid
contacts and spout placement. Six deliberate displacements fail; a clean
reload passes without changing the saved model. Minor residuals are broad
interior shading and partial drain occlusion in SE/SW.

Candidate 01 was rejected during played-room review because it double-counted
the half-tile footprint offset. The game emits a render row at (14.5,9) for
the object placed at (14,9). Candidate 02 is centered at local Y=0, keeping
the SE shell inside the occupied tiles. Rejected images, reports, source
snapshot and the failed room view remain in candidate 01.

Proof SHA-256: `8b5ff938cf832787038900ac50c6fc44719d9b090f98f1650faa627f64bc23c1`.
Model SHA-256: `4eb71e029fd7904cffa612fbec122831b86911f24643ff92099c8c731fc25f56`.

The separate wide exporter preserves the earlier exporters and their hashes.
Source size is 1280x1408 on a 160x176 logical canvas; atlas textures remain
2x logical size. Orthographic scale follows the longest canvas dimension.
The same world unit still projects to 32x21 logical pixels. Registration,
source hashes, complete facings and padded alpha bounds remain mandatory.

## Runtime evidence

`bathtub-four-facing-gpu.png` uses the actual renderer and footprint-centered
row offset, with no validation or uncaptured GPU errors. Only SE and its
opposite NW align with the fixed 2x1 floor strip; SW/NE show source rotations,
not supported alternate placements.

`bathtub-played.png` shows candidate 02 beside standing Casey at 05:16, within
the exterior floor boundary. The existing Take a bath action entered Using
object at 05:15 and completed by 06:22. Hygiene moved from 93.6 to 99.9 and
comfort from 90.4 to 99.9. This is action completion, not a bathing animation.

`bathtub-default-camera.png` records the full vertical lot extent at 1280x720.
The old camera calculation mistook transparent padding for tall art. It now
uses registered anchors and visible content tops. Tests cover equivalent art
at different padding/densities and the real atlas's whole-lot fit.

The final production preview loaded `index-DLrk4AoF.js`,
`terri_wasm_bg-DC-zBPUt.wasm` and atlas SHA-256
`311c9eda8a091e4407849ba520d9a3c75893341d78cfd7a00c51cced78d2ea64`.
No console ERROR entries were observed. The default-camera image has an
invalid-save banner: read-only inspection found a zero-byte local test-origin
save file, not a populated save rejected for changed content. That file was
left untouched. This run does not claim browser save-migration acceptance.
The dedicated test tab was closed afterward.

## Regression evidence

The initial wide-canvas importer and tub registration tests failed before
their implementations. The corrected footprint test also rejected the
first model before passing the centered one. Five deliberate importer
mutations are caught, including mirroring and missing anchor compensation.

All 1,121 earlier records were compared with the parent commit, including
decoded pixels and metadata excluding packed X/Y. They remain unchanged.
The masked prefix regression digest is
`6c6e9938a5de9ed35a62a45bb5dc63114a5a1c9358ced3592781e00987f6685e`.

Verification commands passed with exit code 0:

| Command | Result |
| --- | --- |
| `cargo test --workspace --quiet` | 688 tests |
| `npm --prefix web test -- --maxWorkers=1` | 698 tests, 54 files |
| `npm --prefix web run typecheck` | PASS |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS |
| `npm --prefix web run build` | PASS |
| `python -B -m unittest discover -s assets/sprites/gen -p 'test_*.py'` | 52 tests |
| `python -B -m unittest discover -s assets/models/bathroom -p 'test_*.py'` | 8 tests |
| `python -B assets/sprites/gen/check_prop_mutations.py` | Five defects caught, clean suite passes |
| `python -B assets/sprites/gen/build.py --check` | 1,125 sprites, 4096x6638 |
| `cargo fmt --all -- --check` | PASS |
| `python check-doc-ids.py` | PASS |

## Publication

PR 78 merged as `dd97e4769be682765c62235f76125a31301a6af0`.
Main CI run `35303008871` passed. Pages run `35303156290` passed, including
the actual `actions/deploy-pages@v4` step. The public game then served
`index-v-h599PH.js` and the atlas hash above; fetching the public atlas and
hashing its bytes produced that same SHA-256.

`bathtub-live.png` records the public room at 1920x993, paused at Day 2
15:37, with Casey standing beside the tub. This confirms deployed art and
room fit, not a new bathing pose. The pre-existing invalid-save fixture was
left untouched; this check does not establish save/load acceptance.
