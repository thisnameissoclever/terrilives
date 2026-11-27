# Four-week need mood study

Both households spent the first week below +100 overall mood. By week four, the saved household spent 87.2148% of living person-minutes at +100 overall mood, and the starter household spent 51.2169%. The saved household's need balance stayed at +100 for all of week four. Other mood effects still pulled the overall score below +100 during 5,155 of those minutes.

## Weekly time at +100

| Household | Week | Living person-minutes | Overall mood at +100 | Need balance at +100 |
| --- | ---: | ---: | ---: | ---: |
| Saved | 1 | 40,320 | 0 (0%) | 0 (0%) |
| Saved | 2 | 40,320 | 10,689 (26.5104%) | 6,696 (16.6071%) |
| Saved | 3 | 40,320 | 33,132 (82.1726%) | 40,014 (99.2411%) |
| Saved | 4 | 40,320 | 35,165 (87.2148%) | 40,320 (100.0000%) |
| Starter | 1 | 30,240 | 0 (0%) | 0 (0%) |
| Starter | 2 | 30,240 | 4,637 (15.3340%) | 5,956 (19.6958%) |
| Starter | 3 | 30,240 | 15,318 (50.6548%) | 30,240 (100.0000%) |
| Starter | 4 | 30,240 | 15,488 (51.2169%) | 27,704 (91.6138%) |

Both households spent zero person-minutes at −100 overall mood or −100 need balance.

## How often each need qualified

Each cell gives two percentages of the week's living person-minutes. The first is time above 80. The second is time at zero.

| Household | Week | Hunger | Energy | Hygiene | Bladder | Social | Fun | Comfort |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Saved | 1 | 12.0040 / 0 | 38.5714 / 0 | 41.2748 / 0 | 35.4737 / 0.9276 | 81.7981 / 0 | 60.0149 / 0 | 87.6811 / 0 |
| Saved | 2 | 7.4826 / 0 | 28.1672 / 0 | 33.2912 / 0 | 34.5858 / 0 | 91.1409 / 0 | 67.4058 / 0 | 91.5203 / 0 |
| Saved | 3 | 8.7202 / 0 | 25.0744 / 0 | 35.8730 / 0 | 32.6513 / 0.0149 | 85.4712 / 0 | 72.7827 / 0 | 97.8770 / 0 |
| Saved | 4 | 17.0064 / 0 | 27.3289 / 0 | 39.9926 / 0 | 35.5456 / 0 | 89.8958 / 0 | 57.9340 / 0 | 98.1076 / 0 |
| Starter | 1 | 13.1151 / 0 | 37.5926 / 0.4233 | 41.2269 / 0 | 38.8856 / 0 | 59.9239 / 0 | 53.6839 / 0 | 95.8929 / 0 |
| Starter | 2 | 2.8538 / 0 | 35.5853 / 0 | 39.9735 / 0 | 43.2672 / 0 | 60.5589 / 0 | 61.7923 / 0 | 100.0000 / 0 |
| Starter | 3 | 11.1045 / 0 | 36.9643 / 0 | 39.0112 / 0 | 41.0020 / 0 | 56.8519 / 0 | 26.8452 / 0 | 97.8737 / 0 |
| Starter | 4 | 16.0681 / 0 | 28.1746 / 0.4993 | 39.6429 / 0 | 40.0893 / 0 | 63.3862 / 0 | 43.9583 / 0 | 93.1911 / 0 |

## Measurement

The November 20, 2026 native run followed four game weeks for a four-person household from the paused V23 save and a three-person starter household with seed `20260728`. The saved household resumed at tick 1,544,614 and the starter began at tick zero. Each week covered 10,080 simulation minutes from that household's starting tick. The harness supplied no player commands and kept each household's starting state and settings.

After every simulation minute, the harness counted the living people and read the overall mood the game displays, the accumulated need balance, and the seven need levels. It counted exact cap values. Each need strictly above 80 added 0.1 point per game hour and each empty need subtracted 5 points per game hour, with all gains and losses combined before each minute's clamp. These are two autonomous trajectories with the stated rates and starting states.

The run used Windows x64, Rust 1.94.1 and one Cargo build job. The cold build timed out during the engine compile. The warmed optimized build passed in 530.49 seconds. Both simulations completed in the same bounded process in 437.52 seconds, with a six-minute limit for each household. [Native study example](../../crates/terri-wasm/examples/need_mood_study.rs)

## Reproduce

Use a local copy of the V23 input and the source snapshot identified below to reproduce this run. The example reads the save and writes measurements to standard output. A run from a current checkout measures how the same household plays under the current mood rules.

```powershell
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) '.local-build/cargo'
$env:CARGO_PROFILE_RELEASE_OPT_LEVEL = '2'
$env:CARGO_PROFILE_RELEASE_LTO = 'off'
$env:CARGO_PROFILE_RELEASE_DEBUG = 'false'
$env:CARGO_INCREMENTAL = '0'
cargo build --locked --offline --release --jobs 1 -p terri-wasm --example need_mood_study
.\.local-build\cargo\release\examples\need_mood_study.exe 'C:\path\to\private-v23.ncsave' 4 20260728
```

The checkout was based on `c7932801c95bf1f38437cc38bb34524b356d3263` with the in-progress need mood change. Formatting in the crate entry files and test code changed during compilation. The need mood arithmetic, overall mood projection, authored tuning, and example hashes matched before and after. The ignored study directory retains the build logs, source manifests, and raw sample totals.

| Record | SHA-256 |
| --- | --- |
| Authored tuning (`content/tuning.toml`) | `e6aab7a9da071df238f1aebbfece0725b59e5f8d5e1afc61f24f2a93dc830098` |
| Need arithmetic (`need_mood.rs`) | `e1ab0b6ab21280c382a4134abedd6cf507c3d50d05db8263e13044968ebc20a3` |
| Overall mood projection (`mood.rs`) | `a1301a9975c9929083a3d85998b211b0cbcdd7f92e62c6b4a0c595c63c2bab6e` |
| Study example | `426519e9d45faa449005c78c4cd981e0f2e93e2bdf9ba345234f52f2de1e7889` |
| Study executable | `dab4923b3240b6dd18b31584d3eeb953632d88e7912ac74ba5edab1e1fab28f3` |
| Raw results | `ef3a7b12092f1ae761a3786936ca775909587ae8ae18af3726d4a3ba8407acb9` |

## November 21 comparison at +0.02

The replay used the same V23 input, starter seed 20260728 and four-week window. The reward was +0.02 per healthy need per hour and the empty-need loss was 5 per hour. At +0.02 both households spent zero person-minutes at +100 overall or accumulated need mood in each of the four weeks. The saved household had 161,280 living person-minutes and the starter household had 120,960. At +0.1, those same windows contained 78,986 and 35,443 person-minutes at +100 overall mood, respectively.

The comparison was built from local commit `7190c1339` before integrating the Career update. The raw CSV and final world hashes are retained in the ignored study folder.

The repeat on the code with the Career release integrated also found zero minutes at either mood ceiling in all four weeks for both households. The saved household finished with hash `2133861043347235743`, and the starter household finished with `7615356142288321443`. This run used the same save and seed. Its source based on `ebe7be646` had the same rate and simulation logic as the release and still used the interim V26 wire number. The replay loads V23 and never writes a save.

Raw output SHA-256: `b5831844c29d2ed512c0cb49646672bcb959b733a3a05b1027ba08493ce1df1d`.
