# Cleanliness and tolerated mess

Cleanliness controls when a Sim starts reacting to mess as well as the strength
of that reaction. It remains separate from Hygiene, chore responsibility,
chore preference, and skills.

## Response

Clamp cleanliness `c` to `0..1`, then calculate:

```text
threshold = 0.40 - 0.35 * c
response = clamp((dirt - threshold) / (1 - threshold), 0, 1)
```

Cleanliness 0, 0.5, and 1 tolerate dirt through 40%, 22.5%, and 5%, respectively.
At the threshold the response is zero. Above it the response rises continuously
to one at maximum dirt.

## Mood and relationships

Each floor tile and each surface converts its own dirt amount to `dirt / 1000`
before applying the response. Source timing follows the physical mess rather
than an assigned owner's cleanliness; each observer retains their own response. The floor moodlet averages those responses over
the existing walkable floor membership of the current room. The surface moodlet
averages them over its existing counter and table membership, including clean
members. Each penalty is `-(0.3 + c) * mean_response`. A dirty source can matter
in a large room even when average raw dirt would fall below the threshold.
Fully dirty floors and surfaces retain their separate maximum penalties.

Environmental penalties wait until the source has stayed at maximum dirt for
120 game minutes, or has remained actionable cleaning work for 1440 game
minutes. The clock measures continuous elapsed game time, including across
midnight. Pause does not advance it. Falling below maximum dirt restarts the
maximum-dirt clock. Cleaning a source to zero clears its unfinished-work clock.
A duty's separate clock clears when work falls below its owner's tolerance. Newly created work remains available for cleaning during
the grace period. Removed or no longer cleanable sources lose their timers.

Visible room dishes use `min(total_units / 6, 1)` as dirt. Their mood penalty
is `-(2 + 8 * c) * 1.5 * response`, retaining the existing maximum. The extra
penalty from a dish actually blocking a place setting remains immediate and
separate. A room has maximum dish dirt at six visible dish units. Ordinary dish
mood and blame use only piles whose grace has expired.

Ordinary dish annoyance uses that same room response. Each newly noticed foreign
owner receives the existing directional contribution multiplied by the response.
Own dishes count toward room dirt but never create self-blame. Fresh piles are
not marked noticed while waiting for grace. A below-threshold
pile is not recorded as already noticed for annoyance, so a growing pile can
cross the threshold during the same visit. Once reacted to, the existing pile
and visit guards prevent per-tick charges. Floor and surface grime do not invent
a responsible housemate.

## Daily duties and persistence

A floor or surface duty becomes eligible when any source exceeds its assigned
owner's tolerance. Dishes use the same normalized dish response over the existing
household dish inventory. Bins retain their 600-unit threshold. Explicit cleanup
orders still accept smaller amounts.

The existing needs readiness, own-dish cleanup probability, willingness formula,
and single saved daily decision remain in force. Changing cleanliness does not
reset a decision. Threshold checks add no random draws. Independent schema-nineteen timing records
preserve grace without changing the published chore or dish record layouts. Grouped
surface reconciliation and completion credit use the duty owner's tolerance,
so they agree with eligibility even when somebody else performs the work.

Verification records belong in
`docs/evidence/2026-10-13-creator-repair/mechanics/`. Runtime acceptance is separate
from the native mechanics checks.


## Neglect and saves

Midnight neglect and resentment toward a skipped-duty owner when another
housemate completes the work share the same grace policy. A fresh duty near
midnight cannot lower commitment history or relationships a minute later.
Once an unfinished duty has been observed beyond grace, its episode retains
that fact through gradual cleaning. Reducing dirt resets the physical source's
clocks without erasing an already overdue duty while genuine cleaning continues.
Discharging the work below the owner's tolerance, cancelling its remaining
cleanup, or removing its last dirty source clears the historical mark. Fresh
work on the same daily duty then gets fresh grace. Completion still rewards the
actual helper, and a real obstructed seat can prompt an immediate complaint.

Schema nineteen wraps the complete frozen schema-eighteen payload with sorted
source and duty timers plus the IDs of unsettled episodes observed beyond grace.
The world hash includes that state. Loading validates
source references, assigned owners, ordering and timestamps before adoption.
Saves from before schema nineteen begin a fresh grace period; loading cannot invent historical neglect.
Build commits, cancellation and ordinary native transactions carry the complete
current envelope. Land growth translates floor timer indexes with the grime
they describe.

## Appreciation and argued duties

Completed physical cleaning raises each other living housemate's opinion of its actual cleaner by `0.006 + 0.006 * cleanliness`. This applies with the board off and to repeat work. Dish washing pays once per completed batch; board settlement does not duplicate it. Canceled and zero-unit work earn none.

A completed argument about an overdue current duty can produce a saved willingness decision and a four-hour relationship repair window. The [fight contract](2026-10-16-fights.md) owns its centered 80% response formula, actual contribution evidence and scope rules. Remaining original dishes preserve partial-washing continuity. Fresh dirt and reassigned duties cannot inherit the old reward. Schema twenty carries this state around the frozen schema-nineteen neglect records. Saves from before schema nineteen begin fresh grace; loading schema nineteen preserves its recorded grace.
