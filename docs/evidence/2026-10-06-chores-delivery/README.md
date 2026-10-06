# Household chores delivery verification

Date: 2026-10-06. Repository: `terrilives`. Branch: `twcx/household-chores`.
The delivery integrates published main `d19c2d6e10487145813e7a1ae1469cc42dd730b9`
with the household chores implementation. `source-receipt.json` identifies the
inspected runtime, persistence and regression-test source bytes.

## Compatibility and independent review

Published EditHousemate remains command 22. The new chore commands occupy 23
through 28. V5 preserves dining, skills and affinities before targeted cleanup,
chores and grime. Historical nested records retain their encoding. The decoder
checks all 18 appended fields, refuses cuts inside records, and validates the
whole candidate before replacing a running world.

Independent source review checked field ordering, command tags, historical
padding, raw profile bounds and the offline preview converter. The converter
has no normal-loader fallback. It independently computes the exact one-time
published affinity draws and generator advancement, then requires equality of
all other retained source fields after skill initialization.

A fresh review challenged the failing busy-table fixture after three failures.
The fixture replaced an autonomous guest target without releasing its previous
reservation. CancelIntents intentionally retains autonomous ordinary activity.
The corrected helper calls the existing reservation release before replacing
the activity. The test starts a real Sit with a bounded duration in test-only
content, requires the cook's live target at both guests' first meal claims,
requires both guests to perform standing work, and saves at observed standing
work. Original and restored worlds advance with equal hashes. Both worlds use
the same test content; production durations remain unchanged.

The passing diagnostic records guest allocations at ticks 500 and 592, with
the cook's valid Sit still active. Their 92-tick separation explains the need
for explicit fixture occupancy beyond the shipped 62-tick duration. Diagnostic
prints were removed before final workspace verification.

The latest main queue update retains generic chain orders until completion.
Integration now distinguishes those orders from an active scoped cleanup or
chore. Waiting orders preserve the current movement and work; First requests
validate before cancellation. Completion settles only the order that owns the
work, and queue display preserves other pending orders. New regressions cover
pile and surface scopes followed by generic orders, duplicate generic orders
behind a First pile cleanup, repeat collection with a queued surface, stale
First requests and a First floor chore interrupting a generic cleanup. Save/load
continuation hashes match. Final independent review found no remaining blocker.

## Browser and artwork evidence

The integrated game ran on an isolated localhost port, separate from the
owner's preview storage. `chores-panel.png` shows checked automatic assignments,
room-wide duties and disabled Do now controls for clean areas. Independent
visual review found readable controls and no obvious clipping or overlap.
`retained-likes-and-dislikes.png` confirms the published panel and mood causes
remain available. The normal household advanced 40 ticks: Hunger fell from
62 to 59.5, Energy from 100 to 98, Hygiene to 97.1 and Bladder to 95.9.
The browser reported no warnings or errors. The test page closed in a finally
block and its verification server stopped.

Cleaning pixels and rig inputs did not change during this integration. The
accepted mop grip, cotton strands, eyes, cloth wiping and bin motion are covered
by [the cleaning appearance evidence](../2026-10-05-cleaning-appearance/README.md).
That record includes played motion and independent review of the reported
visual defects. The new panel capture provides no additional animation proof.
The staged Git blobs for accepted cleaning producers match their receipts;
explicit byte-preserving attributes prevent newline conversion from breaking
those hashes on a clean checkout.

## Preview conversion

The owner's known unpublished preview was backed up separately before format
integration. The original is 5053 bytes. Explicit conversion produces 5255
bytes, retains tick 49577, and yields world hash 11064684446028606279 after the
published skill and affinity migrations. The original bytes remain unchanged.
`preview-migration-receipt.json` records checksums without publishing private
save bytes. The private-source test saves again and compares 240 continuation
ticks against direct semantic adoption.

The twelve animation fixtures were recovered from original checkpoint
`14b1d3fc` and passed through the same explicit converter. Their checksums are
in `fixture-migration.json`. Normal published saves continue through the normal
loader.

Browser restoration of the owner's slot remains pending. Browser security
rejected access while the original tab showed a connection-error page. A reload
request was sent to the owner; no alternate browser or raw debugging route was
used to bypass that rejection. The backed-up files remain outside Git.

## Verification commands

Logs retain their captured content. The full web run hit four artwork-file timeouts; its isolated rerun passed without changing assertions or repository timeout settings.

| Command | Result | Evidence |
| --- | --- | --- |
| `cargo test --workspace -j1 -- --test-threads=1` | PASS: 1744 tests, exit 0 | `native-release.log` |
| `cargo fmt --all --check` | PASS | `format-release.log` |
| `cargo clippy --workspace --all-targets -- -D warnings` | PASS | `clippy-release.log` |
| `cargo test -p terri-wasm -j1 -- --test-threads=1` | PASS: 204 boundary tests and 4 converter tests | `wasm-native-final.log` |
| `cargo test -p terri-wasm --example migrate_chores_preview -- --ignored --test-threads=1` with process-local `TERRI_PRIVATE_PREVIEW_SAVE` | PASS: supplied private source | `private-migration-final.log` |
| `cargo run -p terri-wasm --example migrate_chores_preview -- INPUT.sav OUTPUT.sav` | PASS: validated conversion | `migration-final.log` |
| `wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm` | PASS | `wasm-build-release.log` |
| `npm --prefix web run typecheck` | PASS | `typecheck-release.log` |
| `npm --prefix web test -- --maxWorkers=1` | 2113 PASS; 4 artwork checks hit the 5-second limit, exit 1 | `web-tests-release.log` |
| `npm --prefix web test -- --maxWorkers=1 tests/atlas.test.ts --testTimeout=30000` | PASS: all 14 tests in the affected file, exit 0 | `atlas-release.log` |
| `npm --prefix web run build` | PASS | `web-build-release.log` |
| `node --test scripts/build-changelog.test.mjs` | PASS: 12 tests | `changelog-tests-release.log` |
| `node scripts/build-changelog.mjs` | PASS | `changelog-build-release.log` |
| `python check-doc-ids.py` | PASS | `doc-ids.log` |

The asset sequence passed 327 tests and both atlas checks. Each command used
`python -B -m unittest discover -s DIRECTORY -p 'test_*.py'`, in this order:
`assets/sprites/gen`, `assets/models/sims/sim-01`, `assets/models/furniture`,
`assets/models/kitchen`, `assets/models/bathroom`, `assets/models/bedroom` and
`assets/models/office`. `python assets/sprites/gen/build.py --check` confirmed
both atlases remain reproducible. The complete output is `assets-tests.log`.
Existing Pillow deprecation notices and the production bundle-size notice do
not fail their checks.

Earlier scope, persistence, repeat-collection and grime regression mutations
are recorded in the preceding targeted-cleanup and grime evidence. Those
checks deliberately removed guards, observed failures and restored the source.
Local focused mutation evidence does not establish completion of the full
remote mutation sweep. Remote checks and automatic publication are reported
separately at delivery; pending work is not marked passed.
