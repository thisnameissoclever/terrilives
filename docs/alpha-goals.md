# The playable-alpha goal, as eleven DONE criteria

The standing goal this project is building toward: **a full, genuinely
playable alpha - a life sim you can sink an hour into.** Every criterion
is verified by RUNNING the game and watching it, not by tests alone.
This file exists because the criteria governed months of work while
living only in session context; they are project requirements and
belong in the repository ([A-11] docs debt).

**Each criterion was measured when its milestone shipped, and that was
not enough.** Run against the FINISHED alpha, with every system present
at once, three of them failed - see [A-18] and
`docs/specs/2026-08-01-alpha-acceptance-findings.md`. A criterion is
verified against the whole game or it is not verified.

1. A household of at least three sims with visibly different behaviour
   traceable to personality data, contending for objects without
   deadlock. (Shipped: M2c, measured in alpha-feel-notes [A-9].)
2. Sims satisfy each other's social need, with relationships.
   (Shipped: M2d, measured in [A-10].)
3. Habituation: no object at zero uses over 12 000 ticks, back-to-back
   repeats under 2%. (Shipped: M1c onward. The reading chair was AT
   zero when the acceptance pass ran it against the finished game;
   fixed and re-measured in [A-18].)
4. Satisfaction and hobbies consume idle time. (Shipped: M2e PR 1,
   measured in [A-12].)
5. Traits: dispositions weight choices, capabilities gate them,
   conditions act. (Shipped: M2e PR 2, measured in [A-13].)
6. A career. (Shipped: M2e PR 3 - the rabbit hole, the day clock,
   funds; measured in [A-14]. The acceptance pass found the shift was
   also starving the worker - fixed via `at_work_decay_scale` and
   re-measured in [A-18].)
7. Multi-step interactions - fridge to counter to stove to plate to
   table - with resume after interruption. (Shipped: M2f - chains as
   content, terminal-only payoff, resume through player and career
   preemption; measured in [A-15].)
8. A home with multiple rooms, 25+ objects, real footprints.
   (Shipped: M2a/M2b.)
9. Persistence: save and load. (Shipped: M2g. Versioned, validated
   snapshots live in OPFS; a saved household resumes on the same tick.
   The acceptance pass found 28.4% of ticks produced a snapshot that
   would not load - three target kinds, one modelled; fixed and
   re-measured in [A-18].)
10. Readable UI: needs, selection, time controls, and who is doing
    what. (Shipped: A-11 and M2g. The normal HUD now shows the clock,
    funds, satisfaction, career, current activity, queued orders, save
    state, and touch and keyboard controls without debug mode.)
11. The game's voice - dark comedy - present in play, authored WITH
    the owner ([L58]). (Owner voice session still required; the string
    inventory and functional-text boundary are shipped in M2g.)
