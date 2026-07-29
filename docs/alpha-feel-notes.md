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

### [C1] The sink can never vary, and that is content

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

### [C3] An agent beaten to an object is told nothing is worth doing

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
delivered 33. Now 21 ticks and 32 hygiene; measured 14 to 27, mean 20.8. The
fridge and toilet were clipped at the bottom of their bands and are now 30 and
24. No interaction is pinned any more, and `ClippedDuration` in terri-data fails
the build for any that would be.

**The sink needed its delta raised too, and that is not cosmetic.** Raising the
duration alone moved its score denominator from `4d + 9` to `4d + 22` while its
only competitor - the shower - kept its 45 and lost nothing. Usage fell from 6
interactions to **1**, which is within a rounding error of the bookshelf's zero.
Fixing a duration by turning the object into furniture is not a fix. At 32 the
two score within about 2% at observed mid-run levels, so which one a sim picks
genuinely turns on how tired it is - which is what the object was always
documented to do and never did.

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
