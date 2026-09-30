# Gameplay UI verification evidence

The full restored tree passed 1,168 native tests and 1,232 web tests. The release
WebAssembly package was rebuilt before the final web run and played checks.
Exact commands, exit codes and visual limits are recorded in
`docs/specs/2026-09-30-gameplay-ui.md` and [A-gameplay-ui-corrections] in
`docs/alpha-feel-notes.md`.

## Manual mutation checks

Each of these 21 mechanisms was deliberately broken. The named test produced
an assertion failure, and the changed source was restored byte for byte. The
final 14 restoration hashes are in `review-mutation-restoration.txt`; the first
seven restorations were verified during execution, with failure output retained
here. A repeated
sidebar-order entry records replacement of a weaker initial mutation with an
actual control move. Only the final recorded failure is counted.

| Mechanism | Test command or file | Failure log |
| --- | --- | --- |
| Served order appears once | `cargo test -p terri-sim current_order_is_shown_once` | `queue-order-mutation.txt` |
| Bed shortage comparison | `cargo test -p terri-sim bed_shortage_counts` | `bed-shortage-mutation.txt` |
| Confirm clears selection | `tests/builder.test.ts` | `confirm-deselection-mutation.txt` |
| Preview replaces original | `tests/builder.test.ts` | `preview-replacement-mutation.txt` |
| Historical decoder remains reachable | `actual_pre_voice_save_loads_all_people_and_resaves_with_replay_preserved` in `terri-wasm` | `legacy-decoder.log` |
| Unlimited append preserves orders | `hundreds_of_waiting_orders_and_a_front_order_all_survive_save_load` in `terri-wasm` | `unlimited-append.log` |
| Missing station abandons recipe | `cargo test -p terri-sim a_missing_future_station` | `missing-station-abandon.log` |
| Visible DOM window stays bounded | `tests/action-queue.test.ts` | `visible-queue-window.log` |
| Expanded menus hide cards at every compact size | `tests/mobile-hud.test.ts` | `menu-hide-scope.log` |
| Scrollbar adds usable width | `tests/hud-scrollbar.test.ts` | `scrollbar-width.log` |
| Drawing receives the actual bookcase facing | `python -B -m unittest test_bookcase` in `assets/sprites/gen/` | `bookcase-observed-facing.log` |
| Speed precedes Build | `tests/mobile-hud.test.ts` | `sidebar-control-order.log` |
| Recipe labels match menu rows | `cargo test -p terri-sim queued_recipes_use_the_same_rows` | `queued-recipe-label.log` |
| Active work takes precedence over a suspended recipe | `cargo test -p terri-sim a_suspended_recipe_does_not_hide` | `active-action-precedence.log` |
| Historical random state is retained | `cargo test -p terri-wasm pre_voice_wire_shape` | `legacy-rng-preservation.log` |
| Native projection stops before hidden orders | `cargo test -p terri-sim current_order_is_shown_once` | `bounded-native-projection.log` |
| WASM exports the requested prefix | `cargo test -p terri-wasm unlimited_queue` | `bounded-wasm-projection.log` |
| UI requests a bounded prefix before rendering | `tests/action-queue.test.ts` | `bounded-ui-request.log` |
| Release simulation advances after loading | `tests/legacy-save.test.ts` | `release-legacy-tick.log` |
| Rejected release load retains the distinct loaded world | `tests/legacy-save.test.ts` | `release-rejected-load-reset.log` |
| Bridge uses the bounded export | `tests/bridge.test.ts` | `bounded-bridge-projection.log` |

Web files ran with `npx --no-install vitest run <file> --maxWorkers=1` in `web/`.
Their failing exit code was 1; the native regression failures returned 101.
The bookcase regression returned 1. Generated release JavaScript was restored
after its two deliberate prototype mutations; it is ignored build output.

## Review disposition

Fresh reviews found missing recipe labels, incorrect suspended-recipe priority,
an unbounded DOM call, an incomplete compact-menu rule, and weak bookcase and
historical-save assertions. All were corrected. Adversarial follow-up found
that bounding DOM rows still formatted and transferred the entire queue; an
additive bounded display query now stops that work in the simulation. Existing
full inspection queries and unlimited stored orders remain available.

The automated Rust mutation result is separate evidence. It tests mutations
generated within the changed-code diff with the full workspace test suite; it
does not replace a full-repository mutation sweep.

The completed local sweep returned exit 0: 66 cases tested, 57 caught by tests,
9 unviable because the mutated code could not build, no survivors and no
timeouts. The nonempty-run, normalized baseline and zero-timeout gates passed.
`automated-gate.json` records the scope and tested diff hash;
`automated-outcomes.json` retains every result and phase timing. The caught,
missed, unviable and timeout lists and console summary are retained beside them.
The `f19f00b` roadmap integration changed only documentation after the native
snapshot was tested.
