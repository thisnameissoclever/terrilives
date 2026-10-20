# Native admission fix 1 quality re-review

Approved for first push and actual Linux qualification. The confirmed P2 is corrected, and this scoped review found no new actionable defect. My original review missed the misleading pessimistic fit verdict; this report supersedes that part of its assessment.

Reviewed the spec finding, fix report, three-file patch, changed tests, consuming documentation, and frozen evidence. Fix package SHA-256: `771438246d6d05811c471551dc5dfeb3fa517b30774db9b860b8e1e368be7d1c`. All three updated source hashes and lengths match the fix manifest. Their before hashes match the original frozen package. The other ten original source files, all nine original evidence files, and all ten fix evidence files match their declared hashes.

1. `capped_campaign_projection` includes the original build/test cap sum for every mutation and repeated baseline, measured setup, all three reserves, and the declared queue allowance. Throughput is calculated after reserving baseline/setup/reserves within 7,200 seconds. Per-slot wave counts and durations include the last partial wave. The fit verdict uses the slowest complete slot projection rather than the mutation subtotal.
2. The reported 100-identities-per-slot case now has eight capped mutations per wave, 13 waves, and 109,856 seconds per slot. That is 72,000 mutation seconds plus 13 times 2,912 seconds of repeated overhead. It correctly fails the 80,000-second comparison and passes the 200,000-second comparison. Zero throughput gives explicit nonfit and null projections for nonempty slots; strict JSON serialization succeeds.
3. Finished-evidence validation independently recomputes the projection from the original caps, verified slot counts, measured setup and declared remaining lifetime. The new regression and isolated subtotal-only fault control address the original false-fit defect directly. The documentation matches this calculation and preserves the conditional setup/queue assumptions.
4. This remains reporting evidence for the external spending decision. The repair adds no automatic rejection for pessimistic nonfit and changes no sample-based admission condition, finite history ceiling, coverage rule, original lifetime, cap, process controller, workflow dependency, authentication boundary, or API request path.

I independently exercised the pure helper with six bounded cases: 80,000-second nonfit; 200,000-second fit; exact 109,856-second fit; rejection at 109,855.999 seconds; uneven and empty slot counts with partial final waves; and zero throughput with strict JSON null serialization. All passed. These checks made no network calls, native builds, Git operations, browser actions, or source edits.

The hash-verified supplied outputs retain five focused passing tests in 6.395 seconds and 36 native/qualification passing tests in 138.525 seconds. I did not repeat those suites. The unchanged API counters remain supplied fixture evidence, with a maximum of 513 requests, rather than observed GitHub usage.

Frozen updated sources:

| Path | SHA-256 |
| --- | --- |
| `.github/scripts/mutation_native.py` | `36883f5b43bf792c0f2049b4a21131e9a4b67ac6574220486ced62890e2d4ad9` |
| `.github/scripts/test_mutation_native.py` | `33049978c7c357c60f82577b020821c9b36d7f43c83cbe28d0dd63ad31eb3d29` |
| `docs/mutation-campaign.md` | `17ee965621c232cd6c56b7b3b987b81bf71082f0170d80594dee1f4d7ef840e2` |

Actual Linux interruption/resume, full native inventory sizing, caught-control execution, cleanup/upload timings, hosted runtime and numeric rerun behavior remain pending. This review supplies no production admission, exhaustive coverage, merge or live-delivery proof. Only this ignored re-review report was written; no process remains running.

**Next steps**: Root can combine the scoped re-reviews and proceed with first push and actual Linux qualification. No user answer is needed for this review.
