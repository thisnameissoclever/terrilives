# Alpha Feel Notes

M1c set out to stop the sims reading as robots. This is the record of
watching one for twenty minutes of simulated time and writing down what it
actually did, plus the three knobs that were turned as a result and the
things a knob cannot fix.

**Nothing here is a test result.** Every other task in this project is
judged by whether the suite is green; this one is judged by whether the
observations are true and useful, and a note saying the sims feel alive
would be worth nothing. Where a claim has a number behind it the number is
given, and where it does not the note says so.

**Historical name mapping.** Sessions recorded before the 2026-08-05 roster
rename keep the names visible during those runs: Terri is now Tim, Doug is now
Bill, and Nadia is now Casey. Measurements were not rewritten after the fact.

---


## How to id a new session

A new measured or watched session's id is a short kebab-case SLUG, not a
number:

```
## [A-alpha-acceptance] The alpha acceptance pass - all eleven criteria
```

**The numeric series is CLOSED at `[A-25]`.** `[A-1]`-`[A-25]` were
allocated from a shared counter, which every parallel branch reads the
same way: on 2026-08-01 three PRs each appended what they believed was
`[A-17]`, and the last one through renumbered twice. A slug needs no
allocator. Existing ids never move - they are cited from code comments
and from `docs/alpha-goals.md`. The same rule, and the same
`check-doc-ids.py` guard, covers `docs/lessons-learned.md`; its header
carries the full reasoning.

## How this was observed, and what that is worth

Two instruments, deliberately, because either alone is weak.

**[O1] A behaviour trace, headless.** A throwaway harness built
`Sim::new_from_shipped_lot()`, spawned the same agent `web/src/main.ts`
spawns - tile (8, 6), hunger 25, every other need full - and ticked it
12 000 times, which is 20 minutes at 1x. It logged every decision with the
full candidate table and each candidate's softmax probability, every
interaction with its sampled length, every stroll, and the best score
visible to the sim on every tick it was free to choose. The candidate
tables are reconstructed from `score_advertisement` and `TileGrid::find_path`
against the post-tick state, which is exactly what `select_action` saw.

**[O2] A real, visible Chrome.** [L14] is the trap this project has hit
three times: an agent-driven tab is never composited, so
`requestAnimationFrame` never fires and a run reporting "no console errors"
has observed nothing. Frames were therefore counted on the platform globals
`GPURenderPassEncoder.prototype.draw` and `GPUQueue.prototype.submit`,
which have one identity per page and cannot be defeated by [L20]'s module
identity trap, and the canvas was read back inside a rAF callback per
[L37].

Measured on the **production** build (`vite build` + `vite preview` on
`:4173`), 1400 x 900 real Chrome window:

| | |
| --- | --- |
| `document.visibilityState` | **`visible`**, `document.hidden === false` |
| rAF callbacks | **7,921** in 91.4 s |
| `GPURenderPassEncoder.draw` calls | **7,859** |
| `GPUQueue.submit` calls | **7,859** |
| `instanceCount` on every draw | **182** |
| distinct colours on the canvas | 7,865 to 7,959 over 921,600 pixels |
| achieved frame rate | about 86 fps |

182 is arithmetic rather than a plausible-looking number: 140 floor tiles
for the 14 x 10 lot, 8 interior wall tiles from `content/lot.toml`, 25
boundary panels (10 west, 14 north, 1 corner) that `tiles.ts` adds because
the simulation treats the lot edge as solid, then 8 smart objects and 1
sim. 140 + 8 + 25 + 8 + 1 = 182.

**[O3] The two instruments agree, which is what makes [O1] usable.** The
browser was also driven for 151 s with `GPUQueue.prototype.writeBuffer`
wrapped, recording the sim's screen position on all **12,526** frames it
uploaded. The sim was stationary on **50.7%** of those frames; the headless
trace over the same configuration says stationary-or-eating is **52.6%**.
Individual events line up too: the trace has the sim reach the fridge at
tick 49 and leave at tick 76, and the browser shows it pinned at screen
(576, 216) from 6.0 s to 7.9 s. The trace has it finish its first stroll
around tick 109 and set off again at 130; the browser shows it pinned at
(640, 344) from 11.4 s to 13.2 s. **So the headless trace is a faithful
description of what a viewer sees, and everything below can be quoted from
it.**

One console error appears on load and is benign: a 404 for
`/favicon.ico`, which nothing references and the browser requests anyway.

---

## What it actually looked like

### [F1] It does not dither, and it cannot - which is its own problem

Dithering was the failure to look for: re-deciding every tick while
standing still is the characteristic pathology of weighted selection and
looks worse than argmax ever did. **It does not happen, at all.** Over
12 000 ticks there were 122 decisions and 121 interactions: essentially
every decision was carried through to the thing it decided on.

That is structural rather than lucky. `select_action`'s query is
`Without<Target>`, so the moment a sim commits, it stops being considered
at all until the interaction finishes. There is no mechanism by which it
can change its mind.

**The flip side is that it over-commits, and that will read as
obliviousness long before dithering would have read as indecision.** A sim
that sets off for the bookshelf on the far side of the lot walks for four
seconds, reads for five to nine, and only then reconsiders - during which a
need that becomes critical is simply not looked at. In the shipped lot the
longest single commitment observed was a 24.1-second sleep, and during a
walk-plus-sleep the sim is unreachable for over 30 seconds of real time. It
never bit during these runs because nothing ever becomes critical (see
[F5]), but the moment the balance makes anything urgent it will, and it
will look like the sim is ignoring an emergency rather than choosing to.

### [F2] Wandering reads as commuting, not as idling

This is the clearest "wrong in a way no test would catch".

`roll_wander_path` draws a destination uniformly over the whole grid, so on
a 14 x 10 lot the average stroll is **10.9 tiles**, with a maximum of 17.
At 0.25 tiles per tick that is 4.4 seconds of purposeful walking, followed
by a 2-second pause, followed by another traverse. The sim marches corner
to corner and back. Watching it, the movement is indistinguishable from
walking to an object - same speed, same straight-through-the-room path,
same arrival-and-stop - and the only thing that tells a viewer it was
idling is that nothing happens at the end.

Idling should look local: a couple of tiles, a turn, a drift. This looks
like someone with an errand.

**There is no knob for it**, and that is deliberate rather than an
oversight: [D-5] specifies "a random reachable tile" with no notion of
locality, so bounding the roll to a radius around the sim is a design
change and not a tuning one. Recorded here as the highest-value change to
the wander system, not made in this pass.

### [F3] It reads as having priorities, but only just, and the reason is measurable

The design's claim is that because urgency is cubed, "desperate sims look
decisive, comfortable ones whimsical" and the randomness self-regulates.
**Half of that was true and half was not, and the half that was not is
about scale.**

Softmax is exponential in the *difference* between scores, not in their
ratio, so the number that matters is the gap between the top two
candidates. `content/tuning.toml` was tuned against a guessed gap of 0.165.
Measured over 12 000 ticks the gap is **0.0045 at the 10th percentile,
0.032 at the median and 0.142 at the 90th** - the guess sits above the 90th
percentile of what the game actually produces. At the shipped 0.15 that
made an ordinary decision a coin toss. The single clearest instance, taken
verbatim from the trace at the old settings:

```
t2789  DECIDE from (12,7) -> television (p 0.191) of 6 candidates
            fridge       grab_snack     d   17  score   0.08019  p  0.161
            shower       take_shower    d   13  score   0.06915  p  0.149
            toilet       relieve_self   d   15  score   0.08791  p  0.169
            bookshelf    read           d   13  score   0.06286  p  0.143
            sofa         lounge         d   10  score   0.10238  p  0.186
            television   watch_tv       d    7  score   0.10621  p  0.191
```

Six options spanning p 0.143 to p 0.191. The *ranking* is meaningful - fun
was the sim's lowest need and the two fun objects are on top - but the
*choice* carries almost none of it. That is not whimsy, it is a six-sided
die with the numbers written very faintly on it.

The worst-looking single decision at the old temperature:

```
t1834  DECIDE from (13,1) -> sink (p 0.128) of 3 candidates
            fridge       grab_snack     d   14  score   0.27644  p  0.549
            sink         wash_hands     d   12  score   0.05867  p  0.128  <-- taken
            shower       take_shower    d    2  score   0.19700  p  0.323
```

Hunger 21 out of 100, the fridge scoring 4.7x the sink, and the sim went to
wash its hands. Hunger was down to 13 before it ate. On screen that is a
sim being stupid, not a sim being spontaneous.

At the retuned 0.06 the same shape of decision comes out as a preference:
a 4.7x score gap now takes the better option about 77% of the time instead
of 55%, while a genuine near-tie stays a near-tie. Over 12 000 ticks the
sim still declines the top-scoring option on **13 of 122 decisions**, so it
is emphatically not argmax with extra steps.

### [F4] It stood perfectly still for a quarter of the run, which is what [D-5] existed to prevent

`idle_threshold` and `action_threshold` bracket a dead band in which a sim
neither acts nor strolls: it stands motionless. The two were 0.02 and 0.05.

**Measured: the sim's best available score spends its entire life inside
that band.** On the ticks where it was free to choose, the best score it
could see anywhere was 0.014 at the 5th percentile, 0.039 at the median and
0.049 at the 95th - the distribution is clipped from above by the action
threshold, because the sim acts the instant anything crosses it, and it
essentially never falls below 0.02. So **91% of free ticks landed in the
dead band**, the sim was motionless for **22.9% of the whole run** in
stretches of up to **15.8 real seconds**, and it wandered on 1.3% of ticks:
three strolls in ten minutes, all three inside the first minute.

The concrete instance, from the trace: after using the toilet at tick 556
the sim stood in the bathroom without moving until tick 693, 13.7 real
seconds, and then used the toilet again.

[D-5] shipped, was tested, and was almost never reached in play. Its test
`a_sim_with_nothing_worth_doing_walks_somewhere_instead_of_standing_still`
is correct and passes; it uses a sated sim in a one-object room, which is a
state the shipped lot reaches for about a minute at start-up and then never
again.

### [F5] The sim never gets into trouble, so the interesting half of the design never fires

Across 20 minutes, the lowest any need reached was energy 33, fun 21 and
hygiene 42 out of 100 - and those are at the *retuned* settings, which let
it run lower than before. It is never desperate about anything. With eight
objects on a 14 x 10 lot and a cubed urgency, it tops every need up long
before any of them becomes pressing.

The consequence for this milestone specifically: **the "desperate sims look
decisive" half of [D-2] is real in the code and invisible in the shipped
lot.** Decisiveness needs a large score gap, a large gap needs a large
deficit, and the sim never has one.

Raising `action_threshold` was the obvious response and **it was tried and
it is wrong.** At 0.12 (with `idle_threshold` moved to 0.10 to keep the
band proportionate) the needs did run lower - energy to 33, fun to 21 - but
multi-candidate decisions fell from 33 to 19 of ~120, standing-still time
rose from 14.2% to 22.3%, and wandering rose to 16.1% of the run. Raising
the bar does not cluster the needs into competition; it just delays each
one separately, because they decay at different rates and cross whatever
bar is set at different times. **The hypothesis predicted more competition
and the measurement produced less, so it was dropped.** The settings were
returned to 0.05.

The real lever is content: fewer objects, a larger lot, or faster decay.
None of those is a tuning knob and none was touched here.

### [F6] Meals were metronomic for the majority of interactions, and delivered up to 3x what they advertise

[D-4] exists so that repeated actions are not identical. **It was inert for
61% of them.**

The floor was 25 ticks (2.5 s). An interaction's sampled length spans
`duration_ticks * (1 +/- duration_variance)`, so with variance 0.4 the
fridge's band is 9 to 21 ticks, the toilet's is 7 to 17 and the sink's is 5
to 11. **All three bands lie entirely below 25.** Measured over ten
minutes: the fridge ran for exactly 25 ticks on all 11 occasions, the
toilet on all 17, the sink on all 3 - 31 of 51 interactions with zero
variance, and they are the three most-used objects in the house.

There is a second, quieter consequence. `tick_interactions` fills at
`delta / duration_ticks` per tick, using the **content** duration, which is
correct - it keeps benefit-per-tick equal to the quantity that was scored.
But a floored interaction runs longer than its content says, so it delivers
`floor / duration_ticks` times its advertised benefit: the fridge gave
**67 hunger instead of 40**, the toilet 198 instead of 95, the sink 69
instead of 22. A snack was refilling two thirds of the entire need.

The condition for the floor to be inert is arithmetic and worth stating
once:

```
duration_ticks >= min_interaction_ticks / (1 - duration_variance)
```

which at the shipped variance of 0.4 and the new floor of 12 is **20
ticks**. Of the eight shipped objects, five clear it and three do not.

**A floor that binds is a duration, not a floor.** That is the finding.

---

## What was tuned, and why

Three knobs in `content/tuning.toml`. Every number below is from the traces
described above; the file now carries the same measurements next to the
values so the next person tunes against data rather than against taste.

### [T1] `choice_temperature` 0.15 -> 0.06

Because of [F3]. 0.15 was tuned against a guessed top-two score gap of
0.165, and the measured gaps are 0.0045 / 0.032 / 0.142 at the 10th, 50th
and 90th percentiles. Stated for two candidates so the arithmetic is
checkable:

| gap | at 0.15 | at 0.06 |
| --- | --- | --- |
| p10, 0.0045 | 51% | 52% |
| median, 0.032 | 55% | 63% |
| p90, 0.142 | 72% | 91% |

A close call stays a close call and a clear one becomes clear. Not lower
than 0.06: `a_higher_scoring_object_is_chosen_more_often_and_a_lower_one_still_sometimes`
runs 500 seeded trials at the shipped temperature and counts how often the
worse object still wins. That count went from 129 to **29**; at 0.03 it
would be about 2, and `wins.1 > 0` would become a coin toss over the seed
range rather than an assertion. The test now says so in a comment.

0.06 rather than 0.05 for a second reason:
`the_shipped_pack_carries_the_authored_tuning` asserts every knob and
relies on all seven values differing, so that a transposed pair moves it.
0.05 would have collided with `action_threshold` and silently disarmed
that.

### [T2] `idle_threshold` 0.02 -> 0.04

Because of [F4]. The measured median of the sim's best available score is
0.039, so 0.04 puts the wander threshold just above the middle of the
distribution instead of far below all of it.

| | 0.02 | 0.04 |
| --- | --- | --- |
| free ticks inside the dead band | 91% | 44% |
| motionless share of the whole run | 22.9% | 8.9% |
| longest motionless stretch outside an interaction | 15.8 s | 6.9 s |
| ticks spent wandering | 1.3% | 9.6% |
| strolls per ten minutes | 3 | 24 |

**Not higher.** At 0.045, measured as a matched pair against 0.04 - same
seed, same length, only this knob moved - the dead band closes from 44% to
18% of free ticks while the total motionless share only falls from 16.8% to
14.7%, because a wander *pause* is also standing still and the frozen time
simply becomes paused time. That is two points of stillness in exchange for
most of what the second knob exists to express, so the band was kept.

### [T3] `min_interaction_ticks` 25 -> 12

Because of [F6], and this is the balance decision the previous task flagged
about the fridge's 67 hunger.

Two coherent answers existed. Raise the short `duration_ticks` in
`objects.toml` so the floor stops reaching them, or lower the floor. The
floor was lowered, for a reason rather than for convenience: **it was
binding on the majority of interactions, so it was not acting as a safety
net but as the thing that set their length and inflated their benefit.**
Raising the content numbers to clear a 25-tick floor requires every
interaction to be at least 42 ticks (4.2 s), which would have destroyed the
sink's whole design role as the fast, cheap alternative to the shower, and
would have cut every affected object's score by roughly a third through the
duration term in the denominator.

Measured after the change: the fridge samples 12 to 20 ticks and averages
**14.4** against its declared 15, so it now delivers about **38 hunger
against its declared 40**. The over-delivery is gone. Floor-bound
interactions fell from 31 of 51 to 49 of 121.

