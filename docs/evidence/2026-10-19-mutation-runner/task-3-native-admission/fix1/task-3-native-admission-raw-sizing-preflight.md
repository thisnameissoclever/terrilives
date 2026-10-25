# Raw artifact sizing preflight

The concern is real, with two distinct parts. The per-member projection is a mismatch between separate files and one accumulated member. The whole-slot archive scope is deliberately conservative and remains a possible single-attempt workload under the current runner. A sample-based estimate of records per wave cannot safely replace that scope without an enforced production bound.

This is a separate false-refusal concern, not a reopening of the corrected capped forecast or evidence of unsafe admission. I recommend resolving the raw projection and execution-envelope relationship before the first push intended to qualify native admission. The reviewed implementation may correctly refuse a campaign whose actual evidence cannot fit; it should not present a sum of separate logs as the size of one archive member.

## Concrete mismatch

1. `.github/scripts/mutation_native.py:492-495` selects the largest file across all diagnostic files without distinguishing per-mutant logs, baseline logs, diffs, process output, or aggregate reports. It multiplies that file size by every identity in the largest slot and compares the product against the 32 MiB member bound. It separately multiplies the same product by four for archive size. The twenty-percent headroom check at line 497 makes these projections mandatory admission conditions.
2. `.github/scripts/mutation_runner.py:631-660` retains `raw/outcomes.json` as one aggregate member and copies each referenced baseline/mutant log and diff to its own `evidence/...` member. The complete immutable manifest is retained in `bundle.json`. Execution also retains a process log and a separate post-shutdown diagnostic outcomes file. Each member has its own size; archive expanded size is their sum. `.github/scripts/mutation_artifacts.py:49-69` enforces those distinct limits. A large per-mutant log is not concatenated with every other mutant log into one member.
3. Aggregate outcomes and process output can grow with the number of executed records. They need their own measured projection. Conversely, multiplying an already multi-record diagnostic outcomes file by all slot identities can multiply its embedded sample cardinality again. Treating every file class as the same scalar maximum hides both distinctions.

## Independent bounded reproduction

I used the existing synthetic `NativeFixture` with an 800-identity complete manifest, then built one full 100-identity slot result with a successful baseline, unique per-mutant log/diff paths, 300,000-byte baseline and mutant logs, and tiny separate diffs. I retained the compact complete bundle, frozen raw outcomes, post-shutdown diagnostic outcomes and process log. The artifact was passed through the actual `artifacts.unpack` and `artifacts.validate_bundle` functions without relaxing any bound.

| Measurement | Observed synthetic bytes/count |
| --- | ---: |
| Completed records | 100 |
| Archive members | 205 |
| Largest actual member, the complete bundle | 813,926 bytes |
| Total expanded archive | 31,298,522 bytes |
| Compressed ZIP | 174,937 bytes |
| Projected member from the current scalar log calculation | 30,000,000 bytes |
| Projected raw archive subtotal before bundle overhead | 120,000,000 bytes |

Every actual member and the actual expanded archive fit below eighty percent of their unchanged limits. The actual artifact validators accepted all 100 records. Calling `sizing_probe` with the same 300,000-byte per-mutant log shape rejected it with `native sizing lacks twenty percent headroom inside unchanged raw/snapshot bounds`. This demonstrates a false refusal even when the entire synthetic slot fits in one raw artifact. It does not depend on splitting that slot across attempts.

This fixture tests schema, layout and projection arithmetic. It does not claim that a native process generated the bytes, that a real producer was authenticated, or that any production mutation was executed. The fixture used repeated text, so its compression ratio is not native evidence. Expanded bytes and individual member sizes also fit, independently of compression.

I independently verified that the retained historical `profile-measurement/workspace-opt2-test.stdout.log` is 245,038 bytes. It remains historical source evidence, not a prediction of new Linux log sizes. With a hypothetical 2,318 identities in a slot, the current member formula permits a maximum scalar sample of only 11,580.4769 bytes before headroom failure. Substituting 245,038 bytes hypothetically yields a 567,998,084-byte projected member and a 2,271,992,336-byte fourfold raw subtotal. These calculations demonstrate sensitivity; they do not establish inevitable failure of the future native run.

## Scope of a correct repair

1. Correct the raw member model by distinguishing the complete bundle, aggregate outcomes, process output, baseline log, per-mutant logs and diffs. Project the largest individual member and sum the actual member classes for archive size. Preserve full-manifest transport, original raw bytes, immutable identities and slots, and every existing size/member-count limit. Keep sample growth assumptions explicit and preserve non-fitting whole-slot projections as evidence.
2. Do not simply replace the slot count with sample-derived throughput. `.github/scripts/mutation_runner.py:769` selects every remaining identity. Its wall-time boundary can interrupt that invocation, but successful fast mutations can still complete the entire selection. Maximum phase durations provide no lower bound on runtime and therefore no hard upper bound on records completed before the deadline. The count-stop argument is explicitly fixture-only at lines 493-494 and 740-741; production passes only that fixture setting at line 812.
3. If corrected whole-slot archive sizing still does not fit, a narrower per-attempt projection requires a reviewed production execution bound. The existing exact-selection, report validation, immutable delta and recovery primitives can support a bounded ordered subset, but `execute_slot` currently exposes no such production seam. The fixture stop must remain fixture-only. A shorter deadline based on sampled speed does not solve this proof gap.
4. A bounded-subset implementation must also report slot completion truthfully. At lines 817-823, current execution changes the controller result only when global policy fails or slot coverage becomes complete. A fully executed subset would otherwise inherit the controller's `complete` state while other slot identities remain. Any newly introduced production batch limit must produce resumable incomplete progress in that case and recalculate repeated baseline/setup, finite attempts, and retained-history projections consistently. Root's fresh architecture reviewer owns the detailed route.

Actual raw runtime archive/member validation must remain authoritative. A projected fit is conditional on measured record/log shapes; it cannot justify dropping unexpected evidence, suppressing an oversized member, widening a cap, or importing diagnostic results as production coverage.

Reviewed current helper SHA-256: `36883f5b43bf792c0f2049b4a21131e9a4b67ac6574220486ced62890e2d4ad9`. Runner SHA-256: `d41f227ece1065b91faf8310c906d849872fe95f4664827b0d8877905aef6c4d`. Artifact validator SHA-256: `8584d4771decc7dd57cdab8b0198a33dfd35b0542cc5cfd4fdccc896c454aac6`. No source, index, dependency, workflow, browser or external service changed. Only this ignored report and disposable fixture scratch were used. No review process remains running.

**Next steps**: Root passes the concrete layout mismatch and enforced-bound requirement to the fresh architecture reviewer, then scopes any repair before actual Linux qualification. No owner answer is requested by this preflight.
