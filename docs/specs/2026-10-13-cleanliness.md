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
before applying the response. The floor moodlet averages those responses over
the existing walkable floor membership of the current room. The surface moodlet
averages them over its existing counter and table membership, including clean
members. Each penalty is `-(0.3 + c) * mean_response`. A dirty source can matter
in a large room even when average raw dirt would fall below the threshold.
Fully dirty floors and surfaces retain their separate maximum penalties.

Visible room dishes use `min(total_units / 6, 1)` as dirt. Their mood penalty
is `-(2 + 8 * c) * 1.5 * response`, retaining the existing maximum. The extra
penalty from a dish actually blocking a place setting remains separate.

Ordinary dish annoyance uses that same room response. Each newly noticed foreign
owner receives the existing directional contribution multiplied by the response.
Own dishes count toward room dirt but never create self-blame. A below-threshold
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
reset a decision. Threshold checks add no random draws or saved fields. Grouped
surface reconciliation and completion credit use the duty owner's tolerance,
so they agree with eligibility even when somebody else performs the work.

Verification records belong in
`docs/evidence/2026-10-13-creator-repair/mechanics/`. Runtime acceptance is separate
from the native mechanics checks.