1.2 s rather than 2.5 s is a real loss of the original stated intent, and
it is accepted knowingly: 2.5 s was chosen a priori and measured badly.

### [T4] Deliberately not changed

`action_threshold` (0.05), `duration_variance` (0.4), `wander_pause_ticks`
(20), `wander_attempts` (8), `rng_seed`, and the seven `decay_per_tick`
rates.

- `action_threshold`: tried at 0.12, measurably worse. See [F5].
- `duration_variance`: at 0.4 the bed varies from 10.8 to 24.1 real
  seconds, which is the widest visible spread in the game and reads as
  variety rather than error. Raising it would widen the sub-floor bands
  without lifting them.
- `wander_attempts`: 8 is ample. Over 12 000 ticks only 31 rolls failed to
  find a reachable tile, and a failure costs one stationary tick.
- `wander_pause_ticks`: cannot be judged usefully until [F2] is addressed,
  because a pause between two room-crossings is not the same thing as a
  pause between two shuffles.

---

## Things a knob cannot fix

### [C1] The sink can never vary, and that is content - FIXED

**Status: fixed.** It landed in "Make actions long enough to see, and stop
lying to an outbid sim": the sink went from 8 ticks to **21**, the toilet
from 12 to **24**, the fridge from 15 to **30**, all clear of the 20-tick
line with margin. The finding is left in full below, because what it got
wrong is worth more than what it got right.

**What it got right.** The line and the arithmetic behind it, and the
prediction that both world-hash golden vectors would move. They did, and
they were confirmed on wasm32 by rebuilding and reading the failure rather
than by copying the native value.

**What it missed, and it is the whole difficulty.** The finding frames this
as a duration change, and a duration change on its own would have been a
worse bug than the one it fixed. Raising the sink's duration moves its
score denominator from `4d + 9` to `4d + 22` while the shower keeps its 45
and loses nothing, which dropped the sink from 6 interactions to 1. That
trades a metronome for a piece of furniture. The sink's hygiene delta had
to move with it, 22 to 32, and at 32 the two score within about 2% of each
other, so which one a sim picks turns on how tired it is - which is what
the object was always documented to do.

**Read that as a rule rather than as an anecdote: a duration is not
tunable on its own when the object's entire role is a comparison against a
rival.** The floor was clipping three interactions and the fix touched
four numbers, because the third of them had a competitor and the other two
did not.

**It is now unrepresentable rather than merely fixed.**
`ContentError::ClippedDuration` fails `cargo build` for any interaction
whose sampled band bottoms out below `min_interaction_ticks`. It is the
project's first cross-file content rule, and it has to be: the duration is
content, both knobs are tuning, and neither file is wrong on its own.
`no_shipped_interaction_is_clipped_by_the_interaction_floor` in
`crates/terri-data/src/compile.rs` is the shipped-content half of it.

One existing test had been quietly resting on the bug.
`an_interaction_shorter_than_the_real_time_floor_is_stretched_up_to_it` in
`crates/terri-sim/src/systems/interact.rs` used the sink *because* shipped
content happened to carry a clipped interaction; its own precondition
caught that the moment the content moved, and it now builds a fixture. No
shipped object can serve that test again, and the build would fail before
one could.

The original finding follows, unedited.

Its band tops out at 8 x 1.4 = 11 ticks, so any floor a player can see
clips all of it, and a floor below 12 is under 1.2 seconds. It ran for
exactly 12 ticks on every one of its interactions after the retune, and it
delivers 33 hygiene against its declared 22. The toilet is nearly as bad at
12 ticks centre. **Fix: raise `duration_ticks` in `content/objects.toml` to
at least 20 for the sink, toilet and fridge**, which is
`min_interaction_ticks / (1 - duration_variance)`. That is a balance change
that moves both world-hash golden vectors and shifts every affected score
denominator, so it belongs in its own task rather than in a feel pass.

### [C2] `social` is unsatisfiable and pinned at zero

No object in `content/objects.toml` advertises `social`. It decays at 0.035
a tick like everything else, reaches zero at about tick 2 857 - **4.8
minutes of play** - and stays there for the rest of the run.

Nothing scores it, so it has no behavioural effect today and nothing in the
suite has any reason to notice. It becomes visible the moment M1b's
remaining need-bar task lands: the player will see a bar that is always
empty, that no action in the game can fill, with no explanation. Either an
object must advertise it or the need should not be declared yet.

**Resolved, 2026-07-29.** The television's `watch_tv` now advertises
`social = 24.0`. The alternative - dropping `social` from `content/needs.toml`
until something can satisfy it - was rejected on cost rather than on
principle: removing the `NeedId` variant renumbers `Fun` and `Comfort`
across six files including two byte-level golden fixtures, and M2 puts the
variant straight back. The advert is a placeholder and is commented as one;
`social` is meant to be satisfied by other sims, which is M2.

Measured the same way as everything else here - matched pairs over 12 000
ticks of the shipped lot with the [O1] agent, only the delta moved:

| delta | social band | television's share |
| --- | --- | --- |
| none | 0 from tick 2 857 on, 9 143 ticks pinned | 6.6% (8 of 121) |
| 8 | 0 on 699 ticks, mean 8.3 | 30.1% (44 of 146) |
| 14 | 21-52, floor 17.1, mean 36.9 | 21.1% (28 of 133) |
| **24** | **33-69, floor 30.0, mean 48.9** | **14.4% (18 of 125)** |

**The surprise is the direction.** A smaller delta makes the television MORE
dominant, not less, which is the opposite of what "keep the placeholder
subtle" predicts. Urgency is cubed, so equilibrium sits where
`delta * deficit^3 / time_cost` matches whatever else the sim could be
doing: halving the delta buys back only a cube root of deficit, and the sim
holds `social` lower *and* visits more often, because each visit delivers
less. At 24 every other need is back to roughly its no-advert level - hygiene
79.0 against 79.2, bladder 72.6 against 75.7, 125 interactions against 121 -
while `social` holds a live band. It is still the lowest need in the house by
14 points, which is the intended reading rather than a shortfall.

Neither world-hash golden vector moved, on either target, and that was
predicted rather than discovered: `build_scenario` holds one object and it is
the fridge, so no television advert can reach the digest. Same [L36] shape as
the three knobs in [C3] below.

The gap this exposed is now a build-time rule.
`every_declared_need_can_be_satisfied_by_some_interaction` in
`crates/terri-data/src/lib.rs` fails if any declared `NeedId` has no
interaction advertising a **positive** delta for it. Positive rather than
merely present, because a negative delta is legal content - the shower's
`energy = -12.0` is a cost - and a need that can only ever be drained is
exactly as unfillable as `social` was.

### [C3] An agent beaten to an object is told nothing is worth doing - FIXED

**Status: fixed.** The core of it landed in "Make actions long enough to see,
and stop lying to an outbid sim"; what a sim then DOES about a contested
object became a tuning knob in the change that added
`contested_score_multiplier`. The finding is left in full below because the
corrections after it are worth more than the fix.

`select_action` skips an object already `claimed` this tick **before** it
folds that object's score into `best_seen`. So a sim whose only worthwhile
option was taken by a lower-indexed sim comes out of the loop with
`best_seen` at negative infinity, is marked `Restless` - which means
"nothing this agent can reach scored above `idle_threshold`", and is false
- and strolls away.

Unobservable today, because the shipped page has one sim. It is the first
thing that will go wrong when there are two, and it will present as sims
wandering off from things they wanted rather than waiting near them.

It is also why the world-hash golden vectors did not move for any of the
three knobs above, which is worth recording because [L36] says an unchanged
golden vector after a deliberate behaviour change is a finding rather than
a relief. `build_scenario` has eight agents and one object: agent 0 claims
it and the other seven see an empty candidate list, so they are `Restless`
at *every* value of `idle_threshold`. That fixture is blind to this knob,
as it is already known to be blind to candidate ranking and candidate
sampling. The vectors are unchanged because the scenario cannot express the
change, not because the change is inert.

**What the knob adds, and why it is a knob at all.** The core fix made a
contested object visible to a sim again; on its own that means every outbid
sim waits, however little it wanted the thing.
`contested_score_multiplier` attenuates a contested object's score, so waiting
becomes proportional to wanting: a sim that badly wants the busy bed stands its
ground, and one that barely wants it strolls off as before. A `Blocked` marker
records "the best thing I can see is somebody else's", which can be true at the
same time as `Restless` - that pair means "wanted it, not enough to wait".

**It is the only knob in `content/tuning.toml` with no measurement behind it**,
and the file says so beside the value. None is possible until content ships two
sims; the shipped page has one, so nothing in the game can produce the
distribution the number should be tuned against.

**The correction this forces, and it is a finding rather than bookkeeping.**
The paragraph above says the eight-agent one-object reference scenario is blind
to `idle_threshold`, because its seven losers are restless at every value of it.
That held only while their scores were discarded before anything could be
compared against them. **It is no longer true.** Measured at tick 100 across
four values of the new knob, the scenario produces four different world hashes,
and at a multiplier of 1.0 it reproduces the pre-knob hash exactly - which is
the arithmetic working out, since 1.0 attenuates nothing. The fixture is now
sensitive to the knob and to `idle_threshold`. Nobody tuned it to achieve that,
and the instruction not to still stands: it gained coverage because the code
stopped throwing away the number it was supposed to be measuring.

**The cost of the shipped 0.75, stated rather than smoothed over.** In that
reference scenario only one of the eight sims still wanders. With one object
and no alternative, waiting is nearly all they can do, so it is the worst case
for the standing-still problem [F4] measured. The shipped lot has eight objects
and a blocked sim there usually has something else above `action_threshold`;
the freeze needs *every* alternative to be below the bar.

### [C4] The television does not read as a television

Minor, but visible in every screenshot: `cabinetTelevisionDoors` renders as
a flat plank lying on the floor at this scale. Contrast the sofa, bed and
shower, which are immediately legible. An art or content-mapping issue
rather than a simulation one.

### [C5] Repeating the same object back to back

After finishing, a sim is standing *on* the object, so its distance term is
zero and that object's score is at its maximum - which makes an immediate
second use quite likely. It happened on 7 of 121 interactions. At 5.8% it
reads as plausible ("it went back for seconds") rather than as a bug, so
nothing was changed, but it is the mechanism to look at first if the rate
ever climbs.

### [C6] The bookshelf is now never used at all

Found while measuring [C2]'s fix, and recorded rather than absorbed. Before
the television advertised `social` the bookshelf was used **3 times in 12 000
ticks** - already the least-used object in the house by a factor of four.
After, it is used **zero** times, and that holds at every delta tried,
including the 8 that made the television *most* dominant. Any pull toward
the television is enough to squeeze it out entirely.

The bookshelf exists to be the low end of the fun range, so that the three
fun objects span a real spread instead of clustering ([content/objects.toml]).
At zero uses it is not the low end of anything: it is furniture the sim walks
past, and the spread it was authored to create is between the television and
the sofa only.

Two things worth separating. It is **not** what [C2]'s new test catches -
`fun` is still advertised by the television and the sofa, so the need remains
satisfiable, and "an object nothing ever chooses" is a different invariant
from "a need nothing can satisfy". It is also not statically checkable at
all: whether an object is ever chosen is a property of a 12 000-tick run
against a particular lot and seed, not of the compiled pack. The closest
existing check is `every_declared_object_is_placed_on_the_lot`, which the
bookshelf passes.

Fixes worth weighing, none applied here: raise its `fun` delta above the
sofa's 18 so it wins something; shorten its 70-tick duration, which is the
longest of the three and the term dividing its score; or move it, since it
sits at (1, 5) while the sofa and television share the south wall. All three
are balance changes that move both golden vectors' *inputs* without moving
the vectors, and belong in a content pass rather than here.

---

## The one-line answer to each question the task asked

- **Does it read as having priorities, or as erratic?** It was erratic, for
  a measurable reason ([F3]), and the temperature retune fixes the
  ordinary case. The *decisive* extreme is never reached in the shipped lot
  and that is a content problem ([F5]).
- **Does it dither?** No, and it structurally cannot. It over-commits
  instead ([F1]).
- **Does wandering read as alive, or as drunk?** Neither. It reads as
  commuting: 10.9-tile traverses on a 14-tile lot ([F2]).
- **Do meals feel the right length?** They did not: 61% of interactions ran
  for exactly the floor with no variance, and delivered up to 3x their
  advertised benefit. The floor is now 12 ticks and the fridge delivers
  what it advertises; the sink still cannot ([F6], [C1]).

---

# M1b Task 8: Directing a Sim

A second session, appended rather than replacing the M1c pass above. That
one asked whether the sim's *own* decisions read well. This one asks whether
**taking control of it** feels like anything, which is the question M1b was
built to answer.

Same rule as above: nothing here is a test result, and where a claim has a
number behind it the number is given.

## How this was observed

**[P1] The Browser pane was never displayed, so nothing composited.** That
is [L14] again and it is not a footnote: with no compositing there is no
`requestAnimationFrame`, with no rAF there are no frames, with no frames
there are no ticks, and with no ticks a command sits in the staging queue
for ever. A click cannot be verified by clicking and looking.

So the session drove the real frame body directly through the `?stress`
harness, dispatching **real `MouseEvent`s at real canvas coordinates** into
the real listeners, against the real WASM simulation, and read the result
out of simulation state rather than off the screen. Every number below comes
from that. Two things had to change before it worked, and both are worth
recording because both produced convincing wrong answers first:

- **[P2] `step()` fabricated its own clock.** It read `performance.now()`
  internally, so stepping in a loop passed deltas of roughly zero, the
  fixed-step accumulator never filled, and the simulation advanced almost
  nothing while `timer.frames` climbed to 250. The first run of this session
  reported that *every* click was ignored and the sim was frozen. Both were
  artefacts. `step(nowMs?)` now lets a behaviour harness supply a monotonic
  clock, and the default is unchanged so the M0 timing gate still measures a
  real frame. This is [L14]'s failure mode with the numbers *moving*, which
  is materially harder to spot than the frozen version.
- **[P3] The harness required a second sim to exist.** The handle was gated
  on `?stress=N` with `N > 0`, so the only way to get it was to add filler
  agents - which contend for object reservations with the sim being
  measured. The gate is now the parameter's *presence*, so `?stress=0` gives
  the harness on the world the player actually gets.

**What this session therefore cannot say anything about: how it looks.** The
wall seams, the sim standing on furniture rather than beside it, and the
general readability of the scene are all unexamined here, because no frame
was ever presented. That needs a displayed pane and a human.

## What works

**[P4] Every binding does what it says, verified against simulation state.**
Clicking a sim sets `Selected` on that sim and opens the need panel;
clicking an object makes the selected sim walk to it; clicking bare floor
clears the selection; right-clicking hands the sim back to autonomy. The
cancel is the most legible of the four: a sim walking east under orders
(x = 2.0 to 5.75) reversed and went back west to x = 1.0 after the right
click, which reads unmistakably as being released rather than as stopping.

**[P5] Directing a free sim is effectively instant: 0.2 to 1 tick.** Across
four measurements the first position change came 1 to 6 frames after the
click - 20 to 100 ms - which is at most one tick, the soonest anything can
happen by construction. There is no input lag to chase here.

**[P6] A click preempts an interaction already running, on the tick it
arrives.** This one is *not* a measurement, deliberately - it is now
`a_click_preempts_an_interaction_already_running` in
`crates/terri-sim/src/systems/command.rs`, because from outside the
simulation it was indistinguishable from its opposite (see [P8]) and because
the multi-step interaction design depends on which of the two it is.
`docs/specs/2026-07-29-multi-step-interactions-design.md` [M-4] argues that
terminal-only satisfaction plus immediate preemption means a mis-click can
destroy a whole cooking chain, and therefore that chain progress must be
stored state. That argument rests on preemption being real. It is.

## What did not work in this session

