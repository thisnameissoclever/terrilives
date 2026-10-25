# Sleeping chat partners verification

This record holds the measurements for issue 338, which stops housemates waiting beside a sleeping partner. By the owner's ruling of 2026-10-23, a housemate never chooses a chat with someone who is asleep, a chat they chose gives up when its partner falls asleep, and a chat the player ordered keeps waiting; rule 6 of the conversation contracts in the [pending-conversation design](../superpowers/specs/2026-10-17-urgent-needs-and-pending-conversations-design.md) records it. By the coordinator's decision of 2026-10-24, arguments the game starts over a grievance, which are not player orders, follow the same rule: the game does not start one against a sleeper and withdraws a waiting one when its recipient falls asleep, while a Fight the player orders keeps waiting; [fights](2026-10-16-fights.md) records it. The figures were taken on 2026-10-24 on a Windows 11 desktop.

## Contents

- [Waits beside a sleeper](#waits-beside-a-sleeper)
- [Chats, fights and Social over the same weeks](#chats-fights-and-social-over-the-same-weeks)
- [Moved pins](#moved-pins)
- [Tests and targeted mutations](#tests-and-targeted-mutations)

## Waits beside a sleeper

The measurement is the sleeper-wait report of the trace example, described in [the shifts verification](2026-10-18-shifts-and-careers-verification.md#waiting-on-a-sleeping-recipient): consecutive ticks, one game minute each, during which a conversation request in the Approaching or Waiting phase has a sleeping recipient. This branch adds two lines to the report. One counts only chats a housemate chose for themselves, saved with the origin `Autonomous`. The other counts the ticks during which a fight order at the front of a housemate's queue has a sleeping recipient and has not started; the trace gives no player orders, so every such fight is one the game started.

Each run is one week, `cargo run --release -p terri-sim --example trace -- 10080` with the flag or world seed named in the table. "Before" is main at `318da27c6` with this branch's report; "after" is this branch. Each cell gives the ticks in all and, after the slash, the longest single wait.

| Run | Before: self-chosen chats | Before: game-made fights | After: self-chosen chats | After: game-made fights |
| --- | --- | --- | --- | --- |
| Shipped household | 56 / 56 | 0 / 0 | 0 / 0 | 0 / 0 |
| `--night-worker` | 77 / 57 | 0 / 0 | 0 / 0 | 0 / 0 |
| `--pre-shift-careers` | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 1 | 0 / 0 | 166 / 166 | 0 / 0 | 0 / 0 |
| World seed 2 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 3 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 4 | 250 / 210 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 5 | 135 / 135 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 6 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 7 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 8 | 97 / 53 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 9 | 331 / 201 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 10 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 11 | 81 / 71 | 0 / 0 | 0 / 0 | 0 / 0 |
| World seed 12 | 63 / 36 | 0 / 0 | 0 / 0 | 0 / 0 |

Before the change, eight of the fifteen weeks had a self-chosen chat waiting beside a sleeper, four of them for over an hour; in each of those eight weeks the longest conversation-request wait of any origin was a self-chosen chat, and the other seven weeks had no such wait of any origin. One week had a game-made fight waiting 166 minutes on a sleeper. After the change, no chat request of any origin and no fight waited beside a sleeper in any of the fifteen weeks, because the trace issues no player orders. Thirty further weeks on this branch, world seeds 13 to 42, also had no self-chosen chat and no game-made fight waiting beside a sleeper. The shipped week's figures differ from the 119 minutes in the issue because main has changed since that measurement, including the bookcase fix of issue 339, which changes Monday morning for the shipped household.

The chat give-up and the fight withdrawal are both checked in the conversation upkeep that ends every tick, after movement and interactions, where sleep begins. A chat or fight whose partner falls asleep during a tick is therefore given up within that same tick, and the per-tick report never sees it waiting.

## Chats, fights and Social over the same weeks

Summed over the fifteen runs, completed chats went from 118 to 116, completed fights from 2 to 1, and Social supplied by all sources from 26,000 to 25,736 need points, 1.0 percent less. The lowest Social floor of any housemate in each week averaged 24.0 before and 29.7 after; the lowest in any week was 0.0 both before and after, in different weeks. Nobody died in any run before or after. The weeks diverge after the first changed choice, so these totals compare two sets of fifteen different weeks rather than matched ones; they show no loss of company large enough to stand out from the week-to-week spread.

## Moved pins

Each pin below moved because of the new rules, and each pin's comment in the source records its old values and causes. In the shipped household the world first differs from main at 05:16 on Monday: Bill is asleep, Tim's choice no longer has a chat with Bill among its candidates, and the same random draw picks a different action. The fight trigger's part moves the shipped household again at 21:25 on Monday: Tim is asleep, and the trigger no longer spends a random draw on Casey's grievance against him, so Casey's next choice draws a different number. Each moved test was re-run after the move and passes.

| Pin | Main | After the chat rules | After the fight rules too | How it was measured |
| --- | --- | --- | --- | --- |
| `STANDARD_ONLY_HASH` in `save/v21_tests.rs` | 3597462262917285100 | 1877760251232896320 | unchanged | The test, run as it stands and again with `hash_shifts` returning before it writes anything; both gave the new value, so it still equals the hash without the shift section. Its run ends at 10:00 on Monday, before the fight rules change anything |
| `SHIPPED_THURSDAY` in `job_search_tests.rs` | hash 18180649999092761866, 7 careers draws, 2 shift draws | hash 17945103458811991316, 7, 2 | hash 17769474122166916875, 7, 2 | The test; the jobs and held shifts are unchanged |
| `TWO_DAY_FOLD_WITHOUT_THE_LOG` in `activity_log_tests.rs` | `0x77df_2117_a9d4_c4b1` | `0x00a0_3284_1722_e7de` | `0xa0fb_785a_e3a4_7b1d` | The test, which first requires the worlds with the log on and off to match |
| `TWENTY_DAY_FOLD_WITHOUT_THE_LOG` in `activity_log_tests.rs` | `0x2e8d_746e_12f8_fad2` | `0x4080_914e_b342_85e0` | `0x78e8_cb74_b70c_d742` | The ignored twenty-day test in a release build, with the same on and off check |

The issue 339 regression test, `the_shipped_household_returns_tims_book_and_sends_him_to_his_first_shift`, depended on the shipped seed reaching 06:00 on Monday with Tim returning a book while another walk held the bookcase's only contact. After 05:16 the shipped seed no longer reaches that state. A scan of world seeds 0 to 299, run with the issue 339 defect restored (two shelf uses of one contact always conflicting, in `seating::endpoints_conflict`), found one seed, 182, in which Tim returns a book at his shift start and waits to do so. The test now runs at seed 182 and also requires another reader to be walking to the same bookcase at the shift start. With the defect restored it fails with Tim waiting 40 ticks; with the fix Tim does not wait and leaves 25 minutes after his shift starts. The fight rules do not change this run.

No golden world hash, wasm golden value, content digest, save manifest or fixture moved.

## Tests and targeted mutations

`crates/terri-sim/src/social_episode/tests/sleeping_partner_tests.rs` holds the nine tests. They put a partner to sleep by starting a bed's sleep-tagged interaction on them at a placed bed, which is the state `systems::circadian::is_asleep` reads.

1. `a_housemate_never_chooses_a_chat_with_a_sleeping_partner` runs the same lonely housemate twice, once with the partner busy and awake at a fridge and once asleep for the same time. Awake, the housemate chooses to wait for them; asleep, no request is created, counted by request identity so a chat chosen and given up in one tick also fails it.
2. `a_chosen_chat_gives_up_when_its_partner_falls_asleep_and_asks_again_after_waking` lets selection choose the chat while the partner is busy, puts the partner to sleep, and requires the give-up, the release of the asker, no activity log record, no new request while the partner sleeps, and a new request whose chat runs after waking.
3. `a_player_ordered_chat_keeps_waiting_for_a_sleeping_partner` orders the chat through the public Talk command for a partner who falls asleep during the wait and for one already asleep; the order stays and the chat runs after waking.
4. `only_a_chosen_chat_gives_up_and_an_unattributed_legacy_chat_keeps_waiting` requires a `LegacyUnattributed` request beside a sleeper to stay, and waiting, suspended and approaching self-chosen requests to give up; the approaching one must also release the recipient it reserved.
5. `the_game_never_starts_a_fight_with_a_sleeping_partner` gives the same grievance and a certain draw against a partner busy and awake at a fridge and against one asleep; only the awake partner gets a fight order.
6. `a_waiting_game_made_fight_is_withdrawn_when_its_partner_falls_asleep_and_can_return` queues a game-made fight against a busy partner, puts the partner to sleep, and requires the withdrawal of the exact order, its system identity, its pending cause and the approach, as pull request 302's crisis withdrawal does, with no activity log record. The grievance stays unfought, nothing is started while the partner sleeps, and the same grievance starts a new fight after they wake.
7. `a_player_ordered_fight_keeps_waiting_for_a_sleeping_partner` orders a Fight through the Talk command; the order waits through the sleep and the fight runs after waking.
8. `the_published_fight_rules_keep_a_waiting_fight_beside_a_sleeper` requires the published fight rules, which authenticated historical content selects to keep its published outcomes, to leave a waiting game-made fight in place beside a sleeper.
9. `the_saved_fight_state_restores_straight_after_a_sleep_withdrawal` withdraws a fight through the conversation upkeep alone, before the end-of-tick grievance upkeep, and requires the saved grievance and fight state to hold no cause for the withdrawn fight and to restore. Before the withdrawal it restores the same way, as a control. The tests' sleeping fixture is not a loadable world, so the test restores that saved state in place, which is the step of a full load that refused a stale cause.

On main, tests 1, 2, 4, 5, 6 and 9 fail: test 1 when the sleeping partner is chosen, test 2 when the request stays after the partner falls asleep, test 4 on its self-chosen rows, test 5 when the sleeper is given a fight order, and tests 6 and 9 when the fight stays after the partner falls asleep. Tests 3, 7 and 8 pass on main, as they must: they guard today's behavior against a broader rule. All nine pass on this branch.

Test 9 guards a defect the independent review found: a sleep withdrawal that leaves the fight's pending cause in place until the end-of-tick grievance upkeep makes a save taken in between invalid. The withdrawal therefore sits in `fights::withdraw_invalid` beside the crisis condition, which retires the cause at once. With a withdrawal that leaves the cause in place, test 9 fails: its saved state holds the stale cause, and restoring it returns `InvalidValue`.

A running fight is not tested separately. Its recipient is reserved and talking, so they cannot start to sleep; the withdrawal also applies only to a fight that has not started.

Each targeted mutant changed one site, ran the nine tests and restored the file, whose SHA-256 was checked afterward. Every mutant failed at least one test:

| Mutant | Failing tests |
| --- | --- |
| Selection ignores sleep | 1, 2 |
| No chat give-up when the partner sleeps | 2, 4 |
| The chat give-up applies to every origin | 4 |
| Suspended chats keep waiting | 4 |
| The chat give-up applies only while waiting or suspended | 4 |
| Selection treats any activity as sleep | 1, 2 |
| The chat give-up treats any activity as sleep, which the fight rules share | 1, 2, 5, 6, 8, 9 |
| The fight trigger ignores sleep | 5, 6 |
| No fight withdrawal when the recipient sleeps | 6, 9 |
| A sleep withdrawal that leaves the pending cause until the end of the tick | 9 |
| The published rules also run the current withdrawal | 8 |
