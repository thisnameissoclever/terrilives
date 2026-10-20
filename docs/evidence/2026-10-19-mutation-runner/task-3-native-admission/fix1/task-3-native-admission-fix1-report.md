# Native admission fix wave 1 report

The confirmed P2 is repaired. The previous fit verdict used only mutation phase time; it could tell the owner a campaign fit while omitting every repeated baseline, setup, reserve and queue allowance. The mutation subtotal remains available, and the verdict now uses a separate complete capped campaign projection.

## Frozen scope

1. This patch is against original frozen package `db36c9dbfd0961cd4e566e7aadad5d0bda473d6d1117cde53bedc21a518df60d`, not a replacement for it. The three saved before-file hashes match that package. All ten other original source hashes remain unchanged.
2. Changed files are only `.github/scripts/mutation_native.py`, `.github/scripts/test_mutation_native.py` and the consuming explanation in `docs/mutation-campaign.md`. Impact search found no other consumers of the pessimistic fields. The existing finished report copies the forecast; its validator now also recomputes the complete capped projection from original caps and declared measurements.
3. No runner/model/artifact interface, sample-admission condition, timeout, history ceiling, original lifetime, coverage rule, workflow job, permission or dependency changed. The new internal `capped_campaign_projection(counts, settings, calibration, setup, remaining)` helper serves only forecast generation and finished-evidence validation. Root owns the index and Git; no Git operation was performed.
4. Original reports, packages, hashes, test outputs and both independent reviews remain intact. The original nine evidence-file hashes were rechecked unchanged. Root owns the lesson update and all application/delivery work.

## Corrected computation

For each slot, let C be the original build cap plus original test cap. Every baseline also uses C in this all-at-caps projection. Setup is the same measured clone plus initial-setup allowance used by the sample forecast. The three frozen reserves remain 30/120/240 seconds, and queue allowance remains 1,800 seconds per wave.

```text
capped mutations/wave = max(0, floor((7200 - C - setup - reserves) / C))
slot waves = ceil(slot mutation count / capped mutations per wave)
slot wall seconds = slot mutation count * C
                  + slot waves * (C + setup + reserves + queue)
fit = maximum complete slot projection <= original remaining lifetime
```

If throughput is zero, nonempty slots have null wave/duration projections and an explicit `baseline_and_capped_mutation_do_not_fit` reason. The fit is false. Empty slots need zero waves and zero duration. No division by zero or Infinity is emitted. JSON is exercised with `allow_nan=False`.

The new `pessimistic_capped_campaign` object reports caps, each repeated allowance, throughput, per-slot waves/durations, maximum duration, fit, reason and assumptions. `pessimistic_mutation_cap_seconds_per_slot` remains the useful mutation-only subtotal. `pessimistic_cap_bound_fits_remaining` now takes the complete projection's result. The report explicitly says external setup and queue delays can exceed the declared allowances and `is_guarantee` remains false. An unfavorable pessimistic result remains spending-decision evidence; it does not become a new automatic admission gate.

## Reproduction and regression results

| Case | Mutation subtotal per slot | Capped throughput | Waves per slot | Complete projection | Fit |
| --- | ---: | ---: | ---: | ---: | --- |
| Review case: 100 identities per slot, 80,000 seconds remaining | 72,000 | 8 | 13 | 109,856 | false |
| Same work, 200,000 seconds remaining | 72,000 | 8 | 13 | 109,856 | true |
| Test cap 3,600 seconds, baseline plus one capped mutation cannot fit | 420,000 | 0 | null | null | false |

The review's final demonstration used its two-second measured baseline and therefore nine capped mutations per wave. The repair deliberately uses the 720-second baseline phase-cap total, yielding eight per wave and 13 waves. Repeated overhead is 2,912 seconds per wave: baseline 720, setup 2, reserves 390 and queue 1,800. Thus 72,000 + 13 * 2,912 = 109,856 seconds. The separate sample envelope remains 45,000 seconds in these bounded fixtures and is not rejected by the pessimistic reporting result.

`task-3-native-admission-fix1-projections.json` retains actual bounded fixture outputs, including the observed remaining time. These are synthetic reporting/contract cases, not game execution or Linux capacity measurements.

1. Before implementation, the review regression failed with the intended ordinary assertion, `True is not false`. Exact output: `task-3-native-admission-fix1-red.txt`.
2. Five focused tests passed in 6.395 seconds. They cover false fit, positive fit, no-one-capped-mutation/null JSON, finished-evidence recomputation and the isolated fault control. Output: `task-3-native-admission-fix1-focused-tests.txt`.
3. The isolated control restores the old mutation-subtotal-only fit expression in a temporary helper copy. The positive-fit case still passes and the false-fit case produces exactly one ordinary assertion failure, with no syntax, import or runtime error. Production source bytes are checked unchanged afterward.
4. All 36 native and qualification tests passed in 138.525 seconds, exit 0. Output: `task-3-native-admission-fix1-covering-tests.txt`. This includes native process/authentication/history/transport controls and the complete production API wrapper fixtures. Unchanged application, runner and original full suites were not repeated.
5. `python check-doc-ids.py` passed: documentation IDs are unique and allocation-free.

Commands, with `.github/scripts` on PYTHONPATH:

```text
python -B -m unittest test_mutation_native.NativeCappedForecastTests
python -B -m unittest test_mutation_native test_mutation_qualification
python check-doc-ids.py
```

## Request capacity and remaining gates

The newly retained API JSON is exactly equal to the original measured counters. Production preparation/eight workers/aggregate remain 171/175/177 requests at 10/30/50 historical attempts. The bounded eight-run, three-gap, sixteen-page case with both external evidence sources remains 513. Original planning remains 56; pilot/report/review-required remain 63/20/31; later admission remains 36; initial preparation without a production snapshot remains 79. No new REST request was added. The three refreshed files use the `task-3-native-admission-fix1-` prefix, leaving original evidence untouched.

Real Linux fixture interruption/resume, complete native sizing, actual native costs/cleanup/uploads, the owner's explicit report decision and exhaustive mutation coverage remain pending external gates. This reporting repair does not supply any of them. No native build, browser, push or dispatch occurred.

## Scoped package and hashes

Package: `task-3-native-admission-fix1-package.diff`.
SHA-256: `771438246d6d05811c471551dc5dfeb3fa517b30774db9b860b8e1e368be7d1c`.
Exact before/after hashes: `task-3-native-admission-fix1-hashes.json`.

| Path | SHA-256 |
| --- | --- |
| `.github/scripts/mutation_native.py` | `36883f5b43bf792c0f2049b4a21131e9a4b67ac6574220486ced62890e2d4ad9` |
| `.github/scripts/test_mutation_native.py` | `33049978c7c357c60f82577b020821c9b36d7f43c83cbe28d0dd63ad31eb3d29` |
| `docs/mutation-campaign.md` | `17ee965621c232cd6c56b7b3b987b81bf71082f0170d80594dee1f4d7ef840e2` |

The three source/test/doc files are frozen. Ownership is released; no process remains running from this fix wave.

**Next steps**: Root obtains the scoped independent re-review before first push. No owner answer is pending.