**[P7] A click can be discarded with no way for anything to know - and it
is reachable with a mouse.** This is the session's one real finding.

There are two caps and they fail differently. `max_queued_commands` (64)
bounds the WASM staging queue and `enqueue_command` returns `false` when it
refuses, so that one is at least *observable*. `max_queued_intents` (4)
bounds what one sim may be told to do, and it is enforced **inside
`drain_commands`**, one tick later, by an `if queue.len() < cap` that drops
the intent and returns nothing to anybody.

Measured: eight `useObject` calls in one burst were **all eight accepted**
by the bridge - every one returned `true` - and four of them were then
thrown away silently. The boolean the shell gets back reports that the
*command* was staged, not that the *instruction* survived. There is no
return path from the drain to the shell, so this is not something the shell
is failing to check; it is a channel that does not exist.

The `content/tuning.toml` comment at the time named this exact outcome as the
thing to avoid, in its own words: the fifth rapid click "does nothing at all,
and a click that does nothing is the exact failure [D-3] exists to prevent."
It was reachable by leaning on the mouse.

Worth adding: `input.ts` then discarded the return value of every command it
sent, so even the *observable* half - a full staging queue, easiest to reach
while paused because nothing drains at speed 0 - was thrown away. Fixing that
was the smaller half. The larger half needed a decision rather than a patch:
either the drain had to report refusals back across the boundary, or the shell
had to stop over-promising by refusing the click itself at the cap.

**Resolved 2026-08-08.** The simulation drain now records each resolved object
or social order refused at `max_queued_intents`. The shell consumes that count
after either a full tick or a paused command-only flush and reports `That
person's order queue is full`. Command enqueue still owns malformed bytes and
the separate staging cap; it does not guess at per-sim capacity before ordered
cancellation, replacement, and append commands run.

**[P8] From outside the simulation, a sim *using* an object and a sim
*loitering on* an object's tile are the same picture, and it corrupted the
first pass of this session.** Position is all the render buffer exports, and
both states put the sim on the same tile at the same integer coordinates.
Classifying "busy" as "standing on an object tile" produced click latencies
of 2, 4, 4, 5, 14, 16, 43 and **124 ticks** - up to 12.4 real seconds - and
the natural conclusion was that clicks on a busy sim were being ignored for
a very long time. That conclusion was wrong; the sim in those cases was
idle, and what varied was something else entirely.

Two consequences, and the second is the important one:

- The measurement had to be redone against a need actually *rising*, which
  is the only externally visible sign of an interaction.
- **A player is in exactly the same position as the harness was.** A sim
  standing on the sofa looks identical whether it is using the sofa or has
  finished and not moved. This is the user-reported "sim overlaps the
  furniture" problem seen from the simulation side rather than the rendering
  side, and it stops being cosmetic here: multi-step interactions are a
  *sequence* of steps at different objects, so "which step is this sim on"
  becomes something the player has to be able to read. An idle pose, an
  adjacent standing tile, or a progress indicator - one of them becomes
  necessary rather than nice.

## Left open

**[P9] Whether the sim thrashes between objects is still unmeasured.** The
attempt logged which object tiles the sim stood on, which counts *walking
over* a tile as visiting it - on a 14 x 10 lot with four objects in a row
along y = 1, a single traverse registers as three visits. The trace read
`2, 1, 0, 1, 2, 3, 7, 5` for a queue of `0..7`, which is unreadable: it
mixes queued intents, autonomous choices made after the queue drained, and
tiles merely crossed. Answering it needs the interaction *start* to be
observable, which is the same gap [P8] describes.

**[P10] The visual pass.** Unexamined, per [P1].

## The one-line answer to each question the task asked

- **Does directing it feel responsive?** On a free sim, yes - 20 to 100 ms,
  at most one tick ([P5]). On a busy sim it interrupts immediately too
  ([P6]). The responsiveness problem is not latency; it is that the fifth
  click in a burst is silently discarded ([P7]).
- **Does anything about the decision-making look wrong in a way the tests
  would not catch?** Yes, and it was caught the hard way: nothing in the
  render buffer distinguishes a sim working from a sim standing about, so
  neither a test nor a player can tell them apart ([P8]).
- **Does it thrash between objects?** Not answered, and the note says so
  rather than guessing ([P9]).

---

# Alpha Pass: the deferred bugs, measured

The M1c and M1b sessions above each ended with a list of things a knob could
not fix. This is the pass that fixed them, and the measurements come from
`cargo run -p terri-sim --example trace -- 12000` - **which is now in the repo**
rather than rebuilt from scratch each time, per [L40].

Every number below is the same 12 000-tick run of the shipped lot with the
agent `web/src/main.ts` spawns.

## [A-1] The headline: the sim spends its time differently

| | M1c baseline | after durations | after adjacency | after slower needs |
| --- | --- | --- | --- | --- |
| interactions | 124 | 127 | 126 | 94 |
| walking | 47.4% | 45.1% | 41.8% | 39.0% |
| interacting | 40.4% | 46.0% | 46.1% | 35.5% |
| motionless | 12.2% | 8.9% | 12.0% | **25.4%** |
| repeats [C5] | 5.8% | - | 5.6% | 3.2% |

The middle two columns are the improvement: more of the sim's life spent
visibly doing something and less spent milling about. **The last column undoes
part of it**, and that is the honest cost of slower needs rather than a
regression to hunt - a sim whose worst need sits at 35% has no reason to hurry.
`idle_threshold` is the knob that trades it back, and diminishing returns
([N4] in `docs/specs/2026-07-29-needs-modulation-design.md`) is the mechanic
that would fix it properly by making variety worth more than repetition.

## [A-2] What each fix actually did

**[C1] Clipped durations - fixed, and made unrepresentable.** The sink declared
8 ticks and 22 hygiene, ran for exactly 12 on 6 of 6 measured interactions, and
delivered 33. Now 21 ticks and 32 hygiene; measured **13 to 24, mean 17.3**. The
fridge and toilet were clipped at the bottom of their bands and are now 30 and
24. No interaction is pinned any more, and `ClippedDuration` in terri-data fails
the build for any that would be.

**The per-object numbers in this section were re-measured after a review found
them stale.** They had been taken before the adjacency change and before the
decay retune, both of which landed later on the same branch, and [L40]'s rule is
that a disagreeing re-measurement means re-deriving rather than defending. The
current figures are in `content/tuning.toml`.

**The sink needed its delta raised too, and that is not cosmetic.** Raising the
duration alone moved its score denominator from `4d + 9` to `4d + 22` while its
only competitor - the shower - kept its 45 and lost nothing. Usage fell from 6
interactions to **1**, which is within a rounding error of the bookshelf's zero.
Fixing a duration by turning the object into furniture is not a fix.

**And then the decay retune moved the goalposts again, which I did not
re-check.** The delta of 32 was justified on the two scoring within about 2% of
each other, so that the choice would turn on how tired the sim is. Measured
after the retune: **3 sink uses against 9 shower uses**, and the sink's share of
all interactions down from 11.8% before the pass to 3.2% after. The
justification does not survive its own follow-up change, and a review caught it.

Recorded rather than fixed with a third delta. Two objects are now near-unused
for one shared reason - nothing makes repetition less attractive - and
habituation is the mechanic aimed at it. Raising numbers until an object wins on
merit it does not have is the fix already rejected for the bookshelf in [C6].

**[C3] The outbid sim - fixed, both halves.** The notes described the
within-tick case. The longer-lived half was the object query filtering
`Without<Reserved>`, so a sim waiting on the only fridge never saw it at all and
was told nothing was worth doing for the whole of the other sim's walk *and*
interaction. Not visible on the shipped page, which has one sim; the first thing
that would have broken with two.

**Sims stand beside objects now, not on them.** Verified in the browser against
real WASM: across 3 000 ticks the sim came to rest 7 times and stood on
furniture 0 of those times. This was reported as a visual complaint and was a
movement bug.

**[C5] Repetition - diluted three times, never fixed.** 5.8%, then 5.6% after
adjacency, then 3.2% after the retune. Adjacency was *supposed* to help, on the
theory that a finished sim standing at distance zero from what it just used sees
that object at its maximum score. It did not: the score divides by
`4 * distance + duration + 1`, so moving from distance 0 to 1 costs the fridge
about 12%, and every other object came a tile closer at the same time. The claim
is now recorded in `find_path_adjacent`'s docs as withdrawn, with the number, so
nobody makes it again.

**[C6] The bookshelf is still used zero times.** Unchanged by everything here.
It is waiting for diminishing returns; raising its numbers until it wins on
merit it does not have is the wrong fix.

## [A-3] The input bug the tests could not see

**Clicking the sim did not work, and every test passed.**

Picking inverted the projection to a tile and asked what stood there, which is
right for "walk to this spot" and wrong for "click that sim": sprites are
bottom-anchored and far taller than a tile, so most of a sim's visible body is
drawn 50-plus pixels above the tile it occupies. Sampling nine points down the
sim's own sprite, **three selected it** - the head resolved two tiles away, the
feet one tile past.

**Why the tests were green.** They dispatched synthetic clicks at *tile*
coordinates, which is what the code expects rather than what a hand aims at. So
the verification and the implementation shared the same wrong assumption, and
agreed with each other perfectly. It took a person opening the page cold to find
it, and their report - "clicking on anything, anywhere, just does not do
anything" - was exactly right.

Picking now hit-tests the drawn sprite. The regression test samples the sprite
and asserts in the same breath that tile picking MISSES most of it, so the
contrast is what fails if anyone reverts it.

**A second discoverability bug rode along.** The need panel was `hidden` until
something was selected, so the page opened with no readout and nothing
explaining why - and selecting meant finding that small sprite. The page now
selects the sim it spawns.

## [A-4] Walls: two wrongs that compounded

The build script had recorded half of this and concluded there was no fix.

**Wrong sprite.** `wall_*` covers one of Kenney's tile edges, 1.84 of ours, so
one per tile overlapped neighbours by about 27 px. The script's note is correct
that narrowing the width alone is worse - it re-slopes the panel's diagonals
into a picket fence - and concluded the panel had to be used as-is. The kit has
the piece that was wanted the whole time: **`wallHalf_*` is half WIDTH, not half
height**, 57 x 175 against 109 x 212. Scaled uniformly to one tile edge it is
32 x 98: one tile wide, still taller than the 78 px sim.

**Wrong grid, and the bigger half.** Even a tile-wide panel sawtooths if the
panel's top edge and the tile grid climb at different angles, and they did. A
vertical wall's top edge is parallel to the ground edge it stands on, so it
measures the art's ground plane directly: `wall_SE.png` climbs 69 px over
104 px, slope 0.663, against a 2:1 grid's 0.5. Every sprite in the kit was drawn
for a pitch the code did not have, and the error accumulated along a run.

`TILE_HALF_HEIGHT` is now 21 = round(32 * 0.663). The script had considered only
squashing the sprites to fit our grid, which costs 0.69 of every object's
height, and missed reshaping the grid to fit the sprites, which costs nothing.

**Do not measure this off the floor sprite**, which gives 0.72: it is a slab
with side faces, so its widest scanline sits below the top face's midline. That
is where the old "Kenney is about 1.42:1" note came from.

## [A-5] What is still not verified: how any of it LOOKS

**No frame has been seen.** The Browser pane does not composite in this
environment, so there is no screenshot and no aesthetic judgement in this
document. What was verified instead, and it is worth being precise about the
difference:

- the regenerated atlas draws the floor at exactly one tile and each wall at
  exactly one tile edge, both asserted against the projection constant;
- the wall panel's top edge drops 21.0 px across its 32 px width, so a panel's
  top-right corner lands on its neighbour's top-left;
- every vertically adjacent wall pair in the shipped lot chains flush, measured
  through the real bridge;
- the lot occupies 704 x 462 of the 1280 x 720 canvas with room for the tallest
  sprite at the far corner;
- the atlas PNG's real dimensions match what the manifests declare - a gap
  nothing covered before, and every UV in the shader is a fraction of them.

That is geometry, not appearance. The walls are provably flush and the
proportions provably match the source art; whether the room reads as a room
needs eyes on a composited frame.

### [A-6] A new one, found while checking sprite proportions

Every smart object occupies **exactly one tile** in the simulation, regardless
of how wide it is drawn. Measured against the regenerated atlas, with the sim's
78 px as the reference:

| sprite | w x h | tiles wide |
| --- | --- | --- |
| loungeDesignSofaCorner | 152 x 90 | **2.4** |
| bedBunk | 93 x 114 | 1.5 |
| showerRound | 63 x 94 | 1.0 |
| cabinetTelevisionDoors | 59 x 60 | 0.9 |
| wallNS / wallEW | 32 x 98 | 0.5 |

The corner sofa is drawn across nearly two and a half tiles and owns one. So it
visually covers tiles it does not occupy, a sim can stand "beside" it on a tile
the sofa is drawn over, and the reserved-tile logic has no idea. Nothing here
addressed that, and the walls are the only sprite whose drawn width was made to
match its footprint.

That is a **footprint** problem rather than a scaling one: it wants objects to
declare a width and depth in tiles, which is also what build mode will need in
order to stop the player putting two things in the same place. Worth its own
task, and it is not the cause of the reported jaggedness.

**Resolved, 2026-07-30.** `content/objects.toml` takes an optional
`footprint = { width = N, depth = N }` per object, defaulting to 1x1; the tiles
it covers are impassable; `TileGrid::find_path_adjacent` targets the rectangle,
with its heuristic changed to the Manhattan distance to the rectangle's nearest
tile so the optimality argument in its own docs still holds; and three build-time
rules reject overlapping footprints, footprints crossing a wall or the lot edge,
and a lot an object has split into unreachable regions. The decisions are in
`docs/specs/2026-07-30-object-footprints-design.md`.

**Only the bed is declared multi-tile so far, at 2x1.** The corner sofa measured
above is the worse offender at 2.4 tiles and is still 1x1, because widening it
is a lot-layout change rather than a one-line content edit: the shipped lot was
authored against one-tile objects, and re-siting furniture to fit real
rectangles is a separate task. The build gate now makes that visible instead of
silent - a footprint that does not fit fails the build rather than drawing over
a tile it does not own.

Separately, [C4]'s complaint that the television reads as a flat plank is **not**
a scaling error - at 59 x 60 it is proportioned like what it is, a TV cabinet
rather than a screen. That is an asset-choice problem and no projection change
will fix it.

### [A-7] The visual verification, done densely - and the instruments that nearly lied

[A-5] above said the geometry was verified but that "whether the room reads as a
room needs eyes on a composited frame". Part of that was too pessimistic: the
Browser pane does not *present* frames, but the canvas still *draws* them, and
`canvas.toDataURL()` returns a real 208 KB PNG. So the pixels were available all
along and the earlier passes did not look for them.

What that made possible, all measured against the shipped lot through the real
WASM build:

| check | result |
| --- | --- |
| floor tiles, background-coloured gaps | **0** of 672 samples |
| wall runs, empty columns | **0** of 864 columns |
| wall runs, notches deeper than 6 px | **0**, worst 0 px |
| sprite-on-sprite overlaps between placed objects | **none** |
| sim resting on furniture | **0** of 7 resting spots |

The wall scan is the one worth trusting: it walks every pixel column across the
north boundary (15 panels), the west boundary (10) and the bathroom wall, finds
the topmost drawn pixel in each, and looks for a column whose top edge sits more
than 6 px below both of its neighbours. That is what a seam between two panels
would look like. There are none, which is the strongest available statement that
the runs are flush.

**Two instruments were wrong before they were right, and both failures were the
same shape.**

The first pixel test classified "nothing drawn here" as `alpha < 128`. The render
target is **opaque**, so alpha is 255 on every pixel of the canvas, and the test
passed trivially - it reported `paintedCoveragePct: 100`, which is what gave it
away. Rewritten to classify against the background *colour* instead, with the
canvas corners asserted to read as background and the lot centre asserted not to,
so the detector cannot silently invert.

