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

---

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

## What does not work

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

`content/tuning.toml` names this exact outcome as the thing to avoid, in its
own words: the fifth rapid click "does nothing at all, and a click that does
nothing is the exact failure [D-3] exists to prevent." It is now reachable
by leaning on the mouse.

Worth adding: `input.ts` currently discards the return value of every
command it sends, so even the *observable* half - a full staging queue,
which is easiest to reach while paused, since nothing drains at speed 0 - is
thrown away. Fixing that is a small change and fixes the smaller half of the
problem. The larger half needs a decision rather than a patch: either the
drain reports refusals back across the boundary, or the shell stops being
able to over-promise by refusing the click itself at the cap.

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

**Watched session: PENDING.** The browser pane was not displayable at
measurement time (the page loads, the loop is rAF-driven and pauses
hidden). Per the standing rule this section does not claim the system
works on screen until it has been watched; the watch and its notes are
the outstanding half of this entry.

