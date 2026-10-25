# Sleeping chat partners verification

This record holds the measurements for issue 338, which stops housemates waiting beside a sleeping chat partner. The rules are in rule 6 of the conversation contracts in the [pending-conversation design](../superpowers/specs/2026-10-17-urgent-needs-and-pending-conversations-design.md): by the owner's ruling of 2026-10-23, a housemate never chooses a chat with someone who is asleep, a chat they chose gives up when its partner falls asleep, and a chat the player ordered keeps waiting. The figures were taken on 2026-10-24 on a Windows 11 desktop.

## Contents

- [Waits beside a sleeper](#waits-beside-a-sleeper)
- [Fights the game starts](#fights-the-game-starts)
- [Chats and Social over the same weeks](#chats-and-social-over-the-same-weeks)
- [Moved pins](#moved-pins)
- [Tests and targeted mutations](#tests-and-targeted-mutations)

## Waits beside a sleeper

The measurement is the sleeper-wait report of the trace example, described in [the shifts verification](2026-10-18-shifts-and-careers-verification.md#waiting-on-a-sleeping-recipient): consecutive ticks, one game minute each, during which a conversation request in the Approaching or Waiting phase has a sleeping recipient. This branch adds two lines to the report: one counts only chats a housemate chose for themselves, saved with the origin `Autonomous`, and one counts fights the game started, described below. Each run is one week, `cargo run --release -p terri-sim --example trace -- 10080` with the flag or world seed named in the table. "Before" is main at `318da27c6` with this branch's report; "after" is this branch.

| Run | Before: longest self-chosen wait | Before: self-chosen ticks in all | After: longest | After: in all |
| --- | --- | --- | --- | --- |
| Shipped household | 56 | 56 | 0 | 0 |
| `--night-worker` | 57 | 77 | 0 | 0 |
| `--pre-shift-careers` | 0 | 0 | 0 | 0 |
| World seed 1 | 0 | 0 | 0 | 0 |
| World seed 2 | 0 | 0 | 0 | 0 |
| World seed 3 | 0 | 0 | 0 | 0 |
| World seed 4 | 210 | 250 | 0 | 0 |
| World seed 5 | 135 | 135 | 0 | 0 |
| World seed 6 | 0 | 0 | 0 | 0 |
| World seed 7 | 0 | 0 | 0 | 0 |
| World seed 8 | 53 | 97 | 0 | 0 |
| World seed 9 | 201 | 331 | 0 | 0 |
| World seed 10 | 0 | 0 | 0 | 0 |
| World seed 11 | 71 | 81 | 0 | 0 |
| World seed 12 | 36 | 63 | 0 | 0 |

Before the change, eight of the fifteen weeks had a self-chosen chat waiting beside a sleeper, four of them for over an hour; in each of those eight weeks the longest wait of any origin was a self-chosen chat, and the other seven weeks had no wait of any origin. After it, no request of any origin waited beside a sleeper, because the trace issues no player orders. The shipped week's figures differ from the 119 minutes in the issue because main has changed since that measurement, including the bookcase fix of issue 339, which changes Monday morning for the shipped household.

Thirty further weeks on this branch, world seeds 13 to 42, also had no self-chosen wait beside a sleeper.

The give-up is checked in the conversation upkeep that ends every tick, after movement and interactions, where sleep begins. A chat whose partner falls asleep during a tick is therefore given up within that same tick, and the per-tick report never sees it waiting.

## Fights the game starts

The ruling covers chats. A fight the game starts over a grievance is a game-made order rather than a chat request, so the sleeper-wait report above does not see it, and this branch does not change it. The second new line counts the ticks during which a fight order at the front of a housemate's queue has a sleeping recipient and has not started; the trace gives no player orders, so every such fight is one the game started. Before the change, one of the fifteen weeks had one: at world seed 1 a fight waited 166 minutes on a sleeper. After it, none of the fifteen weeks, nor the thirty further weeks, had one. The weeks diverge once choices change, so this shows that such waits are uncommon; it does not show that the change prevents them.

## Chats and Social over the same weeks

Summed over the fifteen runs, completed chats fell from 118 to 112 and Social supplied by all sources fell from 26,000 to 25,591 need points, 1.6 percent. The lowest Social floor of any housemate in each week averaged 24.0 before and 26.7 after, and the lowest in any week rose from 0.0 to 5.2. Nobody died in any run before or after. The weeks diverge after the first changed choice, so these totals compare two sets of fifteen different weeks rather than matched ones; they show no loss of company large enough to stand out from the week-to-week spread.

## Moved pins

Each pin below moved because of the new selection rule; no other cause moved it. In the shipped household, the first tick at which the world differs from main is 05:16 on Monday: Bill is asleep, Tim's choice no longer has a chat with Bill among its candidates, and the same random draw picks a different action, so everything after differs. Each pin's comment in the source records its old value and this cause.

| Pin | Old | New | How it was measured |
| --- | --- | --- | --- |
| `STANDARD_ONLY_HASH` in `save/v21_tests.rs` | 3597462262917285100 | 1877760251232896320 | The test, run as it stands and again with `hash_shifts` returning before it writes anything; both gave the new value, so it still equals the hash without the shift section |
| `SHIPPED_THURSDAY` in `job_search_tests.rs` | hash 18180649999092761866, 7 careers draws, 2 shift draws | hash 17945103458811991316, 7, 2 | The test; the jobs and held shifts are unchanged |
| `TWO_DAY_FOLD_WITHOUT_THE_LOG` in `activity_log_tests.rs` | `0x77df_2117_a9d4_c4b1` | `0x00a0_3284_1722_e7de` | The test, which first requires the worlds with the log on and off to match |
| `TWENTY_DAY_FOLD_WITHOUT_THE_LOG` in `activity_log_tests.rs` | `0x2e8d_746e_12f8_fad2` | `0x4080_914e_b342_85e0` | The ignored twenty-day test in a release build, with the same on and off check |

The issue 339 regression test, `the_shipped_household_returns_tims_book_and_sends_him_to_his_first_shift`, depended on the shipped seed reaching 06:00 on Monday with Tim returning a book while another walk held the bookcase's only contact. After 05:16 the shipped seed no longer reaches that state. A scan of world seeds 0 to 299, run with the issue 339 defect restored (two shelf uses of one contact always conflicting, in `seating::endpoints_conflict`), found one seed, 182, in which Tim returns a book at his shift start and waits to do so. The test now runs at seed 182 and also requires another reader to be walking to the same bookcase at the shift start. With the defect restored it fails with Tim waiting 40 ticks; with the fix Tim does not wait and leaves 25 minutes after his shift starts.

No golden world hash, wasm golden value, content digest, save manifest or fixture moved.

## Tests and targeted mutations

`crates/terri-sim/src/social_episode/tests/sleeping_partner_tests.rs` holds the four tests. They put a partner to sleep by starting a bed's sleep-tagged interaction on them at a placed bed, which is the state `systems::circadian::is_asleep` reads.

1. `a_housemate_never_chooses_a_chat_with_a_sleeping_partner` runs the same lonely housemate twice, once with the partner busy and awake at a fridge and once asleep for the same time. Awake, the housemate chooses to wait for them; asleep, no request is created, counted by request identity so a chat chosen and given up in one tick also fails it.
2. `a_chosen_chat_gives_up_when_its_partner_falls_asleep_and_asks_again_after_waking` lets selection choose the chat while the partner is busy, puts the partner to sleep, and requires the give-up, the release of the asker, no activity log record, no new request while the partner sleeps, and a new request whose chat runs after waking.
3. `a_player_ordered_chat_keeps_waiting_for_a_sleeping_partner` orders the chat through the public Talk command for a partner who falls asleep during the wait and for one already asleep; the order stays and the chat runs after waking.
4. `only_a_chosen_chat_gives_up_and_an_unattributed_legacy_chat_keeps_waiting` requires a `LegacyUnattributed` request beside a sleeper to stay, and waiting and suspended self-chosen requests to give up.

On main, tests 1, 2 and 4 failed: test 1 when the sleeping partner was chosen, test 2 when the request stayed after the partner fell asleep, and test 4 on its self-chosen rows. Test 3 passed on main, as it must: the player-order exemption is today's behavior, and the test guards it against a broader give-up. All four pass on this branch.

Each targeted mutant changed one site, ran the four tests and restored the file, whose SHA-256 was checked afterward. Every mutant failed at least one test:

| Mutant | Failing tests |
| --- | --- |
| Selection ignores sleep | 1, 2 |
| No give-up when the partner sleeps | 2, 4 |
| The give-up applies to every origin | 4 |
| Suspended chats keep waiting | 4 |
| Selection treats any activity as sleep | 1, 2 |
| The give-up treats any activity as sleep | 1, 2 |
