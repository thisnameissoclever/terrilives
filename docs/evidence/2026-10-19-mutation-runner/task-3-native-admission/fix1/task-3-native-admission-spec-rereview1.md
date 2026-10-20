# Native admission scoped spec re-review

Approved for the first push and actual qualification from this scoped spec review. The original P2 is closed. No remaining or new actionable defect was found in the forecast repair, its evidence recomputation, or its regression controls. This approval does not establish Linux qualification, actual native capacity, or merge readiness.

## Frozen identity

1. Original package: `db36c9dbfd0961cd4e566e7aadad5d0bda473d6d1117cde53bedc21a518df60d`.
2. Fix package: `771438246d6d05811c471551dc5dfeb3fa517b30774db9b860b8e1e368be7d1c`.
3. `.github/scripts/mutation_native.py`: `36883f5b43bf792c0f2049b4a21131e9a4b67ac6574220486ced62890e2d4ad9`.
4. `.github/scripts/test_mutation_native.py`: `33049978c7c357c60f82577b020821c9b36d7f43c83cbe28d0dd63ad31eb3d29`.
5. `docs/mutation-campaign.md`: `17ee965621c232cd6c56b7b3b987b81bf71082f0170d80594dee1f4d7ef840e2`.

Verified all three current file hashes and their original before hashes. The other ten original source hashes remain unchanged. All nine original evidence hashes and all ten fix evidence hashes match their respective manifests, including the exact package hash above. The three refreshed API evidence files have the same hashes as their original counterparts; the retained wrapper maximum remains 513 calls.

## Closure and bounded verification

1. `capped_campaign_projection` now computes throughput after one fully capped baseline, measured setup and the fixed shutdown/validation/upload reserves. It charges that baseline, setup, reserves and the declared queue allowance for every required wave. The fit flag compares the maximum complete slot projection with the remaining lifetime. The useful mutation-only subtotal remains separate.
2. The original 100-identities-per-slot case now has eight capped mutations per wave, 13 waves, and `72000 + 13 * (720 + 2 + 390 + 1800) = 109856` seconds. Its 80,000-second fit is false. The repair uses the capped 720-second baseline, which is appropriately more conservative than the measured two-second baseline in my original demonstration.
3. `validate_pilot` recomputes the projection from original caps, validated full slot counts, declared measurements and frozen reserves. It compares the complete projection object, fit flag and mutation subtotal. The finished report and admission therefore cannot silently retain the old subtotal-only fit verdict.
4. The new test control restores the exact old subtotal-only expression in a disposable helper. It requires the positive case to remain passing and the original regression to produce exactly one ordinary assertion failure, without import, syntax or runtime errors. The regression also proves that an unfavorable pessimistic projection leaves the independent sample envelope available. The changed guide accurately explains this decision boundary.
5. Independently executed a bounded Python/API-fixture probe against the current helper. It passed the original 80,000-second nonfit, 200,000-second positive fit, exact 109,856-second fit and 109,855-second nonfit. Unequal counts `[0,1,8,9,100,0,100,1]` produced waves `[0,1,1,2,13,0,13,1]` and expected slot durations. A zero-throughput case retained zero work for empty slots, null projections for nonempty slots, false fit and valid JSON with `allow_nan=False`. Separately changing each of the complete projection, fit flag and mutation subtotal caused `validate_pilot` to refuse. The untouched authenticated fixture passed. Probe exit 0, about half a second.
6. Inspected the hash-verified evidence for five focused tests passing in 6.395 seconds and all 36 native/qualification tests passing in 138.525 seconds. Those are retained implementation results, not suites rerun by this review. The unchanged broad review and full suite were not repeated.

Only this ignored re-review report was authored. No source, test, dependency, Git state, browser state or workflow was changed. The probe used disposable fixtures and performed no native build or external request.

Real Linux fixture interruption/resume, full native sizing, measured native cost/cleanup/uploads, the owner's explicit admission decision and exhaustive production coverage remain external gates. No source or recipe edit may occur between qualification and admission without fresh contract proof.

**Next steps**: Root can proceed with the first push and actual qualification under the existing delivery authority. No answer is needed from the owner for this scoped review.