The second was a text render of the frame - the canvas downsampled to a grid of
characters - built to inspect the layout cheaply. It showed apparent **gaps in
the wall runs**, which read as exactly the jaggedness the alpha pass had claimed
to fix. They were artifacts: the grid sampled one pixel per 10 across and one per
15 down, and the classifier binned antialiased edge pixels as background. The
dense per-column scan above is what settled it.

Both are [L3]'s family again, and the lesson is narrower than "test your tests":
**a detector needs a case it must report as negative and a case it must report as
positive, asserted in the same run.** The alpha version had neither. The text
render had neither. The column scan has both, in the form of the empty-column
count next to the notch count.

**What is still not verified, precisely stated.** Nobody has formed an aesthetic
opinion. The geometry is flush, the proportions match the source art, nothing
overlaps and nothing is missing - but "does this look like a room somebody
lives in" is not a measurement, and it is the question the alpha exists to
answer. That belongs to a person looking at
`https://thisnameissoclever.github.io/terrilives/` or a local dev server.

---

## [A-8] The five-room house, and three things a green gate could not see

Goal item 8. The lot went from one open room plus a bathroom, 14 x 10 holding 8
objects, to five rooms, 16 x 12 holding 33. `docs/specs/2026-07-30-the-house-design.md`
carries the decisions; this is what the running game did afterwards, and what
looking at it caught.

**A frame was captured and looked at, which is new.** [A-5] and [A-7] both ended
by saying the geometry was verified but that "does this look like a room somebody
lives in" needed eyes on a composited frame, and that the Browser pane does not
composite ([L14]). It still does not. The way round it is smaller than it looked:
the canvas still DRAWS, `toDataURL()` in the same task as the draw returns a real
322 KB PNG ([L37] is why "same task" matters), and the only thing missing was a
way to get 322 KB out of a `javascript_tool` return value. A 20-line Node sink
using nothing but built-ins - the page POSTs the data URL, the script writes the
file - closed that, with no dependency added.

**It looks like a house.** Five rooms read as rooms, the furniture reads as
furniture at the right scale, nothing overlaps, and the selected sim is legible
with its floor ring. That is a subjective judgement and it is recorded as one.

### Three defects the gate was green for

**1. The wall junctions were broken, and then the fix for them was broken.**

The spine runs east-west across the lot with three north-south dividers hanging
off it, and each junction tile drew a panel turned 90 degrees, so the spine read
as a wall with holes punched in it. Caught by looking at a PNG.

The fix - draw both panels at such a tile - was itself wrong, and this is the
part worth remembering, because it *looked* right in the after-shot. The shader
centres a quad on its anchor, so two panels at one tile occupy the same 32 px
rather than two halves. A pixel diff settled it: the whole frame changed by 726
pixels, all inside the three junction boxes, and one box changed by exactly 356
- which is precisely the count of second-panel pixels falling where the first
panel is transparent, measured independently off the atlas. So 86% of the second
panel was hidden and the junction still read as the wrong orientation.

What ships is a third rule: the run that PASSES THROUGH the junction wins, one
panel per tile. [B5] has the full account.

**2. Three boundary wall panels were being clipped off the top of the canvas.**

`lot.toml` and the spec both carried a derivation for how large the lot could
be: "the tallest sprite reaches 98 px above its anchor, so width plus height
must stay at or under about 28." The lot is 28. Both halves of the derivation
were wrong - the tallest sprite is the 114 px bunk bed, and the arithmetic
reasoned about the tile span while the renderer draws a boundary two half-tile
rows further up again.

Measured: the topmost painted row of the frame was **0**, meaning something was
cut off. After moving the origin from 87 to 144 it is **25**, with the bottom at
710 of 720. `cameraOrigin` in `iso.ts` now centres the drawn extent, reads the
tallest sprite off the atlas, and has four tests including the counterfactual
that the old formula fails.

**3. Fourteen claims in comments were false.** Found by an adversarial review of
the diff rather than by any test. The load-bearing ones were arithmetic: a score
formula written as `urgency^3 * delta` when `urgency` is already the cube (so it
read as `deficit^9`); a pair of quoted scores, "0.66 against 0.71", that no
common distance can produce; "the smallest positive delta in the house" naming a
value that was neither smallest nor current; and five objects whose comments
still quoted the comfort deltas from before they were halved. Also a delta of
7.0 sitting alongside another object's -7.0, which is the sign collision the
file's own rules warn against.

### The behaviour trace

`cargo run --release -p terri-sim --example trace -- N`, one sim, shipped
content, shipped lot.

| | first trace | shipped, 12 000 | shipped, 120 000 |
| --- | --- | --- | --- |
| interactions | 99 | 106 | 1 079 |
| interactive objects at zero uses | **6 of 18** | **4 of 18** | **0 of 18** |
| back-to-back repeats | 1.0% | 1.0% | 0.7% |
| interacting / walking / idle | 42.9 / 40.8 / 16.3% | 43.1 / 39.8 / 17.0% | - / - / 15.8% |
| comfort floor | 60.8 | 50.3 | 47.4 |

The six-at-zero column was the first finding. Every one of the house's five new
comfort objects was unused, and the candidate table gave the reason in one line:
`comfort` sat at level 87, so `deficit^3` was 0.0022, and the armchair - the best
comfort-per-tick object in the house - scored 0.0071 standing right beside it,
against a threshold of 0.05. That is [C6] again with a different need.

**The fix took three passes and the second one overshot.** Halving the five new
comfort deltas fixed the over-supply and created a monopoly: at 23 and 27 per
seat against the pre-existing ottoman sofa's 34-in-50-ticks, the ottoman won
every comfort decision in the house - 72 uses in 120 000 ticks against zero for
the dining table and the long sofa. Matching the *rate* rather than halving the
*delta* is what worked; duration is in the denominator, so the two operations are
not the same. [B6] has the numbers.

### The 12 000-tick horizon is measuring the sample, not the house

The two right-hand columns above are the same content. Four objects at zero
becomes zero objects at zero purely by looking for ten times as long.

That was found by accident, which is the best part of it. Correcting the radio's
`social` delta from 7 to 5 - done for the sign-collision reason above, nothing to
do with balance - moved **five** objects from non-zero to zero at 12 000 ticks. A
two-point change to one object cannot make five others unreachable, so whatever
the zero-set was measuring, it was not those objects.

One sim makes about 106 choices in 12 000 ticks across 18 objects, and the draw
is deliberately skewed - the toilet takes 26.7% because bladder drains fastest.
At 1 079 choices the tail is thin (armchair 2, kitchen sink 1) but nothing is
absent. So the honest statement is: *every object in the house earns its place,
and one sim cannot visit eighteen of them in 12 000 ticks.*

Read the 12 000-tick numbers for feel - that is twenty minutes at 1x, which is
what a player sees. Read the 120 000-tick numbers for reachability. Quoting the
first as the second is the mistake this section exists to prevent.

### Still not verified

Nobody has watched three sims in this house, because there are not three sims
yet. Everything above is one sim, and the two things the house was drawn for -
contention over the single-slot armchair, and the ring giving two sims separate
routes - cannot be observed at all until M2c.

---

## [A-9] Three people, told apart from across the room

Goal item 1: a household of at least three whose behaviour differs visibly,
traceably to personality data, with contention and no deadlock. M2c shipped
Terri, Doug and Nadia - `content/household.toml` and
`content/personalities.toml`, spawned by the lot load, nobody spawned from
TypeScript any more.

**Watched in the browser first.** Auto-selection lands on Terri with her name
captioned over the need bars; clicking each sim moves the ring and the
caption together (Doug, Nadia, Terri, read back off the DOM). Left alone for
90 simulated seconds the three spread over the whole house - each visited
four or five of the five rooms - and the frame captured at the end had them
in three different rooms: Doug eating standing up at the fridge, Nadia in
the bedroom, Terri by the bunk with the selection ring at her feet (65
ring-coloured pixels, counted, since [L53] retired trusting a thumbnail).

### The trace, now per sim

`cargo run --release -p terri-sim --example trace -- N`, shipped everything.
The harness spawns the household rather than one synthetic sim, and its
candidate table now applies the personality multipliers - a table that
skipped them would be the trace lying about exactly the thing it exists to
explain.

Over 36 000 ticks, 1 000 completed interactions:

| object | Terri | Doug | Nadia | the authored reason |
| --- | --- | --- | --- | --- |
| desk | **30** | 0 | 0 | Terri 1.7 disposition; Doug 0.45 |
| bookshelf | **23** | 11 | 0 | Terri 1.45 |
| television | 34 | 42 | **69** | Nadia 1.2 and social-starved; Terri 0.55 |
| dining table | 13 | 3 | **20** | Nadia 1.05 and it is the social seat |
| armchair | 0 | **11** | 1 | Doug 1.85 - The Chair That Is His |
| long sofa | 0 | **13** | 0 | Doug 1.35 |

Three sims, three different lives, every difference traceable to a line of
content. Doug owns his chair 11 to 1. Terri is the only one who works at
the desk. Nadia watches twice as much television as anyone because it is
the biggest social tap in a house with no people-as-suppliers yet.

- **Interactions**: 1 000 in 36 000 ticks, 321 in 12 000 - roughly 3x the
  single-sim rate, as it should be.
- **Every interactive object used** at 36 000 ticks, reading chair (2, both
  Doug) and kitchen sink (11) included. At 12 000 the reading chair sits at
  zero, which is [B9]'s horizon effect again, not a regression.
- **Back-to-back repeats**: 14 of 997 aggregate, 1.4% - under the 2%
  criterion. Terri alone runs 2.8% (10 of 357): her 1.3x fun drain and 0.85
  fun satisfaction keep her chronically under-entertained, and her amplified
  desk and bookshelf survive habituation well enough to repeat. That is a
  personality being a creature of habit rather than a scoring defect; noted,
  not tuned away.
- **Nobody froze**: 1 frozen tick in 36 000 x 3 sim-ticks. Idle 14.4 to
  17.0% per sim (12.8 to 17.4% on the shorter 12 000-tick run).
- **Contention without deadlock**: the single-slot armchair changed hands
  Doug/Nadia, the toilet took ~25% of everyone's actions through one slot,
  and the ring layout gave crossing sims separate routes; no [L17]-shaped
  stall appeared in either the trace or the watched session.

### Nadia's social band is the number to keep watching

social, per sim, 36 000 ticks: Terri 20.2 to 100, Doug 36.7 to 100,
**Nadia 27.0 to 70.1** - the only need in the household that never reaches
full. The 70.1 is an equilibrium, not a cap: one television session
delivers 18 social at her 0.75 satisfaction, and nothing forbids two in a
row, but her 1.4x drain plus how often the television actually out-scores
everything else keep her from ever getting there. That is the authored
point - she is the demand side of M2d built first, and the day sims can
talk, her ceiling should jump. If M2d slips and her floor sinks toward
zero instead, that is [C2] arriving on schedule and the knob to soften is
the 1.4.

### What this did not need

No new mechanism. Personality is three multipliers entering the two places
scoring and delivery already computed - [S4]'s one-mechanism rule held, and
the diff to `select_action` is four lines reading two components. The work
was almost entirely content, validation, and tests.

## [A-10] The house learns to talk

M2d measured: sims advertise a social vocabulary to each other
(content/social.toml, one "chat" entry: social 30 and fun 6 over 40
ticks), the initiator reserves its partner like an object, delivery
fills both sides, and every completed conversation moves both ordered
relationship pairs by 0.15, decaying toward zero at 0.00001 per tick.

Trace: `cargo run -p terri-sim --example trace --release -- 36000`
(deterministic; 12 000-tick window checked separately). 1 005
interactions, 31 conversations.

- **Goal item 2, measured.** Nadia - the authored demand-side sim, 1.4x
  social drain, 0.75 social satisfaction - had a social band of 27.0 to
  70.1 before M2d, the only need in the household that never reached
  full. With people to talk to her band is **26.7 to 100.0**: the
  ceiling jumped exactly as [A-9] predicted it should. Household social
  supply-to-drain sits at 0.97, up from 0.94 with the television doing
  all the work alone.
- **The friendship graph has a shape, not a value.** At tick 36 000:
  Terri and Nadia 0.993/0.993 (11 and 9 chats between them), Terri and
  Doug 0.572/0.572, Doug and Nadia 0.392/0.392 - best friends, warm
  housemates, and two people who nod in the corridor, all from one gain
  knob and who actually sought whom. The CONVERSATIONS table is ordered
  pairs, and it is already asymmetric in initiative: Terri opened 11
  chats with Nadia, Nadia 9 back, Doug opened 2.
- **Conversation reads at human speed**: sampled lengths 24 to 53 ticks
  (2.4 to 5.3 seconds at 1x), mean around 39. Talking is 2.2% of all
  sim-time, waiting-to-be-talked-at 0.5%, and the initiator's walk is
  ordinary walking - so the mechanic adds presence without eating the
  clock.
- **Nobody froze and nobody wandered off mid-appointment**: 1 frozen
  tick in 108 000 sim-ticks; the reserved partner stands still by
  filter (selection, wander) rather than by hope.
- **Back-to-back repeats stayed low**: 7/5/5 per sim over ~330
  interactions each, about 1.6% aggregate - [H7]'s bet that the cubed
  urgency of a filled social bar brakes talk loops held, no habituation
  needed on people.
- **[C6] came back for the reading chair and was paid for the second
  time.** Chat's fun rider plus the talk-time it consumes pushed the
  wingback back to zero uses over 12 000 ticks; duration 51 to 46 alone
  recovered only the 36 000 window, so its fun delta moved 16 to 19.
  Now 2 uses at 12 000, 8 at 36 000. The object's own comment records
  the shape: it sits a rounding error above the threshold by design,
  and every new competitor will shave that margin.

The relationship trio's knobs behaved as authored: roughly seven chats
to best-friend range, decay negligible inside one session (0.36 over
the whole hour if nobody spoke, which nobody household-shaped lets
happen).

**Watched session: done, 2026-07-31, in the [A-11] visibility pass
below.** The pane was displayable again; an autonomous conversation was
watched end to end (two sims face to face in the kitchen, both wearing
talk bubbles), and the debug overlay showed the completion move both
sides of the pair live: Doug "feels: Nadia +0.15" and Nadia "feels:
Doug +0.15" appearing together the moment the chat ended. That is the
outstanding half of this entry discharged; the notes are in [A-11].

## [A-11] Watching them do things, and telling one to

PR 2 of the visibility pass, watched in the displayed pane at
localhost:5173 (WebGPU live, console clean) on the a11-visibility
branch before its PR. What shipped: activity indicator bubbles over
every sim, the `?debug=1` stats overlay, and the TalkTo command with
its "Chat" flyout row over housemates.

- **Indicators answer Tim's top complaint in one glance.** Standing in
  one viewport: a sim under a "z" bubble walking to bed, one under
  cutlery heading to eat, a reserved partner under an ellipsis "wait"
  bubble, and two talkers under speech bubbles. Sim intent is legible
  from across the room for the first time; nobody has to open a panel
  to know a sim is mid-anything.
- **The directed talk works as a player gesture, not just a wire
  format.** Left-click selected a sim; right-click on a housemate
  opened exactly two rows, "Chat" and "Never mind"; picking Chat made
  the target stop and wear the wait bubble (reserved, standing still by
  filter) while the ordered sim crossed two rooms to it, and the pair
  ended face to face under matching speech bubbles. The whole loop -
  click to conversation - reads at 1x without any UI beyond the flyout.
- **The debug overlay is the M2c/M2d microscope it was meant to be.**
  Identity (name, entity, SimId), the activity word, all seven needs,
  both personality halves, and the relationships line, refreshed live.
  Watching "feels: nobody yet" become "feels: Nadia +0.15" on BOTH
  sims' rows at a conversation's end is goal item 2 observable on
  screen, not just in the trace.
