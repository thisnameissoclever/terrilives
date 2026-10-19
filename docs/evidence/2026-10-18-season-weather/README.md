# Seasonal grass and weather verification

Inspected on 2026-10-18 in the Windows desktop Chrome browser, from branch `twcx/season-weather` based on `2b15dcfea9b6a147eec87b11607118f3c3349e1d`. Captures use the actual game and WebGPU renderer. Desktop viewport is 1440 by 900; phone viewport is 390 by 844. Audio was disabled in the isolated verification page.

## Grass comparison

For matching grass captures, the presentation clock was fixed at noon and weather chances temporarily set to zero in the browser to isolate tint. The defective controls restore only the old seasonal look rows through an isolated browser response override. Repository source was not changed for those controls.

| Image | Condition | Visible finding |
| --- | --- | --- |
| [grass-a-autumn.png](grass-a-autumn.png) | Corrected Autumn | Muted yellow-green grass; three readable clock lines. |
| [grass-b-autumn.png](grass-b-autumn.png) | Previous Autumn | Whole lawn is tan/brown; rejected. |
| [grass-a-winter.png](grass-a-winter.png) | Previous Winter | Very pale mint ground resembling frost or snow; rejected. |
| [grass-b-winter.png](grass-b-winter.png) | Corrected Winter | Recognizably green grass with a restrained cool tint. |

A fresh reviewer received these filenames without the condition mapping. The reviewer rejected both defective treatments and accepted both corrected treatments. The implementing agent also inspected every listed image.

## Actual game time and weather

The Autumn event used production tuning and actual native simulation ticks, advanced in bounded batches to reach the event. It started at tick 20710.408 and ended at 20830.408. Falling lasts 15 game minutes and grounded lifetime is 120 game minutes. The game ran visibly at 1x for 4.5 seconds between the falling and grounded captures.

| Image | Visible finding |
| --- | --- |
| [autumn-falling.png](autumn-falling.png) | Sparse orange leaves outside; clock reads 09:21 and `Autumn: breezy`. |
| [autumn-grounded.png](autumn-grounded.png) | Red/orange leaves across green lawn; no visible indoor leaves; clock reads 10:07. |
| [autumn-expired.png](autumn-expired.png) | No colored leaves remain; clock reads 13:26 and `Autumn: mild`. |
| [winter-snow.png](winter-snow.png) | Small white flakes over exterior grass/path; green ground remains visible; clock reads 15:35 and `Winter: snowing`. |
| [phone-snow.png](phone-snow.png) | Three readable clock lines without clipping; a few flakes on the visible outdoor strip. Most of the yard is outside this phone crop. |
| [winter-mild.png](winter-mild.png) | Snow event has ended; grass remains green and the clock reads 17:05 and `Winter: mild`. |

The first shipped-seed winter happened to have no snow opportunity. To exercise snow promptly, the isolated browser's winter chance was temporarily set to 1; production remains 0.2. The snow capture still uses actual native day-22 ticks and the production renderer and event duration. The game ran visibly at 1x for 2.5 seconds during snow. These controlled captures establish rendering, not a claim about first-year production snowfall.

A fresh reviewer inspected the five falling/grounded/expired/snow/phone captures and found no weather or clock defects. Gray/brown indoor floor marks remain after leaves expire and are existing grime, not weather. Still images establish only their recorded phases; motion was watched separately in the displayed game.

## Runtime checks

1. Paused screenshots taken 600 milliseconds apart were byte-identical.
2. At tick 20767, saving, advancing 20 native ticks and loading restored the same tick, world hash and complete save bytes. The condition was `breezy` before and after loading.
3. The production sampler had 14 leaves at tick 20767 and zero at tick 20966, after the final leaf's fall and grounded lifetime. This check skipped intervening frames.
4. The winter condition became `mild` at tick 31265 after the two-hour event ended.
5. Phone clock content occupied 93 pixels within its 93-pixel client width. There was no horizontal page overflow. Reduced motion retained `Winter: snowing` while suppressing particles.
6. Losing the actual graphics device during snow advanced graphics generation from 0 to 1. Tick 31222 and world hash `5112222023865167847` stayed unchanged; the clock still read `Winter: snowing` after recovery.
7. The actual `WeatherScene` sampled a 16-by-16 field, then the same physical field translated by ten tiles on both axes with matching camera compensation. All 70 sampled rows were identical in the stable frame, and screen-coordinate differences were zero. Native land-purchase and save-envelope tests separately cover the persisted lot origin. A live browser land purchase was not exercised because that household could not afford one.

## Graphics guard and deliberate defects

An elevated particle anchored at approximately `[3.9474, 1.7408, 2.3445]` projects over indoor tile `[2, 0]`. A real GPU texture readback found zero changed pixels with the projected outdoor-mask guard, 20 when its comparison was changed from `==0u` to `==999u`, and 20 in the positive outdoor control. Both conditions used the same particle and camera. GPU validation reported no errors. The mutation existed only in an isolated browser module response; production source stayed unchanged.

The tests also rejected deliberate defects in daily weather selection, event ending, leaf expiration, tile identity, candidate limits, initial elapsed time, lot-origin normalization, content validation and boundary seed publication. Each filesystem mutation was restored byte-for-byte and its restored test rerun. The initial clock and grass regressions were observed failing before their repairs.

## Verification limits

No new save field or gameplay consequence was introduced. The season and weather logic does not use household random draws. The native boundary test compares saves, hashes and subsequent simulation continuation after weather-content reads. The browser checks cover an existing household, actual event progression, pause, save/load, expiry, phone layout and graphics recovery; they do not claim every possible household or lot layout was played.

No review video, animation loop or trace archive was retained. Task-owned browser pages and preview processes are closed after verification. Public notes are in `docs/changelog/2026-10-18-room-names.md`.

`clipping-proof.js` retains the browser callback for the GPU counterfactual. `mutation-failures.txt` retains failure excerpts; full transient logs remain in ignored `.scratch/` storage. `final-file-hashes.json` records source, compiled WebAssembly, fixture and capture fingerprints.

## Local check results

1. `cargo test --workspace -j 2`: 2,581 passed. One existing private-save example test was ignored because it requires an explicitly supplied save path.
2. `cargo clippy --workspace --all-targets -j 2 -- -D warnings` and `cargo fmt --all -- --check`: passed.
3. `npm --prefix web test -- --maxWorkers=2`: 277 files and 3,788 tests passed; exit 0. This run used a 2-GiB Node heap limit after checking roughly 18 GiB of available host memory and active workloads. All sampled available-memory readings exceeded 18 GiB.
4. Vitest logged fork-worker shutdown timeouts for `character-bike-fit-equivalence`, `ground-markers`, `window-bridge`, `character-motion` and `architecture-resources` after their assertions passed. These are runner shutdown warnings, not passed timeout tests or evidence about game behavior. No claim is made that the runner shut down without warnings.
5. Web type checking and the production build passed. Vite reported existing mixed static/dynamic import and plugin-timing notices; the build succeeded.
6. Changelog generation tests: 12 passed. Documentation ID and whitespace checks passed.

The production-code extraction fixtures now supply the weather and elapsed-time dependencies used by the shipped frame code. The catalogue fixture resolves its shared module mock before importing dependents. Their original behavior assertions remain intact, and an independent reviewer found no lost coverage. These fixture changes have no separate player-visible release note; the public notes cover the grass, weather and clock changes.
