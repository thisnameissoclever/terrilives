# Whole-branch review: packed instance count

Reviewed base `d6dce671fc9b1c729fa4ca35bddcc4171ee9637f` through head `112e9d2140ced628f11de1eb9eb3db2ed6aac129`. Ready to merge. No Critical, Important or Minor findings identified.

## Scope and evidence

Read the complete packaged branch diff, requirements, implementation plan, verification document, worker report and progress ledger. Inspected the packer, all appended-row writers, legacy counter/wrapper, production consumer, GPU upload length, wall-fade update and floor-controls method. Checked the repository instructions and relevant testing, live-prefix, stride and preview lessons. This was a read-only source review; this report is the sole permitted write. No suites were rerun, browsers controlled, source changed or Git state changed. The existing untracked `web/output/` was left alone.

HEAD matches the requested revision. The current main.ts SHA-256 matches the final verification record: `f0873bfdb5bcab51bb37f7bb9b8cf2ef0cb3a438be26754924115da419b2c83f`. The actual changed-file inventory contains no Rust, WASM source, dependency, saved-state, art or sound implementation changes. The image additions are review evidence, not game assets. Shipped door changes are already in the review baseline.

## Strengths

1. `web/src/frame.ts:930` introduces one module-owned batch with a read-only public shape. Growth updates its array pointer at line 978; every completed build publishes the final written slot at line 1275. Shrinking and empty frames cannot inherit a previous count. The new code creates no per-frame result, tuple or argument array and performs no trailing-buffer clearing.
2. `web/src/frame.ts:1095` starts appended rows after all fixed entity slots, including parked hidden rows. Portal, foreground, indicator, carried-prop, selection and placement writers advance the same slot. Capturing the final tile-highlight writer's return at line 1274 closes the concrete omission without reconstructing a second count. Existing suppression and selection rules remain unchanged.
3. `web/src/frame.ts:1280` preserves the explicit legacy signature and all defaults. Its forwarding call retains every parameter, including interaction selection, motion, tick, lighting, colourway and sky. The legacy counter remains available with unchanged behavior.
4. `web/src/main.ts:1565` retains the original packing argument list, including floor highlights. Drawing uses the borrowed array and count at lines 1592-1593. Neither ambient calculation nor the inspected wall-fade update rebuilds the batch. `web/src/render/sprites.ts:500` uploads only `count * FLOATS_PER_INSTANCE`, so stale capacity stays outside the GPU input. No renderer interface or row layout changed.
5. `web/src/main.ts:630` brings floor instructions into the existing viewport-change listener. The initial compact-state assignment still exists. There is no asynchronous suspension between listener registration and floor-control initialization; the added reference does not introduce an initialization race. The existing method changes only the two help elements' visibility.
6. The production regression executes the actual main packing/draw statements and asserts independent uploaded rows, parameters and absence of recounting. Batch tests cover borrowed identity, growth, shrink, empty frames, legacy invalidation and real interaction selection. Documentation distinguishes structural work removed from unmeasured timing or audio-memory claims.

## Issues

### Critical

None.

### Important

None.

### Minor

None.

## Testing assessment

The worker records a pre-implementation production-boundary failure (`expected 0 to be 2`), subsequent success, a passing 116-file / 1,721-test web suite, typecheck, production build, documentation IDs and whitespace checks. The first full-suite failures were stale duplicate-wiring expectations; their corrections preserve the intended single production call. Integration checks and the later 4-file / 60-test viewport-focused pass are documented separately. I relied on those records rather than rerunning passing suites. The full suite was not rerun after the one-line viewport callback.

Specific mutations for the changed invariant tests:

1. Combined writer rows: omit the final highlight-slot assignment; the exact count changes from 14 to 12 and the row assertion fails. Removing portal, foreground, prop or selection writes also changes the independent expected sequence.
2. Reuse/growth/shrink/empty/legacy contract: omit pointer publication, omit count publication or return a new result object. The recorded mutation runs fail the pointer, count or identity assertions. Removing wrapper delegation also breaks the observed count reset after its empty build.
3. Both valid and refused nonoverlapping move cases: restore overlap-only replacement, stop hiding the original, or continue suppressing it for an empty preview. Exact rows, count or screen-coordinate assertions fail.
4. Paired interaction and argument forwarding: remove `updateSource`, force tick zero or force reduced motion. The real selected animation frame and exact update-call assertions fail. Omitting the legacy highlight argument changes the expected four rows.
5. Highlight-only and dinner cases: omit the final-highlight slot update or keep a stale count on empty input. The independent count assertions fail. Drawing a snack in addition to carried dinner violates the three-row expected sequence.
6. Actual main boundary: restore the old recount; the recorded production mutation fails with zero instead of two uploaded rows. Removing floor highlighting or changing camera, tick, motion or sky forwarding fails the independent row/argument checks.
7. Buy and room wiring expectations: restore the duplicate preview/highlight argument list; the adjusted occurrence assertions fail. The production-boundary test supplies behavioral coverage beyond those source-string assertions.

Five required production mutations have recorded assertion failures and restoration hashes. The other mutations above identify what each test guards; they are not claimed as additional executed mutation runs. The floor callback has before/after played evidence: missing callback left keyboard help on the narrow viewport; the corrected build switched desktop to phone and back. Batch tests were authored after implementation, a disclosed process deviation accepted in the ledger, not fabricated test-first evidence.

I independently viewed `packed-floor-desktop.png` and `help-mobile.png`: the former shows the cyan selected-tile marker; the latter shows readable touch instructions and reachable floor controls. GPU counts, move/Cancel save comparisons and the complete resize sequence remain attributed to root's recorded played run. Its rejected stale mobile save baseline is explicitly excluded from acceptance evidence.

## Recommendations

No code changes required before merge. Keep remote CI and the full remote mutation sweep separate from the local evidence above; neither is certified by this review. The writing skills informed the report's wording and preservation of evidence limits, not changes to product copy.

## Declined to judge

1. Audio-memory holds on PR 184 and PR 178: neither implementation is in this branch; removing renderer work cannot establish their memory safety.
2. Subjective door-audio quality or physical-speaker acceptance: sound implementation is unchanged relative to the baseline, and this review contains no listening session.
3. A measured frame-time improvement, allocation profile or 120Hz performance: source inspection establishes removal of duplicate work, not timing or profiling results.
4. Full world/object visual acceptance and standing sleep poses: this slice changes the live instance count and floor help; retained screenshots cannot establish a complete gameplay or animation acceptance pass.
5. Physical mobile-device behavior and every browser/GPU combination: the recorded viewport and reduced-motion checks are Chromium evidence, not device-fleet coverage.
6. Remote CI, full remote mutation results and deployed renderer behavior: delivery is still root-owned and no completed external result is part of this review.
7. Safety of consumers retaining a batch across another build: the API explicitly exposes borrowed storage, and production consumes it synchronously. An owned-snapshot API is not introduced or promised.

## Assessment

**Ready to merge? Yes.** The branch fixes the missing floor-highlight draw rows at the producer/consumer boundary, preserves the old APIs and current presentation rules, and adds focused regression and played evidence. No in-scope defect or unmet reasonable-user expectation was found. This verdict does not clear the declined acceptance boundaries above.

**Next steps**: Root can complete the authorized delivery and report remote checks and deployment separately; no additional user decision is required by this review.
