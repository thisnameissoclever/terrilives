# Media and neutral-seat integration handoff

Work only in `D:/VIBES/.worktrees/terrilives/bike-chair-four-facings`, branch
`twcx/media-seated-actions`, based on main
`e56028e573be2a7bdfa7269b9ea2a2ee1cb7e7dd`. Canonical checkout is forbidden.
Preserve output and .tmp. No paid providers, dependencies or unrelated edits.

## User request and authority

Add fish idle motion and missing bathing, showering, toilet, sitting, television
and radio animations. Media viewers prefer a reachable available seat within
a seven-tile, 90-degree forward cone, standing fallback otherwise. Owner
authorized autonomous implementation, review, commit, push, merge and live
publication without another approval round. All publication remains root-owned.

Fish PR212 is merged and live. Both exact main CI37323174998 and actual Pages
deploy37324578673 passed. All seventeen public texture pages match reviewed
bytes, and ordinary public play showed all eight samples. This is complete;
do not redo it. Main has 2515 base sprite records. All prior2483 were unchanged.

## Current native implementation

Uncommitted root edits create `seating.rs`, `media.rs`, seating tests and exact
distance-field tests; modify action selection, bed occupancy, reservation
release, dining claim filtering/restore, privacy occupancy, save architecture
contact validation and render projection. Existing SavedDining.diners wire
layout is reused honestly as physical leases; no save fields were added.
Classify exact television/watch_tv and radio/listen, not activity metadata.
Target remains device; physical target in render buffer is seat. All six seat
types now plan. Symmetric ottoman facing is chosen toward the device.

Thirteen native media tests pass, including directed/autonomous planning,
cone/radius/facing boundaries, six seat types, save round trips, cancellation,
interrupted meal protection and invalid-seat reselection. `media::maintain`
runs with career start in a nested chain to stay within Bevy's tuple limit;
also runs after paused commands. Invalid position interrupts and restarts
the ordinary use after arrival at another available seat/standing point.
Latest strict native Clippy passed. Earlier full terri-sim run917 passed before
maintenance and extra seat types; full current suite must still run.

Known remaining native checks: mixed dining/media contention, same-tick claims,
forged claims, move/sale refusal, standing promotion when a seat frees,
completion/death/work/replacement release, privacy substitute route integration
and original-save byte equality. Evaluate and fix real gaps; preserve exact
commitment ownership and existing random-draw ordering on unchanged flows.

## Source authoring and exporter

Root-created `assets/models/seating/{pose_profiles,neutral_pose,neutral_contact,
render_neutral_seats}.py` and tests are complete. Six measured seat profiles
preserve approved standing rig and immutable furniture. New five-type batch
`review/batch-01/proof.json` complete,960 raw renders,60 contact samples,
five editable models. Raw SHA2f8b9294237f254b7b12050186d36f9bd62cb4779ec506e6dbc57abf761ac41a.
Office/sofa fit through anatomical knee-first construction plus8.2023degree
toe-down articulation; soles remain0.019148 above floor, not flat contact.
All17 bone lengths preserved; all body/furniture collision checks pass.
No source job is running.

Worker `neutral_seat_export` completed six assigned export/import files.
Separate body-ink `review/ink-01` complete80 renders and exact ottoman symmetry.
Accepted-format candidate `export/neutral-02/manifest.json`, SHA
7dd543febdab4d05a2a3a235a1d58ca4583d2033a04464172d39b34e5bea8170.
All240 scene comparisons pass max6/p952 (actualmax5/p952), current scene-linear
premultiplied additive encoding unchanged. Original neutral-01 remains a
failed diagnostic, no manifest, do not import it.

Reference correction: independently float-filter original full-scene beauty
and apply display transfer once. Do not quantize reference through production
8-bit linear encoding. Literal dark-colour tests prove old reference error.
Companded storage was tested but is not needed or authorized.

`offline_seating.load_neutral_seats(manifest_path)`, `records(export)`, and
`tables(export,sprites)` are implemented. Tables return anchors,tops,bounds,
density,profiles,layers,coverage,masks.540 records:300 texture layers plus240
scene aliases sharing furniture images.20 empty-facing action8 profiles.
layers=[furniture,body,-1,ink]. Masks body/furniture/ink/bodyInk use
EncodedCoverage. Ottomans have optional facingFrames native1..4.

Task report and independent review packet:
`.superpowers/sdd/2026-10-05-neutral-seat-export/task-1-report.md`,
`task-1-brief.md`, `task-1-final-review.diff`. Reviewer
`neutral_seat_export_review` is running, read-only. Root will handle findings.
Do not edit worker files without resolving ownership with root.

## Root web changes and remaining integration

InteractionSelection now accepts fourth action-specific catalogue, preserves
old legacy fallback and supports optional facingFrames with facings columns.
Eight tests and typecheck pass. `visible-scene-layers.ts` extracts low-level
pack helper; bed-sprites reexports it as packBedLayers for compatibility.
Eleven helper/bed tests pass. No generated atlas integration yet.

Integrate separate SEATING_SPRITES, SEATING_LAYERS, SEATING_COVERAGE and
SEATING_MASKS tables. Preserve INTERACTION_SPRITES, BED_LAYERS and all old
records. Reuse low-level binding9 additive scene math with merged visible
layer maps; do not force chairs into bed gameplay. Exclude scene aliases from
packing and bind their physical placement/page to furniture layer.
Input picking needs scene alpha=body+furniture+ink (fills already attenuated),
and correct visible body/bodyInk versus furniture ownership. Both target and
body rows must use new scene alias for coverage. Preserve old pair formulas.
Add native pending-mask alias and actual draw/picking regressions before wiring.

Atlas generator appends after all2515 existing records. Architecture's
historicalCount2445 and old extension digests stay frozen; append new reviewed
neutral-seating extension with canonical manifest hash, strict loader.
Add receipt/source/export JSON -text attributes for exact hashes. Preserve
all published decoded pixels, anchors and existing action tables.

## Delivery boundary

This media batch is not committed, pushed, merged or live. No browser tabs or
preview servers are open. No current main changes beyond e560 known; fetch
before delivery. Root owns changelog, coherent staging, commit/push/merge and
live proof. Current day entry `docs/changelog/2026-10-05-covered-bunks.md` already
includes bunk and fish notes; extend it truthfully when media is complete.
Run fresh WASM, current full native/web/asset suites, Clippy,fmt,typecheck,build,
docIDs,changelog, staged-only export and preservation checks. Use dedicated
owned browser contexts; screenshots absolute C:/Users/myema/.codex/tmp/playwright-mcp/
then copy here. Close contexts in finally and stop own server.

Bathroom poses remain entirely unimplemented and are a subsequent batch.
Do not claim the user's full request complete from media delivery.