- **Rough edges, known and scheduled:** the canvas still does not
  reflow (the pane scrolled in both axes; PR 3's camera work), and the
  backquote toggle needs the page to have keyboard focus before it
  lands - not a bug, but worth remembering while the pane is driven
  remotely. The talk-order flyout labels come from the pack, so today
  it is one row; the vocabulary can grow without touching the shell.


### The pan addendum, from the first real phone verdict

Tim pinched on real glass: **"zoom works but I obviously need to be
able to drag"** - the first play feedback ever delivered against a
feature the same hour it shipped, which is the loop this whole pass
exists to create. Pan landed in the same PR ([V8]): drag with a
finger or the mouse, pinch midpoint pans while the spread zooms, the
wheel now anchors at the cursor (retiring [V6]'s lot-centred
deviation), and a clamp keeps 96 px of lot reachable after any fling.

Verified headlessly this time - the pane was not displayed, so rAF
never fired ([L14] again), but event handlers do not need
compositing: a synthetic 20 px drag moved the live origin exactly
(20, 20) through the real listeners, and a synthetic wheel at an
arbitrary anchor moved the origin to the anchored-zoom formula's
answer to the last float digit (598.4394458779701 predicted and
observed). The eyes-on pass is Tim's phone, which is the merge gate
anyway: drag, pinch, and a tap that still selects.


## [A-12] The second axis, measured

M2e PR 1: satisfaction and hobbies, the trace re-run at 36 000 ticks
(one simulated hour) on the shipped lot with the shipped household.
`cargo run -p terri-sim --example trace --release -- 36000`, which now
prints the ledger.

- **The axis separates the household exactly as the content authored
  it.** Terri 949.5 (correspondence and reading - the desk is her
  whole archetype and it is never contested), Doug 389.5 (television
  and cooking), Nadia 291.0 (socialising alone). Nadia earning least
  while loving people most is the design's own bet stated in
  household.toml: hers is the most fragile hobby in the house because
  it needs OTHER PEOPLE to be free, and one simulated hour prices that
  fragility at about a third of Terri's take.
- **The neglect bleed never fired, and that is the tuning working.**
  Every need cycled in the 30-100 band all hour; the floor is 15. The
  bleed is for genuine crises - a need with no object, a sim trapped
  away from one, or (PR 3) a career eating the time a need wanted -
  not for the ordinary hum of a functioning household.
- **Behaviour is untouched.** Motion shares match the M2d session's
  shape (2.6% talking, 0.8% waiting, 1 frozen tick in 108 000);
  satisfaction reads the world and writes a ledger nothing reads back
  yet, so the sims do not chase it. That changes in PR 2, when traits
  weight choices - this entry is the BASELINE the trait pass gets
  compared against.
- **Balance question, deliberately left open for the milestone's
  end:** Terri out-earns Doug 2.4x. The ratio is defensible (two
  active hobbies against one passive plus one chore-hobby) but the
  gap is wide, and whether it FEELS wide is a played-session question
  for PR 3's watch, not a knob to turn from a table.

## [A-13] Traits, measured against the [A-12] baseline

M2e PR 2: the same 36 000-tick hour with the household wearing its
traits, against [A-12]'s trait-free baseline (Terri 949.5, Doug 389.5,
Nadia 291.0).

- **The condition is the biggest life-shaper in the house.** Terri
  568.2 against her 949.5 baseline: low spirits at severity 0.6 taxes
  roughly forty percent of what her hobbies pay, exactly the accrual
  arithmetic made visible. And the management loop works on screen -
  severity 0.60 down to 0.39 across an hour at the desk that treats
  it.
- **The disposition raised a life score by steering alone.** Doug
  442.7 then 462.0 against 389.5: the devotee pull sends him to the
  television more often, and more loved completions is more life -
  the trait changed WHO he is by changing what he picks, with no
  direct writer anywhere.
- **The capability's first cut resolved too fast, and was retuned
  from the measurement.** At learn 0.05, Nadia MASTERED the stove
  inside the hour (level 0.25 to 1.00) and Terri's condition resolved
  outright (severity 0.00) at manage 0.02 - both whole arcs inside
  sixty minutes, which reads as tutorial content rather than a life.
  Slowed to 0.015 and 0.005: the same hour now ends at level 0.71 and
  severity 0.39 - progress a player feels within a session and
  finishes across several, the managed-not-cured shape [E3] wants.
  The knobs are content; the numbers above are the shipped ones.
- **Nadia is flat (276.0 vs 291.0)** - her hobby is people and the
  traits gave her a skill arc, not more company. Her satisfaction
  story waits on group conversations or a second social sim; recorded
  as expected rather than wrong.

## [A-14] The career, measured against the [A-13] hour

M2e PR 3: the same 36 000-tick hour (25 game days at 1 440 ticks per
day) with Terri holding the office job - 06:00 to 14:00, pay 120,
energy 15, satisfaction 1.0. Reproduce with
`cargo run --release -p terri-sim --example trace -- 36000`.

- **The job pays exactly what it promised and nothing it did not.**
  FUNDS 3000 after 25 shifts at 120: every day fired once, every
  return credited once, across two dozen day-clock wraps. Career
  satisfaction contributed 25.0 of Terri's 344.9 - the money is real
  and the meaning is nearly nothing, which is [E4]'s whole design.
- **The time is the price, and the trace can now say so in one
  column.** Terri is at work (commute included) 36.8% of her hour;
  the other two read 0.0%. Her life score is 344.9 against 568.2 in
  the trait-only [A-13] hour - the shift eats roughly forty percent
  of what her desk and her bookshelf would have earned, without the
  career subtracting a single point. The non-negative-satisfaction
  amendment holds up in the numbers: the antagonist is the absence.
- **The condition heals slower because the desk hours went to the
  office.** Severity ends at 0.45 against [A-13]'s 0.39 - the same
  manage rate, fewer tagged completions. The job is quietly bad for
  the exact thing her routine was treating, and nothing had to be
  authored to make that true.
- **The career taxes Nadia without employing her.** 210.5 against
  276.0, the largest surprise of the measurement and an emergent one:
  her only hobby is company, and the job removes a third of a person
  from the house - fewer partners free, fewer loved chats. [A-13]
  called her satisfaction story "waits on more company"; the career
  made it actively worse, which is worth remembering when a second
  job is authored.
- **Doug is barely touched (471.0 vs 462.0)** - his hobbies are
  objects, and the television does not leave for work. The contrast
  with Nadia is the cleanest evidence yet that the satisfaction axis
  is measuring LIVES rather than schedules.
- **Balance verdict: shipped as measured.** The [A-12] question about
  Terri out-earning Doug answered itself from the other direction -
  the job flips the order (471.0 over 344.9), and a life's ranking
  now turns on choices (who works, who loves what) rather than on a
  static table.
- **The watched session, honestly described.** The pane could not
  composite during this pass (nobody had it displayed, and an
  undisplayed pane fires no animation frames), so the watch ran in a
  real headless Chromium via Playwright against the dev server: the
  house renders, all three sims move at 3x across screenshots, and
  the ?debug=1 overlay showed every new line live against shipped
  content - funds: 0 at the top, works: Office clerk under Terri,
  wears: Low spirits (condition, severity 0.60), and Doug's
  disposition worded without a state. The departure-vanish-return
  itself could not be caught in pixels there (headless Chromium loses
  the WebGPU adapter on reload and would not give it back), so it is
  pinned instead by a permanent boundary test that runs the shipped
  1440-tick day through the RELEASE wasm - Terri's row flagged
  AT_WORK at tick 600, back and exactly 120 richer by tick 900. First
  displayed-pane session should confirm the vanish reads well on
  screen; filed as the one open eye-test.

## [A-15] The chain, measured against the [A-14] hour

M2f: the same 36 000-tick hour with cook_dinner live, the stove's
standalone meal retired, and the career still running. Reproduce with
`cargo run --release -p terri-sim --example trace -- 36000`.

- **Nineteen dinners in 25 days, every one completed, none
  abandoned** - Terri 7, Doug 5, Nadia 7 - and Terri's seven happened
  AROUND her 25 work shifts, which is resume-through-preemption
  proven at scale: the shift drops the step, never the errand, and
  she comes home and finishes cooking. The errand share reads 3.9%
  of the house's hour, walks and waits included.
