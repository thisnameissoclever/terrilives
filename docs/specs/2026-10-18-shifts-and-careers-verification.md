# Shifts and careers verification

This record holds the measured figures, moved test expectations and targeted mutation results for [shifts and more career paths](2026-10-18-shifts-and-careers.md) (issue 296). The figures were taken on 2026-10-23 on a Windows 11 desktop that other work kept between 80 and 94 percent busy, so the timings below are noisy; each says which builds it compares. The played visual pass of [WS-played] is not recorded here yet.

## Contents

- [Night worker sleep](#night-worker-sleep)
- [The shipped household's week](#the-shipped-households-week)
- [Search spread over 200 careers seeds](#search-spread-over-200-careers-seeds)
- [Tim's first shift](#tims-first-shift)
- [Waiting on a sleeping recipient](#waiting-on-a-sleeping-recipient)
- [Trace cost](#trace-cost)
- [Moved test expectations](#moved-test-expectations)
- [Targeted mutation results](#targeted-mutation-results)
- [Older writers and queued shift commands](#older-writers-and-queued-shift-commands)

## Night worker sleep

`cargo run --release -p terri-sim --example trace -- 10080 --night-worker` puts Casey on the night watch's standard shift (22:00 for eight hours, Monday to Thursday and Sunday) before the first tick and runs one week. Casey slept 1,131 ticks, 1,033 of them (91 percent) between 07:00 and 18:00. At all five shift starts of the week she was awake and left within ten minutes. Both parts of the [WS-sleep] acceptance hold with the shipped `shift_sleep_offset_night` of 660, so the offset was not changed.

## The shipped household's week

`cargo run --release -p terri-sim --example trace -- 10080` runs the shipped household for one week on the shipped content. Tim held the office's standard day shift; the search hired Bill as a kitchen porter on the restaurant kitchen's standard late shift (14:00 for nine hours, Wednesday to Sunday) and Casey on the night watch's `weekend_nights` shift (22:00 for eight hours, Wednesday to Sunday). The careers stream was drawn 11 times and the shift stream twice. Casey slept 516 of her 876 sleeping ticks between 07:00 and 18:00 and Bill, on a late shift, 592 of 1,093. Bill and Casey left within ten minutes at every shift start. Tim did not leave within ten minutes of his first shift on Monday at 06:00, in this run and in the night-worker run; he left at every later start. [Tim's first shift](#tims-first-shift) explains why.

## Search spread over 200 careers seeds

The trace ran the shipped household for one week under `--careers-seed` 0 to 199, each run on the same world seed, and the script `search_spread.py` (kept with the task logs, not in the repository) read each person's job. All 200 runs exited 0.

| Path | Bill | Casey |
| --- | --- | --- |
| Office | 27.5% | 1.0% |
| Cafe | 0% | 14.5% |
| Night watch | 8.5% | 13.0% |
| Hospital | 1.5% | 23.0% |
| Warehouse | 6.0% | 12.5% |
| Library | 22.5% | 0.5% |
| Restaurant kitchen | 13.5% | 0% |
| Buses | 0.5% | 16.5% |
| Still unemployed after the week | 20.0% | 19.0% |

The [WS-household] predictions are for the path a person ends up in, so they compare with the shares among those hired within the week: Bill was hired in 160 runs, 34% into the office, 28% the library, 17% the restaurant kitchen and 11% the night watch, against predictions of 30, 30, 18 and 11 percent. Casey was hired in 162 runs, 28% into the hospital, 20% buses, 18% the cafe, 15% the warehouse and 16% the night watch, against 21 percent for each of the first four and 13 percent for the night watch; with about 160 hires the standard error of a share near 20 percent is about 3 percentage points, so the hospital's excess is about two standard errors and the rest are within one. All three housemates shared Tim's schedule in 1 run of 200 (0.5 percent, predicted 0.45 percent), Tim and Bill in 27.5 percent (predicted 28 percent), Bill and Casey in 0.5 percent (predicted about 2 percent), and at least two of the three in 28 percent (predicted 31 percent, which assumed both were hired).

## Tim's first shift

At 05:47 on Monday Tim took a book from the bookcase, whose only transfer contact is the tile at (9, 0), and walked toward a seat to read. At 06:00 his shift registered, and because he was on a reading journey the shift start asked him to return the book first instead of leaving, as the reading system requires. At that tick Bill had just set out from (2, 9) to fetch a book from the same bookcase, and Bill's walk reserved the bookcase contact as its endpoint for the whole walk across the house. Tim's route back to the shelf found the only contact taken, so he stood in Waiting to return, blocked, until Bill finished at about 07:10. Tim then shelved the book, left at about 07:25 and reached work at about 08:20, missing about 140 of the shift's 480 minutes.

Shifts play no part in this. Tim holds the office's standard shift, nobody holds another shift before the 09:00 search, and the same run on the career content from before issue 296 reproduces it tick for tick. The cause is in the reading and seating reservation rules: a walk toward a one-contact bookcase holds the contact from its first step, and a person who must return a book before work cannot claim it. It is a reading-system defect left for the owner to decide, because a fix changes how walks reserve shelf contacts for every reader and moves main's pinned worlds; it was not changed here.

## Waiting on a sleeping recipient

The trace counts consecutive ticks during which a conversation request in the Approaching or Waiting phase has a sleeping recipient. A Suspended request is not counted, because it waits on its own initiator, who is busy elsewhere; the first version of the report counted those too, which produced the 165-tick figure first reported for the shipped week.

Every long wait found is an autonomous chat that Casey started. In the shipped week the longest is 119 minutes, request 9: Casey, home and awake after her night shift, waited from 09:41 to 11:39 on Saturday for Bill, who was sleeping late after his late shift ended at 23:00 the night before. With a night worker on the standard night watch shift, the longest is 94 minutes: Casey waited on Tim, asleep after work, from 17:50 to 19:23 on Tuesday. On the career content from before issue 296 (`--pre-shift-careers`), the longest is 82 minutes: Casey waited on Tim, asleep after work, from 17:46 to 19:07 on Friday.

The waiting is the conversation system's: an autonomous request waits beside a recipient engaged in a protected activity, and sleep is protected for as long as the sleeper sleeps. By the changelog of pull request 302, an initiator gives up such a wait on their own only once critically hungry or tired, so a recipient who sleeps on for more than an hour after the request takes the wait past the plan's 60-minute threshold.

Over twelve world seeds of one week each, waits over an hour happened in 7 weeks with shifts and 6 without, 10 and 9 such waits in all, and the longest wait of each week had a median of 118 minutes with shifts against 77 without; the single longest was 239 and 226 minutes. Shifts therefore make these waits somewhat longer, because sleepers on late and night shifts are asleep when the others are awake, but long waits on sleepers already happen without shifts. This is a conversation-system finding for the owner; it was not patched here, as [WS-systems] directs.

## Trace cost

The plan's baseline was taken at `71e2e43b3`, the branch's first merge of main, with three 12,000-tick release runs: medians of 9.31 seconds through `cargo run` and 7.71 seconds running the built example directly. Against that build, the finished branch ran 45 percent slower when the two were interleaved (medians 10.93 and 15.86 seconds), but the branch has since merged 82 commits of main at `2fa3eac56` that change what the household does. Interleaving five runs each of main's trace at `2fa3eac56` and this branch's gave medians of 14.07 and 13.65 seconds, a ratio of 0.97, within the [WS-performance] bound of 5 percent; the runs ranged from 12.9 to 21.2 seconds, so the comparison carries that noise. This branch's trace also includes its new per-tick reports.

## Moved test expectations

Each moved expectation is classed per "Movement of pinned values" in the spec.

| Test | Change | Class | Cause |
| --- | --- | --- | --- |
| `the_hash_is_unchanged_while_everyone_holds_the_standard_shift` | New pin, the hash the code computed before the shift section existed | Unchanged | The section is written only after a shift draw or a non-standard held shift |
| `the_shipped_household_hash_and_draws_through_thursday` | New pin of the shipped household's hash, 7 careers draws, 2 shift draws and the held shifts | Search behavior | The chance-based search and shift draws |
| `every_search_on_keeps_published_hires_schedules_and_career_randomness` | Unchanged values, run under the career content from before shifts | The published search pin | Main renamed it from `every_search_on_plays_out_exactly_as_the_global_setting_did` |
| `inherited-runtime.pack` fixture | Regenerated from main's bytes; the proof removes exactly the shift knobs, the career shift fields and the new careers | Content and envelope | The shipped tuning and careers |
| `a_compiled_pack_serialises_to_a_stable_golden_vector` | The test's full tuning reconstructs a search temperature of 0 | Content and envelope | Published packs now rebuild the best-fit search |
| Wasm and web tests that read the current save | Header 21 and the schema-twenty-one envelope; every other byte unchanged | Content and envelope | The writer moved to schema twenty-one |
| `career_schedule_of_*` calendar boundary tests and the shipped-day bridge test | Five schedule values, adding the standard day kind and index 0 | Content and envelope | The schedule export names the held shift |

The bare-agent golden hash and the published schema-fifteen boundary values were unchanged, as the workspace runs confirm.

## Targeted mutation results

Each mutant changed one site, ran the tests that should catch it and restored the file from a saved copy whose SHA-256 was checked. A full `cargo mutants` sweep was not run.

- Reading the held shift: the preflight, the shift start, saved-attendance validation, the longest listed shift, pending departures, `shift_at`, the door window, an outbound commuter with no scheduled shift and legacy adoption each fail a test when they read the standard shift instead. The last two survived at first; tests for them were added.
- The sleep offset: selection ignoring the offset and an early shift taking the late offset each fail a test.
- The hash and schema twenty-one: leaving the section out, the shift ids, the draw count, the held list or the stream, accepting a repeated, unordered, `standard` or unrecorded entry, dropping the held shifts or the stream on restore, and shifting queued positions each fail a test. Accepting repeated queued positions survives because the merge that places the rows then finds a row it cannot place and refuses the load anyway; that check is redundant rather than untested.
- The shell: dropping the shift name, the chance ordering, the chosen shift on Assign, the By chance reset, the Change shift button's disabled state, the bridge's kind check and its weight-0 check each fail a test.
- The review fixes: scoring a forfeited shift, a refusal that draws the shift stream and overwrites the held shift, and a published pack keeping the shipped temperature each fail a test.

## Older writers and queued shift commands

The writers for schemas fourteen to twenty cannot return an error, and the browser writes only the current schema, so they leave queued shift commands out of the queue and out of the positions they count, as pull request 303's writers leave out its settings. `older_writers_leave_queued_shift_commands_out` checks that each of them saves exactly what it saves for the same queue without the shift commands.