- **Nadia is UP (241.3 against 210.5)**: dinners gave the sim with
  the fragile people-hobby something real to earn from, and her
  cooking level climbs (0.35 by hour's end) through fumbles that
  still teach. The trait loop and the chain compose exactly as
  designed.
- **Terri trades honestly (297.7 against 344.9)**: seven dinners eat
  hours her desk would have monetised at a better rate, and her
  severity still eases (0.41 against 0.45 - the comfort deltas and
  the desk time she keeps).
- **Doug is the finding (359.0 against 471.0), and it is recorded
  rather than tuned away.** He LOVES cooking, so each dinner pays 9 -
  but a ~200-tick errand at 9 is a worse hourly rate than the
  television he is devoted to, so more cooking means a lower life
  score for the house's one hobby cook. That is either the honest
  economics of a slow hobby or a payout that undersells the fullest
  meal the game can express, and WHICH is a fun-verdict call that
  belongs to the owner: raising the chain's satisfaction (3.0 today)
  is the one-knob fix if play says the cook should profit from
  cooking. Deliberately left as measured, the [A-12] precedent.
- **FUNDS 3000 and the day clock unchanged** - the career's whole
  [A-14] behaviour survived the chain landing on top of it.

- **The watched session, honestly described (the [L59] situation
  again).** The pane had no display and the session's one headless
  Chromium process was still holding its dead WebGPU adapter, so no
  fresh pixels were available this pass. What pixels would have shown
  is pinned instead by tests through the release wasm and the real
  atlas: the shipped-day boundary test runs from_lot until a sim's
  hands fill and asserts the badge's data source (the carrying row)
  and the overlay's exact status line; the badge's screen position,
  its kind-matched sprite (the bag visibly becomes the plate), the
  at-work hide and the instance count are pinned over the atlas the
  page ships; and the fridge's flyout row is asserted against shipped
  content at the boundary. First displayed session should watch one
  dinner end to end - pantry, counter, stove, table - and check the
  badge reads at hand height; filed with [A-14]'s open eye-test.

## [A-16] Persistence and the player-facing alpha shell, watched

M2g was exercised in a visible Chrome against the working HTTPS build,
first at 1705 x 997 and then at 390 x 844.

- **The save seam resumed exactly.** The game was paused and saved at
  `Day 9, 08:03`, advanced to `08:50`, and then loaded. The confirmation
  completed with `Saved game loaded` and returned the clock exactly to
  `Day 9, 08:03`. A separate fresh-page reload restored an exact saved tick
  with Load enabled. The independent
  native and release-WASM suites continue matching worlds for 300 ticks,
  so the watched seam and the deterministic seam cover different failure
  classes.
- **New Game actually clears the old household.** The destructive warning
  appeared before the reset. Accepting it returned the game to Day 1 with
  zero funds and `No save yet`; the old save did not reappear through the
  visibility-save path. Load stayed disabled until the next valid save, and
  repeated daily `Autosaved` status updates were visible during ordinary
  play.
- **The career loop paid in the visible game.** Terri was observed leaving
  for work with an `At work` activity, returning, and moving household funds
  from 0 to 240 and later 480 across completed workdays. The watched evidence
  covers the player-facing departure and pay loop without claiming the wider
  workplace model proposed in the still-owner-gated career specification.
- **The normal HUD finally explains the simulation without `?debug=1`.**
  The watched page showed day and time, funds, Terri's life satisfaction,
  career and current activity, plus plain save state. Need meters exposed
  values in the accessibility tree rather than only changing their width.
- **The hidden gestures have visible equivalents.** Queue toggled with
  `aria-pressed=true`; Help named touch, mouse and keyboard paths; arrow-key
  targeting announced `Chill-o-Matic 3000`, and Enter opened its Grab a
  snack, Cook dinner, and Never mind actions with focus on the first row.
- **The action menu stayed reachable.** Opened at the bottom-right corner,
  its right and bottom edges stopped eight pixels inside the viewport. Escape
  closed it and returned focus to the game view.
- **The phone layout is usable, not merely scaled down.** At 390 x 844 the
  selected person's details started folded, all six action buttons remained
  at least 44 pixels tall, the HUD ended above the middle of the screen, and
  the house remained playable below it. This was responsive emulation in a
  visible browser, not a physical-touch session. Long-press cancellation and
  firing are covered by the input tests; a real-device long-press remains a
  useful post-merge check, not a claimed observation.
- **Criterion 11 remains open honestly.** Functional controls are plain and
  inventoried in `docs/player-visible-strings.md`; no autonomous comedy pass
  was smuggled into buttons or failure text. The owner-authored voice session
  is still the final playable-alpha criterion.

## [A-17] Household roster, watched through restore

The household-capacity slice was exercised in a visible headed Chromium
session against the working HTTPS build, first at 930 x 919 and then at
390 x 844.

- **All three shipped people are immediately selectable.** The normal HUD
  listed Terri, Doug, and Nadia in declaration order. Terri started pressed;
  pressing Doug moved `aria-pressed` to Doug and changed the selected-person
  caption and readouts to Doug on the next simulation update.
- **Restore reconciles the roster with simulation truth.** Doug was selected
  and saved, Nadia was selected afterward, and Load restored Doug. The roster,
  selected-person caption, simulation clock, and `Saved game loaded` status all
  agreed after the swap. Unit coverage separately replaces every entity index
  without redrawing first and proves the old button resolves stable `SimId` to
  the new live entity.
- **The narrow layout remains playable.** At 390 x 844, the three 44-pixel
  roster buttons fit on one row without truncating the shipped names. The needs
  details began folded, the complete control stack ended a little past the
  viewport midpoint, and the lot remained visible and interactive beneath it.
- **The six-person capacity fits the same phone HUD.** A temporary browser-only
  layout fixture added three realistically long names without changing shipped
  content. All six buttons remained inside the 390-pixel viewport, wrapped to
  two rows, and measured at least 44 pixels tall. The three long names wrapped
  legibly instead of overflowing or being clipped.
- **Pause does not freeze the roster.** At `Day 1, 02:26`, Pause was selected,
  Doug was pressed, and the roster plus selected-person panel changed to Doug
  while the clock remained exactly `Day 1, 02:26`. Doug retained keyboard focus
  through several roster refresh intervals, proving the keyed redraw does not
  quietly throw focus back to the page.
- **Accessibility state is explicit.** The accessibility snapshot exposed a
  Household heading, three native buttons, and exactly one pressed button.
  Native controls supply Tab, Enter, Space, touch activation, and focus without
  adding a roster-specific keyboard scheme. In the six-button layout fixture,
  Tab advanced from Doug to Nadia and then to the first button on the second
  row; the focused button had a visible two-pixel outline.
- **Runtime remained healthy.** The visible session advanced normally at
  roughly 0.3 to 0.6 ms p95 frame work with 37 entities. The only console error
  was the pre-existing missing `favicon.ico` request; no game, WebAssembly,
  storage, selection, or rendering error appeared.

## [A-18] Persistence controls under deliberately slow storage

The persistence-operation guard was exercised in a visible Chromium session
against the working HTTPS build with storage-worker message delivery delayed by
two seconds. The delay made the complete asynchronous ownership interval
inspectable rather than depending on a normal OPFS response that finishes too
quickly to see.

- **Save owns all persistence controls.** Immediately after Save, the live
  status read `Saving` and Save, Load, and New game were all disabled. After the
  delayed response, the status changed to `Game saved`; Save and New game were
  enabled, and Load became enabled because a validated slot now existed.
- **An already-open confirmation cannot lose an action silently.** The Load
  dialog was opened first, then a delayed Save was started programmatically to
  reproduce the otherwise narrow autosave timing window. `Load game` became
  disabled inside the still-open modal for the same interval as the top-level
  controls, while `Keep playing` remained available to close it.
- **New game owns the same boundary.** After confirming Start over, the dialog
  closed, the live status read `Starting new game`, and all three persistence
  controls remained disabled while clear was pending. Save therefore had no
  player path capable of queuing a write behind the clear.
- **Clear stayed cleared.** After the delayed clear completed, the page reloaded
  through the same delayed startup read. The status read `No save yet`, Load was
  disabled, and the fresh household was running. No queued Save resurrected the
  removed slot.
- **Runtime remained healthy.** The completed reload reported no console errors
  or warnings. Unit tests separately hold Load pending across a simulated-day
  boundary and prove autosave never captures bytes or reaches storage.
## [A-19] The alpha acceptance pass - all eleven criteria, one build

The first measurement of the criteria against the code-complete alpha systems
rather than against the milestone that shipped each one. Same 36 000-tick hour
(25 game days). Reproduce with
`cargo run --release -p terri-sim --example trace -- 36000`; world hash
`0xbd80133f416f5de9`.

Three criteria did not hold. All three are fixed here; the working
design and the rejected alternatives are in
`docs/specs/2026-08-01-alpha-acceptance-findings.md`.

### What was broken

- **[X1] 28.4% of saves could not be loaded.** Snapshotting at each of
  36 000 ticks and loading each into a fresh sim, **10 224 failed** -
  8 499 `InvalidContentReference`, 1 725 `InvalidEntityReference`. A
  `Target` names one of three things (a chain station via the
  `CHAIN_STEP` sentinel, an object's interaction, or a PERSON for a
  conversation) and the validator modelled only the middle one, while
  habituation keys on the flyout ROW and so records the fridge's chain
  at row 1 the first time anybody cooks. The seam test in M2g saves at
  tick 173; the shipped lot's first walk-to-talk begins at tick **188**.
  It missed by fifteen ticks. **Now: 0 of 36 000 fail, and 142 seams
  spread across the hour each resume hash-identical to the
  uninterrupted run for 300 ticks after loading.**
- **[X2] The one sim with a job lived permanently at zero.** Terri hit
  0.0 on six of her seven needs and her lowest need was at or under 5
  on **every one of the 25 days**: 27.3% of her life with hunger there,
  19.2% with social, 18.8% with fun. Doug and Nadia, who hold no job,
  spent **zero** ticks in crisis on anything. `decay_needs` drained
  every sim holding `Needs` at the full rate, and a sim off the lot at
  work can reach nothing, so a 480-tick shift plus commute cost her 33
  hunger a day against a daily budget of 89.
- **[X3] The reading chair was used zero times over 12 000 ticks**, the
  horizon criterion 3 names by name.

### The eleven, judged on this build

| # | criterion | verdict | evidence |
| --- | --- | --- | --- |
| 1 | three sims, visibly different, no deadlock | holds | Terri 37.0% at work / Doug 0% and 5.3% talking / Nadia 42.9% interacting; three different top-three object lists; 1 frozen tick in 108 000 |
| 2 | social need satisfied, relationships form | holds | 29 conversations, all three pairs above +0.9 by tick 36 000 |
| 3 | no object at zero uses over 12 000 ticks | **fixed** | reading chair 0 → 2 at 12 000, 3 at 36 000; every other interactive object already clear |
| 4 | satisfaction and hobbies consume idle time | holds | Terri 384.7 / Doug 364.0 / Nadia 202.0, all from hobby completions and the career's 25 |
| 5 | dispositions weight, capabilities gate, conditions act | holds | television devotee x1.5 visible in Doug's 39.8% interacting; Nadia's "can't cook" learned 0.35 → 0.29; low spirits managed 0.60 → 0.47 |
| 6 | a career | **fixed** | 25 shifts, FUNDS 3000, 12.3% of household time; the price is now the time rather than starvation |
| 7 | multi-step interactions with resume | holds | 18 chains started, **18 completed, 0 abandoned**, across career preemption |
| 8 | multiple rooms, 25+ objects, real footprints | holds | 34 placed objects, 18 interactive |
| 9 | persistence | **fixed** | 0 of 36 000 ticks unloadable; 142 seams resume identically |
| 10 | readable UI | holds | unchanged from [A-15]; no code touched here |
| 11 | the game's voice | **open, and it is the last one** | owner-authored session still required ([L58]) |

### What the [X2] fix actually cost and bought

Terri's crisis time fell by roughly two thirds - hunger from 9 816
need-ticks at or under 5 to **1 977**, hygiene and energy essentially
resolved (74 and 154), social from 6 899 to **620**. She still touches
zero on 18 of 25 days, and that is deliberate: `neglect_floor`'s own
comment names "a career eating the time a need wanted" as a case the
bleed exists for. Her crisis days are a middle stretch with clean weeks
on both sides - a hard life, not a decline. Doug and Nadia remain at
zero crisis ticks with floors of 17.7 and 19.0.

**The balance shift, stated rather than tuned away.** Terri's life
score moves 297.7 → **384.7** and now tops Doug's 364.0, reversing the
order [A-14] recorded when the career landed. She is not being paid
more; she is losing less to neglect bleed and has the energy to read
(bookshelf 15 → 29 uses). Nadia falls 241.3 → **202.0**, the same
emergent tax [A-14] named - her only hobby is company, and a housemate
who is coping needs her less. **Whether a working sim SHOULD out-earn a
settled one is a fun judgement, not a correctness one, and it is the
owner's call.** The knob is one line: `at_work_decay_scale` in
`content/tuning.toml`, and exactly 1.0 restores what this pass found.

### Watched in a real browser, and it found the bug independently

The persistence fix was verified through the shipped WASM build in the
in-app browser, driving the real `SimHandle` via the `?stress` harness
(which needs no animation frames, so an undisplayed pane cannot mute
it - [L59]). Ticking the shipped household plus the harness's own bare
agent, saving and reloading at **every one of 6 000 ticks**:

| build | first refused save | refused of 6 000 |
| --- | --- | --- |
| before the fix | tick **697** | **2 013** |
| after the fix | none | **0** |

Zero loaded-but-changed on either. Funds read 480 at the end - four
shifts paid - so the career was live across the window rather than the
world sitting idle.

**The before column was an accident worth keeping.** The preview server
was serving the SHARED working tree's `dist`, not this worktree's, so
the first hour of browser measurement was unknowingly running another
branch's pre-fix build. It reproduced the failure at 29% against the
native measurement's 28.4% - an independent confirmation of the bug
from a build nobody had touched for this pass. See [L65] for the trap
and how to notice it in one command.

### The honest gap in this pass

No PIXELS were checked: the pane could not composite (nobody had it
displayed), so this is a driven-and-measured session rather than a
looked-at one. Nothing in these three fixes changes what is drawn -
[X1] touches validation only, [X2] and [X3] move need levels and one
disposition weight - so the watched passes in [A-16], [A-17] and [A-18] still describe
what is on screen. A displayed-pane look at this build is the correct next
check and is not claimed here. [A-16], written by the M2g pass, is the
most recent watched session and its findings stand.

## [A-20] Relationships in normal play

The People panel was exercised in visible Chromium against the working HTTPS
build at 390 x 844, with an additional delayed-storage pass for the persistence
dialog correction discovered during the session.

- **The sparse model reads as a complete household.** Terri's panel listed Doug
  and Nadia even when both sparse entries were absent, with each row labelled
  Stranger and its centered meter at `0`. The accessibility tree exposed
  `Terri's feeling about Doug` and `Terri's feeling about Nadia` as meters.
- **Selection changes direction, including while paused.** Selecting Doug
  changed the summary to `How Doug feels` and showed Doug's independent values.
  In a paused check, the selection, pressed roster button, and People caption
  changed to Terri while the clock remained exactly `Day 2, 03:05` for more
  than a second.
- **A conversation has visible payoff.** Doug's completed Chat with Terri moved
  his row from Stranger at `0` to Warm at approximately `0.14`. Selecting Terri
  showed her independent row toward Doug as Warm too. Nadia's different values
  remained different, so the surface did not mirror one cached relationship
  across rows.
- **Save and Load restore the panel with the world.** At paused `Day 1, 02:54`,
  Doug and both Stranger rows were saved. After Chat moved Terri to Warm and
  the clock advanced, Load restored `Day 1, 02:54`, selected Doug, both Stranger
  rows at `0`, and the `How Doug feels` caption in the same visible frame.
- **The phone HUD keeps its breathing room.** On a fresh 390 x 844 load, Needs
  and People both began folded. The 212-pixel HUD measured 506 pixels tall,
  stayed within the 844-pixel viewport, and produced zero horizontal overflow.
  Opening People exposed native keyboard-operable summary behavior and two
  readable 192-pixel rows.
- **The confirmation regression is closed.** Before the fix, a successful Load
  remained covered by its open confirmation dialog because the operation lock
  disabled the clicked submitter before native dialog submission completed.
  With worker delivery delayed by more than six seconds, confirming Load now
  immediately closed the dialog, showed `Loading`, and disabled Save, Load and
  New game until completion. The completed result read `Saved game loaded`.
- **Runtime remained healthy.** The complete interaction, save, restore,
  selection, responsive, and delayed-storage session reported zero console
  errors and zero warnings.

## [A-21] Blocking surfaces own game time and focus

A fresh public-build audit first reproduced the defect: first-run Help opened
at 1x, and the clock advanced from the opening minutes of Day 1 into the work
day while the instructions were being read and captured. The corrected working
build was then exercised in visible Chromium.

- **First-run Help freezes the world.** The clock remained exactly
  `Day 1, 00:00` for more than one second while the dialog was open. The
  accessibility tree identified a modal `How to play` dialog and its heading
  was the active element.
- **The player starts at the instructions, not the exit.** The scroll position
  reset to the top and `#help-title` received focus. Got it closed the dialog,
  focused `#stage`, and the clock resumed at 1x.
- **Manual keyboard use closes the loop.** Opening Help from its button focused
  the heading. Escape closed the dialog, collapsed the button's
  `aria-expanded` state, returned focus to `#show-help`, and resumed time.
- **Confirmations also own time.** New game confirmation held
  `Day 1, 04:57` unchanged for more than one second. Keep playing closed it;
  only then did the clock resume.
- **The phone dialog fits.** At 390 x 844, the dimmed modal kept all nine
  instructions and the full-width 44-pixel Got it control visible without
  horizontal overflow.

The fresh desktop and mobile captures are in the task's visualization artifact
folder. Unit, type, and production-build gates cover the controller and help
lifecycle independently of this watched pass.

## [A-22] Moods and moodlets in normal play

The working release-WASM build was exercised in visible Chromium on desktop
and at the 390 by 844 phone breakpoint. The screenshots are
`11-local-moods-desktop.png`, `13-local-moods-social-live.png`, and
`14-local-moods-mobile.png` in the task's visualization artifact folder.

- **The opening state explains Terri rather than merely colouring her.** Her
  HUD read Low at -18 with `Low spirits -18`. The accessibility tree exposed
  Overall mood as a meter from -100 to 100 with `Low` as its value text, while
  the moodlet row carried the signed value in text.
- **Selection clears causally.** While paused at `Day 1, 10:30`, selecting
  Doug changed the projection to Okay at 0, showed `No active moodlets.`, and
  left no Low spirits row behind. The clock stayed exact for another 600 ms.
- **The environment branch is reachable in the shipped household.** Nadia's
  autonomous relationship with Doug reached Friendly at 0.257. While the two
  were nearby, her HUD showed `Comforted by Doug +0.6`; a later visible frame
  caught the distance-weakened value at +0.3. No test-only person or hidden
  debug surface was needed.
- **Load replaces the projection before time resumes.** Paused Terri was saved
  at `Day 4, 06:40`, Low at -29.6 with Lonely -12 and Low spirits -17.6.
  Selecting Doug changed the live DOM to Okay at 0 with no rows. Load restored
  Terri, the exact clock, score, label, and both rows before another tick; the
  clock remained exact for a further 800 ms and status read Saved game loaded.
- **The phone layout survives a genuinely bad day.** Needs and People both
  opened folded at 390 by 844. Opening Needs showed a 177-pixel mood block
  containing five readable moodlets, including signed scores and the long
  condition row. The 212-pixel HUD used its existing vertical scroll, produced
  zero horizontal overflow, and left People folded rather than lengthening the
  initial screen behind the player's back.
- **Runtime remained quiet.** The complete desktop, selection, autonomous
  social, Save/Load, and mobile session reported zero console warnings and
  zero errors.

## [A-23] Cook dinner is visible as a resumable chain

The public build at `1fe9e0181be8d26abe77c864c49cfd695e333187` was watched
through one complete player-issued Cook dinner chain. The screenshots are
`21-chain-get-ingredients.png` through `27-chain-resumed-eating.png` in the
task's visualization artifact folder.

- **Every authored stage reaches the HUD.** Doug moved through Get ingredients,
  Prepare food, Cook, Eat dinner, and Eating rather than collapsing the chain
  into a generic walk or interaction label.
- **The carried item tells the same story as the text.** A visible ingredient
  bag followed Doug during preparation and cooking. At the stage boundary it
  became a plated dinner, while the HUD changed from `carrying ingredients` to
  `carrying dinner` in the same paused frame.
- **A player order interrupts without destroying the meal.** Grab a snack
  replaced the active dinner step, changed the HUD to Walking, and exposed one
  waiting order. After that interruption completed, the waiting count cleared
  and Doug resumed Eating from the dinner chain.
- **Runtime remained quiet.** The complete staged watch, interruption, and
  resume produced zero console warnings and zero errors.

This closes the displayed-chain gap recorded in [A-15]. The long deterministic
horizon in [A-19] already proves that autonomous and career interruptions
complete rather than abandon chains; this pass proves the player can actually
see the same ownership model.

## [A-24] Startup failure owns the whole viewport and focus

The corrected working build was forced through its ordinary top-level startup
catch in visible Chromium. The temporary forcing branch was removed afterward
and `web/src/main.ts` matched its original hash exactly. Captures are
`29-startup-alertdialog-mobile.png`, `30-startup-alertdialog-short.png`, and
`31-startup-lan-alertdialog-mobile.png` in the task's visualization artifact
folder.

- **The failure is announced where focus lands.** The accessibility surface
  exposed `The game failed to start` as an active alert dialog, labelled by its
  heading and described by the verbatim error plus recovery hint.
- **The failed interface cannot compete with the explanation.** Every existing
  body child carried the native `inert` attribute before the alert dialog was
  appended. A Help dialog deliberately opened in the browser's top layer was
  closed first. Pressing Tab kept focus on the alert dialog rather than
  entering a dead Save, Load, game-speed, or canvas control.
- **Phone copy wraps without horizontal escape.** At 390 by 844, the alert
  dialog measured exactly 390 pixels wide with no horizontal overflow. The LAN
  branch kept the complete title, detail, all three recovery hints, and the
  unbroken `chrome://flags/#unsafely-treat-insecure-origin-as-secure` address
  readable.
- **Very short viewports scroll from the beginning.** At 320 by 240, content
  measured 442 pixels tall for the generic branch and 562 for the longer LAN
  branch. The top of the heading remained reachable at scroll position zero,
  the native vertical scrollbar exposed the rest, and neither branch produced
  horizontal overflow.

## [A-25] Rejected input speaks, and persistence returns focus

The corrected working build was exercised in visible Chromium on desktop and
at 390 by 844. Captures are `34-load-focus-restored.png`,
`35-load-focus-mobile.png`, and `37-rejected-input-feedback-visible.png` in the
task's visualization artifact folder.

- **Load returns focus to its opener.** After confirming Load, the dialog
  closed, status reached `Saved game loaded`, the control re-enabled, and
  `document.activeElement` was `#load-game`. The same result held at 390 by 844
  with document width and scroll width both exactly 390 pixels.
- **Keyboard rejection is explicit.** A temporary verification hook rejected
  selection at the command boundary. Arrow-key targeting still announced
  Terri, then Space replaced that instruction with `That person could not be
  selected` in the live region instead of leaving the stale success path on
  screen.
- **Pointer rejection names the attempted action.** Clicking clear canvas space
  through the same forced boundary displayed `Selection could not be changed`
  with error styling. Order rejection retains its distinct existing copy, so a
  failed selection no longer masquerades as a failed object order.
- **The forcing hook did not ship.** It was removed after the watched pass, and
  `web/src/main.ts` returned exactly to blob
  `f082fbc386628e6a5ba3af5f14dd8a8fa0b2778f`.
- **Runtime remained quiet.** The desktop Load, mobile Load, keyboard rejection,
  and pointer rejection checks produced zero console warnings and zero errors.

The structural suite separately covers body, null, closed-dialog, deliberate
focus, disabled-opener fallback, accepted selection, and both rejection kinds.

## [A-walking-footfall] Walking has a planted, deterministic footfall

The corrected working build was watched in the in-app Chromium browser at
1280 by 720. The source comparison is `33-interaction-focus-local.png`; movement
captures are `40-walking-paused.png`, `41-walking-paused-later.png`, and
`48-walking-speed-start.png` through `54-walking-loaded.png` in the task's
visualization artifact folder.

- **The body moves while the ground stays put.** A fresh game produced two
  simultaneously walking sims. Their bodies rose by the restrained footfall,
  while the selected sim's ring remained on its tile and the ordinary depth
  order stayed intact. Comparing the source and corrected viewport found no
  unintended layout, palette, sprite, wall, or furniture change.
- **Pause freezes pose as well as time.** Nadia was paused while the HUD still
  read Walking. Captures taken 300 ms apart were byte-identical, including the
  clock, body, and selection ring. Resuming at 1x, 2x, and 3x moved the sims
  through the same distance-derived cycle; each control could return to the
  frozen state without a presentation snap.
- **Load reconstructs rather than restarts the pose.** A paused walking frame
  was saved, the household advanced until Nadia was Eating at `Day 1, 05:54`,
  and Load restored `Day 1, 05:32` with Nadia Walking. The WASM seam test
  separately proves Load reconstructs the same screen Y from the saved tick-end
  position after restore seeds previous and current position to that value.
  Save does not persist the fractional render interpolation alpha, so this is
  not a claim that an unsaved between-tick sample survives Load exactly.
- **Selection covers the full travel envelope.** Picking does not receive the
  renderer's interpolation alpha, so a walking sim gets a conservative
  two-pixel headroom strip for the entire step while ornamental motion is
  enabled. Unit coverage hits that maximum boundary and rejects the pixel
  immediately above it at 0.5x, 1x, and 2.5x zoom. With reduced motion, picking
  drops that empty strip and matches the planted body box. The same matrix
  proves non-walking and reduced-motion bodies keep their original rendered
  output, carried badges share the body lift, and the ring never does.
- **Reduced motion has an explicit proof boundary.** The watched browser
  reported its ordinary no-reduction preference. The deterministic renderer
  suite, rather than a claimed visual toggle, proves the reduced-motion output
  exactly equals the planted idle transform while normal travel interpolation
  remains unchanged.
- **Runtime remained quiet.** The fresh-game, pause, speed, save/load, and
  source-comparison session had document width equal to viewport width and
  reported zero console warnings and zero errors.

This was movement polish on the art that existed during that session. Muted
Line subsequently replaced every pack sprite and shipped three stable character
looks. The remaining conclusion still holds: action poses require semantic
visual-action categories, facings, and interaction anchors; using the
then-current broad activity codes directly would have animated several
unrelated object interactions as eating.

## [A-save-compatible-household] The renamed household keeps a working save

The local production bundle (`index-C8-FzLd7.js`,
`terri_wasm_bg-CImuHT9g.wasm`) was played in the in-app browser on desktop and
at 390 by 844 before the migration branch was published.

- **The renamed roster is the game, not a test-only string.** The first frame
  listed Tim, Bill, and Casey in stable household order, selected Tim, and
  showed the three distinct Muted Line character looks moving through the live
  house. The needs, career, mood, and People panels all agreed on Tim's name.
- **Ordinary Save and Load remained usable.** A manual save was taken with Tim
  selected around `Day 1, 02:45`. Bill was selected and the household advanced
  to approximately `Day 1, 05:15`. Confirming Load closed the dialog, restored
  Tim as the selected person, returned the clock to the saved stretch, and
  reported `Saved game loaded` while the simulation resumed.
- **The narrow layout still fits the renamed controls.** At 390 by 844 all
  three household names remained readable in one row. The needs, People, speed,
  Save, Load, Clear orders, Queue, New game, and Help controls remained visible
  through the existing vertical HUD scroll, with the animated house still
  visible beside it.
- **Runtime remained quiet.** The first-run Help flow, desktop play, manual
  Save/Load, selection change, and phone-size pass produced zero console
  warnings and zero errors.

This browser pass proves the current-format slot and renamed interface. It does
not pretend a freshly created slot is an old deployed one. The Rust and WASM
boundary tests own that migration claim: all four historical full-pack
fingerprints are checked against the independently reconstructed structural
shape, exact legacy names migrate by stable `SimId`, arbitrary saved names are
preserved, and a current-format sim deliberately named Terri stays Terri.

## [A-conversation-action-animation] Conversations have authored body language

The local production bundle (`index-DyNe4FoS.js`,
`terri_wasm_bg--P0E5EXR.wasm`) was played in the in-app browser at 1280 by 720.
Casey was selected through the normal Household control, Bill was targeted
through the canvas keyboard path, and Chat was issued through the ordinary
social-action menu.

- **Both participants visibly join the conversation.** Once the HUD reached
  Talking, Casey and Bill used the directional conversation bodies and each
  carried the existing talk indicator. The close zoom made the gaze, shoulder,
  and hand gesture readable without changing the selection ring, wall depth,
  or indicator anchor.
- **Pause freezes the presentation.** Two full-viewport captures taken 600 ms
  apart while the HUD still read Talking were byte-identical. Resuming for 450
  ms and pausing again kept the action active and produced a different rendered
  frame. The renderer tests isolate that change to the two authored body
  frames, including stable entity phase and every facing.
- **The action survives the ordinary game controls.** Saving while paused in
  Talking enabled Load and reported `Game saved`. Confirming Load restored
  `Saved game loaded`, the paused speed, the same Talking activity, and the
  saved clock at `Day 1, 07:20`.
- **The zoom envelope remains usable.** The conversation stayed inside the
  existing fixed body envelope at the 0.5x lot overview and the 2.5x close
  view. Talk indicators remained attached at both extremes; walls, furniture,
  and the selection ring kept their existing depth order.
- **Reduced motion has an explicit proof boundary.** Browser emulation reached
  the reduced-motion conversation pose, but the short action ended before a
  clean two-tick visual comparison could be captured. The deterministic frame
  suite owns the stronger claim: reduced motion pins directional frame zero
  while ordinary motion alternates on simulation ticks only.
- **Night and WebGPU validation are explicit.** A second real conversation was
  paused at `Day 2, 02:54` under the ordinary night ambient and inspected at
  native and close zoom. A temporary local-only hook exposed the live
  `GPUDevice`; a `validation` error scope surrounded the nighttime Chat and
  zoom submissions, `queue.onSubmittedWorkDone()` completed, and
  `popErrorScope()` returned `null`. The hook was then removed, and
  `web/src/main.ts` returned exactly to blob
  `247beb4475a862c3f4b57a7bdfc26b97ae5dc7d7`. Neither participant happened to
  carry an item during either watched Chat, so this remains a deterministic
  carried-badge regression claim rather than fabricated live evidence.
- **Runtime remained quiet.** Conversation setup, pause and resume, save and
  load, both zoom extremes, reduced-motion emulation, and the nighttime scoped
  validation produced zero console warnings and zero errors.

## [A-eating-action-animation] Eating is a complete authored action category

The local production bundle (`index-Dr5ZYymC.js`,
`terri_wasm_bg-CWLOA3Md.wasm`) was played in the in-app browser at 1280 by 720
and 390 by 844. Casey was selected through the normal Household control, and
both eating paths were issued through the ordinary keyboard object menu.

- **Snack and dinner share one readable visual language.** Grab a snack at the
  refrigerator and the terminal Eat dinner chain step both used the authored
  directional eating body, two-frame hand motion, and existing fork indicator.
  Dinner alone moved its carried plate to the anchor-side hand; ingredients and
  unauthored carried dinner retain the ordinary badge position.
- **The whole dinner chain remained legible.** The live HUD advanced through
  Get ingredients, Prepare food, Cook, and Eat dinner while the carried item
  changed from ingredients to dinner at the authored steps. The terminal pose
  visibly faced the dining station. The deterministic projection test adds a
  second valid eating surface and proves that decoy cannot replace the exact
  resolved target.
- **Pause and entity staggering are deterministic.** Snack frames changed while
  the simulation ran, then two captures 600 ms apart were byte-identical after
  Pause. The renderer suite separately proves adjacent entity ids cross their
  frame boundaries on different ticks instead of changing in lockstep.
- **Save and Load restore the complete terminal presentation.** A paused Eat
  dinner step was saved, advanced at 3x, and loaded through the normal
  confirmation dialog. Load restored `Day 1, 05:31`, Pause, the terminal chain
  step, carried dinner, facing, and the resolved body frame. Comparing the
  stable saved and restored captures found zero changed pixels in the game
  viewport.
- **The pose reads across the supported layout and zoom envelope.** The dining
  pose, fork indicator, and carried plate remained readable at native and close
  zoom. At 390 by 844, the selected-sim HUD remained scrollable and every game
  control stayed reachable while the animated house remained visible.
- **Reduced motion has an explicit proof boundary.** The watched browser used
  its ordinary no-reduction preference. Deterministic frame tests prove reduced
  motion pins eating to authored frame zero; this pass does not claim a watched
  operating-system reduced-motion toggle.
- **Runtime remained quiet.** Snack, the four-step dinner chain, pause and
  resume, save and load, desktop and phone layouts, and both zoom levels
  produced zero console warnings and zero errors. The visible canvas remained
  on the production WebGPU renderer throughout the pass.

## [A-object-use-activity-semantics] Ordinary object use has an honest name

The corrected production WebGPU build was played at 1280 x 720 in the in-app
browser. The phone and physical-device boundaries were not rechecked in this
slice.

- **The classifier follows authored meaning, not a legacy component name.** A
  focused Rust render-buffer run passed 22 tests. Its causal matrix holds the
  component and target shape steady across the shipped shower, toilet,
  television, bathroom sink, bookshelf, kitchen sink, and reading chair. All
  seven project `USING_OBJECT` with no eating pose. Exact refrigerator snack
  and terminal dinner fixtures still project `EATING` with authored eat art;
  the valid sleep-tagged twin still projects `SLEEPING`.
- **The Web surfaces agree on the appended wire code.** A focused Vitest run
  passed 80 tests across the HUD, developer overlay, frame builder, and atlas.
  A rebuilt release-WASM bridge test reads the literal activity prefix
  `[0, 7]` from a real sink interaction and reads no authored visual action.
  Code 7 prints `Using object` or `using object`; it adds no bubble instance.
  Code 3 still adds the existing fork sprite.
- **The distinction reads correctly in the real renderer.** Casey was paused
  mid-use beside the shipped bathroom fixture with the normal HUD reading
  `Using object`, one waiting order, and no activity bubble above the body. A
  later real refrigerator snack read `Eating` and showed the existing fork
  bubble with its authored eating pose. Browser diagnostics contained only
  expected performance logs, with zero warnings and zero errors.
- **The merged public revision repeats the distinction.** PR 47 merged at
  `38a03c151036430c798502ca4252c925c98789db`; [Pages run
  31289624807](https://github.com/thisnameissoclever/terrilives/actions/runs/31289624807)
  built and deployed that exact SHA. A [SHA-labelled public
  session](https://thisnameissoclever.github.io/terrilives/?rev=38a03c151036430c798502ca4252c925c98789db)
  opened immediately after that deployment was started fresh at 1280 x 720.
  Casey reached the shower with the HUD reading `Using object` and no generic
  bubble. A fresh refrigerator snack was then paused with the HUD reading
  `Eating`, the authored body pose visible, and the fork bubble above the body.
  Public diagnostics contained performance logs only, with no warning or
  error. The `rev` label is an observation aid, not an immutable Pages route.
- **The atlas stays unchanged on purpose.** It remains 98 append-only entries.
  A generic 26-pixel glyph cannot honestly describe bodily care,
  entertainment, chores, and reading, so the HUD text carries the fallback
  meaning until narrower action categories have their own readable art.
- **Four hand mutations proved causality.** Collapsing the generic fallback to
  `EATING` failed on the shower at code 3 versus 7. Changing either authored
  snack or terminal dinner from `EATING` to `USING_OBJECT` failed at code 7
  versus 3. Removing the Web fork mapping failed at two instances versus the
  required three. Each mutation was restored before the green full run.
- **Proof boundary.** This pass proves the label and bubble distinction at the
  desktop shipping size. It does not approve phone-width readability,
  physical touch behavior, or the still-unbuilt action poses for generic use.

## [A-seated-reading-action] The reading chair now seats a visible reader

The fresh local production bundle (`index-Vsjrm-0I.js`,
`terri_wasm_bg-gWQqJsiU.wasm`) was played through WebGPU at 1280 by 720 in the
in-app browser. The exact `reading_chair.settle_in` route was issued through the
normal object menu from a clean paused game.

- **The complete interaction reads as seated reading.** Tim walked from his
  path tile, snapped onto the chair without a visible glide through the prop,
  held a clearly open white book, and showed the redundant book indicator and
  HUD label `Reading`. The chair back and arms remained visible around the
  fixed-envelope body. Completion restored the ordinary standing body on the
  adjacent path tile without a reverse glide.
- **Animation and controls stayed simulation-owned.** The reading pose remained
  planted through Pause and was observed while stepping 1x, 2x, and 3x. The two
  authored frames use the restrained page-adjustment motion visible in the
  generated atlas; automated frame-boundary tests own the exact 12-tick cadence
  and stable-id staggering claim.
- **Every position consumer stayed together.** At default, minimum, and maximum
  zoom, the body, chair, selection ring, and reading indicator remained aligned.
  After selecting Bill in the roster, clicking opaque pixels on Tim's seated
  body selected Tim again. Flat daylight and the automatic 01:54 night state
  both kept the white book and seated silhouette legible.
- **The rebuilt boundaries are green.** Rust passed 292 `terri-sim` tests and 61
  `terri-wasm` tests. The fresh release-WASM Web run passed 420 tests across 28
  files, type checking, the production build, and the 123-sprite 512 by 984
  atlas check. Nineteen targeted Rust and Web mutations failed causally and
  every production file returned to its recorded hash.
- **Runtime stayed quiet.** Browser diagnostics contained expected performance
  logs only, with zero warnings and zero errors. The visible canvas remained on
  the production WebGPU renderer throughout the pass.
- **The merged public build repeats the interaction.** PR 48 merged at
  `d405e70223dcc018f376da8ad52e783f081cbf3c`; [Pages run
  31295985751](https://github.com/thisnameissoclever/terrilives/actions/runs/31295985751)
  built and deployed that exact merge. In the [SHA-labelled public
  session](https://thisnameissoclever.github.io/terrilives/?rev=d405e70223dcc018f376da8ad52e783f081cbf3c),
  a clean new game selected Bill, issued the reading-chair action through the
  displayed canvas, approached at 3x, and paused while the HUD said `Reading`.
  Bill was visibly seated in the chair with the open book and reading indicator
  aligned. The 100 retained browser-console entries were expected performance
  logs, with zero warnings and zero errors. The `rev` query is an observation
  label on a mutable Pages route, not an immutable deployment URL.
- **Proof boundary.** The chosen in-app browser exposes the real operating-system
  media preference but not media emulation, and the host preference was ordinary
  motion. Automated tests prove reduced motion pins reading to frame zero while
  keeping the socket pose; this pass does not claim a watched reduced-motion
  session. The fixed desktop browser did not repeat the already-proven mobile HUD
  geometry or a physical-phone touch and safe-area pass. The merged desktop
  deployment is accepted; those reduced-motion and physical-device boundaries
  remain open.

## [A-local-idle-wandering] Idle movement stays local and remains interruptible

The local production bundle (`index-CHj2f_99.js`,
`terri_wasm_bg-0GxSZI5a.wasm`) was played in the in-app browser at 1280 by 720
and 390 by 844. The deterministic trace also ran for 12,000 ticks against the
shipped pack.

After the reviewed guard split, the exact release bundle
(`index-BYhrFTTB.js`, `terri_wasm_bg-KGkCRcyS.wasm`) received a final desktop
smoke pass. Its WebGPU canvas rendered the lot, advanced from Day 1 00:00 to
06:16, and showed Tim and Bill walking naturally at 1x. The only console error
was the local preview server's missing `favicon.ico`; there was no application
or WebGPU failure.

- **The hard locality contract held.** The trace observed 154 newly started
  natural, targetless strolls. Their walked paths had minimum 1, mean 2.26,
  p95 3, and maximum 3 tiles against the shipped three-tile cap. Tests also
  reject a nearby endpoint when walls would make the actual route longer than
  the cap, so Manhattan distance cannot hide a whole-house detour.
- **Several complete strolls were watched at 1x.** The developer overlay and
  visible WebGPU canvas agreed on four walk-to-idle episodes: Tim from Day 1
  00:02 to 00:10, Casey from 00:02 to 00:13, Tim from 00:31 to 00:43, and Casey
  from 00:35 to 00:43. Each ended back at the ordinary "found nothing worth
  doing" pause rather than at an object action.
- **The same movement survives 3x rather than turning into teleportation.**
  With 3x visibly selected, the overlay recorded complete walk-to-idle episodes
  for Casey from Day 1 06:35 to 06:42 and 07:01 to 07:10, then Bill from 07:10
  to 07:20. The canvas continued to render their movement and reported no
  warning or error.
- **Player intent still wins.** Tim was caught Walking on a fresh natural
  stroll at Day 1 00:02. Clicking the bed through the ordinary canvas input
  redirected that path immediately and reached Sleeping at Day 1 01:00. The
  local-wander rule therefore does not create a separate movement mode that
  ignores player orders.
- **The pace reads calmer without freezing the house.** The feature trace
  spent 29.9% of 36,000 sim-ticks walking, 18.1% in the deliberate between-
  stroll pause, and 0.0% frozen after rounding. Current main measured 34.0%,
  12.9%, and 0.0% respectively. This overall comparison is observational,
  because the new offset draws deliberately change the later random sequence;
  the exact paired claim is the per-path three-tile cap above. Every interactive
  object was still used, and all four started chains completed with none
  abandoned.
- **Speed and layout controls still behave normally.** One wall-clock second
  advanced the clock by about 10 game minutes at 1x and 31 minutes at 3x.
  Pause held Day 1 09:14 unchanged for another second. At 390 by 844, Tim,
  Bill, Casey, both collapsed detail panels, all four speed choices, Save,
  Load, Clear orders, Queue, New game, and Help remained reachable while the
  rendered house stayed visible.
- **Reduced motion is now watched browser evidence.** Browser emulation made
  `prefers-reduced-motion: reduce` report true while the canvas visibly
  advanced through walking frames from Day 1 00:03 to 00:07. The emulation was
  reset and reported false afterward. Deterministic renderer tests still own
  the stronger pixel claim that ornamental walk lift and action-frame cycling
  are pinned; this is not a claim about a physical operating-system toggle.
- **Save compatibility remains structural.** The new radius is appended to the
  compiled tuning record but deliberately excluded from the Save V1 pack
  fingerprint. Historical saves keep an in-progress path unchanged and use the
  local rule only on their next natural roll.
- **Runtime remained quiet.** Desktop play, the four watched strolls, a player
  interruption, 3x, Pause, phone layout, and reduced-motion emulation produced
  zero console warnings and zero errors. The production canvas remained at its
  full 1280 by 720 render size during the desktop passes.

## [A-mobile-hud-reflow] The phone HUD leaves the house playable

The live public build at `62857eeb01100937ba0d4c23f159e9008332e199` was
captured at 390 by 844 before this change. Its 212-pixel desktop-style column
covered 54.4% of the viewport width and 58.0% of its height. The controls were
technically present, but the user's physical-phone screenshot showed the same
practical failure: the feature-expanded HUD had become most of the game.

The rebased local production build (`index-BYhrFTTB.js`,
`terri_wasm_bg-KGkCRcyS.wasm`) was then watched in the in-app browser.

- **Portrait now has an actual canvas aperture.** At 390 by 844, the HUD kept
  eight-pixel safe edges and reflowed to 374 pixels wide. The folded top rows
  ended at y=192.58; speed began at y=635.20, leaving a 442.63-pixel full-width
  transparent band. Its centre hit `CANVAS#stage`, all page scroll dimensions
  matched the viewport, and every roster button, detail summary, speed label,
  and action button measured at least 44 by 44 CSS pixels.
- **The bottom controls use the width instead of consuming it.** Four speed
  choices remain one row. Save, Load, Clear orders, Queue, New game, and Help
  render as three columns by two rows, 132.80 pixels high rather than the old
  three-row 182.80-pixel block.
- **Expanded details are contained.** Opening Needs capped it at a 294-pixel
  client height with its own overflow while the closed People panel remained
  53 pixels high. A probe below that closed sibling still hit the canvas.
  Opening both panels left speed and actions at the same reachable bottom
  positions.
- **The canvas is usable, not merely visible.** A horizontal drag wholly inside
  the exposed band panned the rendered house by roughly half the phone width.
  The visible Pause label held the clock, the visible 1x label resumed it,
  Queue changed `aria-pressed`, and selecting Tim, Bill, and Casey updated the
  same existing panels.
- **Small portrait and landscape keep different useful shapes.** At 320 by
  568, there was no horizontal overflow, every target remained at least 44 by
  44, and a 166.63-pixel canvas band still reached the stage. At 568 by 320 and
  480 by 320, the short-landscape fallback kept a 220-pixel scrollable edge
  column; the viewport centre stayed canvas, and scrolling the column made Help
  visible and hittable. The same edge shape remained at 844 by 390. At 1280 by
  720, desktop layout was unchanged.
- **Enlarged text remains operable.** A validation-only CSS mutation set
  inherited body text to 28 pixels at 320 by 568 with Needs open, more than
  twice the authored 13 pixels. The adaptive details row prevented the panel
  from painting over speed, the outer HUD exposed a 42-pixel vertical scroll
  range, Help became fully visible and hittable after that scroll, and document
  width stayed exactly 320 pixels. This is a deterministic greater-than-200%
  text-size stress, not a claim that an operating-system or physical-browser
  zoom control was watched.
- **The geometry gate owns the new rules.** Nine hand mutations were applied
  one at a time. Narrowing the HUD back to 212 pixels failed the width check;
  removing the flexible row failed the aperture check; returning actions to
  two columns failed the compact-height check; removing the 44-pixel minimum
  exposed 18.19-pixel summaries; stretching the closed sibling intercepted the
  canvas; removing the detail cap failed the 300-pixel bound; disabling the
  short-landscape fallback put actions outside 568 by 320; disabling the
  adaptive open row squeezed expanded Needs to 11.13 pixels, below its 53-pixel
  summary boundary; and removing the outer scroll made Help unreachable. The
  authored file was restored to its original SHA-256 after the full sequence.
- **Runtime remained quiet.** The exact release-WASM build produced no browser
  warning or error during the responsive, expansion, control, and drag passes.
  A physical-phone pass of the corrected merged revision, including safe-area
  insets and long-press, remains deliberately unclaimed.
- **The merged Pages deployment was observed publicly.** PR 44 merged as
  `d7f7493aa7821ed31e3abda928ca2ab3d038d72b`, and its Pages workflow built and
  deployed successfully. In the SHA-labelled public session recorded for that
  deployment, 390 by 844 again measured a 374-pixel HUD, a 442.63-pixel canvas
  aperture whose centre hit `CANVAS#stage`, a 132.80-pixel action block, zero
  undersized controls, and no browser warning or error. At 568 by 320 the
  public page selected the 220-pixel scrollable flex fallback, kept the
  viewport centre on the canvas, and retained 44-pixel targets without page
  overflow. The SHA query is an observation label, not an immutable Pages
  route. This closes the public browser gate, not the physical-phone boundary
  above.

## [A-night-light-pools] Night has local sources without a second draw

The local production build was watched in the in-app browser with release WASM
at 1280 by 720. PR #45 later merged the reviewed slice at `ef9f86c`, and the
deployed GitHub Pages revision was watched separately. A physical phone remains
a separate gate.

- **The day reads as a day.** At Day 2 11:54 the lot returned to the authored
  neutral palette. At 19:51 it was visibly warmer. At 00:06 it was cool and
  dark while the floor lamp formed the stronger stepped pool and the
  television formed a weaker one. Interior walls stopped the fields, doorway
  gaps passed them, and the fixed `+x` furniture-shadow bands remained visible.
- **Selection survives the new range.** The selected Sim was watched outside a
  pool and beside the strongest walkable lamp-lit tile. The pale full-emissive
  outer key measured 5.50:1 against the darkest sampled midnight floor and
  4.41:1 against the brightest adjacent rendered floor in the lamp pool. The
  sage inner key remains the identity colour; it does not carry the contrast
  claim by itself.
- **Flat light is a real preference.** `Light: flat` restored exact neutral
  lighting, exposed `aria-pressed=true`, survived a reload, and returned to
  `Light: auto` without changing the simulation. Reduced-motion emulation
  forced and disabled Flat without overwriting the saved choice. Clearing the
  emulation restored Auto live. The embedded Chromium path missed one change
  event during the first focused retry, so the shell now keeps the normal
  listener and also compares the already-read preference once per frame. That
  cached fallback changes no DOM or buffer while the value is steady. Before
  it was added, the same retry reproduced the stale Auto control; afterward,
  reduce and no-preference converged within the next watched frame. This proves
  the browser media-query path, not a physical operating-system setting.
- **Load rebuilds presentation from current rows.** Confirming Load returned
  to the saved Day 2 midnight scene with the local pools present and the
  dialog closed. The browser reported no warning or error during the visual,
  preference, responsive, Load, or GPU passes.
- **The renderer kept its budget.** A watched 1.05-second interval recorded
  134 frames, 134 draws, and 134 submits. Ordinary frames wrote the 48-byte
  ambient uniform and existing dynamic prefix but not the static block. A
  Flat toggle kept one draw and submit per frame and added one 2,264-float,
  9,056-byte static upload. No second pass, pipeline, or geometry appeared.
- **The new HUD control did not eat the phone layout.** At 390 by 844 the
  folded transparent canvas aperture measured 416.81 pixels and hit the stage.
  At 320 by 568 it measured 140.81 pixels; every visible target remained at
  least 44 by 44 and document width stayed 320. The 568 by 320 and 480 by 320
  short-landscape fallback remained vertically scrollable. At 240 by 568 the
  Light button wrapped without horizontal overflow. With Needs open and body
  text set to 26 pixels at 320 by 568, the outer HUD exposed 17 pixels of
  scroll, Help became fully reachable, and no target fell below 44 pixels.
- **The merged Pages deployment was observed publicly.** The Pages workflow for
  merge commit `ef9f86c` [completed successfully](https://github.com/thisnameissoclever/terrilives/actions/runs/31172208640).
  In the [SHA-labelled public session](https://thisnameissoclever.github.io/terrilives/?rev=ef9f86c5712cdd23b64ae8823c2c8335d89868e0)
  recorded for that deployment, the game loaded its release JavaScript and
  WASM, showed the lamp and television pools at 1280 by 720, and changed from
  `Light: auto` to `Light: flat` with `aria-pressed=true` before returning
  cleanly to Auto. At 390 by 844, with the persisted Needs and People panels
  open, document width remained 390, every measured HUD target remained at
  least 44 pixels high, the center of the remaining canvas still hit `#stage`,
  and the actions ended inside the viewport. The SHA query is an observation
  label, not an immutable Pages route. Public browser diagnostics contained
  only the expected performance telemetry, with no warning or error. This
  public pass proves the deployed browser build, not physical-phone behavior.
- **The remaining accessibility boundary is physical.** The midnight floor
  still needs observation on a real phone in daylight, including safe-area
  insets and ordinary touch use. Browser screenshots, source contrast, and
  emulated media preferences do not close that requirement.

## [A-queue-capacity-feedback] The fifth queued order is refused out loud

The 2026-08-08 implementation pass reproduced [P7] before changing the drain:
five valid object orders entered staging before one paused flush, the per-sim
queue remained at four, and the new result read zero. The exact test failed on
that zero, then passed after the drain began recording the rejection.

- **The simulation owns the answer.** Same-batch tests cover the exact fifth
  append, multiple overflows, queues that already existed, fresh queues,
  `UseObject`, and `TalkTo`. A full-queue cancel reports no failure, and a
  cancel followed by a use accepts the replacement because ordered
  cancellation makes room first.
- **Paused play returns the same fact without hidden time.** The native WASM
  boundary accepts all five well-formed commands into staging, applies them in
  `flush_commands`, leaves the clock at tick zero and the queue at four, then
  returns one take-and-clear capacity rejection.
- **Pointer and keyboard use one result path.** Release-WASM bridge tests drive
  the additive pointer dispatcher and Queue-mode keyboard menu dispatcher.
  Both stage five accepted commands, flush to four intents, consume one
  rejection, and publish `That person's order queue is full` with error styling
  in a dedicated command live region.
- **Displayed acceptance caught a feedback-lifecycle defect.** The first
  implementation left the queue-full message visible after a later accepted
  replacement, and assigning the same text for another rejection gave the
  live region no state transition to announce. The corrected pointer and
  keyboard routes clear the dedicated region at each order attempt. Causal web
  coverage pins reject, accepted replacement, empty state, then the same reject
  again. A frame seam also pins command drain, persistence update, then command
  feedback, while persistence writes only its own status region.
- **The corrected recovery sequence is visible in the real page.** At
  1280 x 720 in the production WebGPU build, five paused Queue-mode clicks on
  the refrigerator left Casey at four waiting orders and showed `That person's
  order queue is full` in red while the separate persistence status remained
  `No save yet`. Turning Queue off and issuing a replacement reduced the
  waiting count to one and cleared the command status. Turning Queue on and
  filling the remaining capacity produced the same visible error again at four
  orders. The final status occupied its own complete line inside the scrollable
  desktop HUD. Browser diagnostics contained only expected performance logs,
  with no warning or error.
- **The merged public revision preserves the result.** PR 46 merged at
  `abd2e736aa111c32a4daa6987aa66162e0bb2a34`; [Pages run
  31287601409](https://github.com/thisnameissoclever/terrilives/actions/runs/31287601409)
  built and deployed that exact SHA. In a [SHA-labelled public
  session](https://thisnameissoclever.github.io/terrilives/?rev=abd2e736aa111c32a4daa6987aa66162e0bb2a34)
  opened immediately after that deployment, five paused Queue-mode `Lie down`
  orders on the large sofa left four waiting orders and showed the red
  queue-full sentence. The separate persistence region still read `Autosaved`;
  scrolling the desktop HUD kept both complete status lines and all controls
  reachable while the WebGPU house remained visible. Public diagnostics
  contained performance logs only, with no warning or error. The `rev` label is
  an observation aid, not an immutable Pages route.
- **Proof boundary.** Native, release-WASM, web integration, and corrected
  desktop renderer evidence are complete for the visible reject, recovery, and
  repeated-reject sequence. A real screen reader was not used, so actual second
  announcement timing remains unobserved even though the DOM transition is
  pinned and was seen clearing in the page. The corrected build was not
  rechecked at phone width or on a physical touch device in this pass.
