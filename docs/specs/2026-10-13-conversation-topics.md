# Conversation topics and social company

Issues #245, #246 and #247 define this change. Existing activity selection,
conversation ownership and shared participation remain the simulation owners.

## Intended behavior

Social interaction provides a positive Social benefit even at maximum dislike.
Affinity scales that benefit, and family adds a small bonus independent of
affinity. Selection uses the same benefit as delivery, so loneliness increases
the value of actual company. Solitary activities never claim company rewards.

An approaching conversation initiator can wait beside a busy recipient. The
recipient finishes their current activity before talking and stays available
when idle. Player-ordered conversations retain their order through busy
recipients, urgent physical needs and work. Incoming requests appear in the
recipient's queue and run after their current activity. Intentional cancellation
and explained failures release participants. The detailed lifecycle, work
confirmation and attendance rules are in [player orders](2026-10-17-player-orders.md).

A newcomer joining a communal activity can extend existing participants to
the newcomer's remaining duration. Each participant may receive at most two
extensions during one activity. Travel does not count as participation.

The initiator chooses one enjoyed activity topic with seeded weighted
randomness. Greater enjoyment of socializing increases the weight of shared
interests. The weighting also supports mastery if a social skill is authored;
the shipped skill catalogue does not currently include one. The listener may dislike the topic, causing a small directional
affinity penalty once per conversation. Each person's bubble shows speech at
top left, the topic at top right, and a smaller approval or disapproval symbol
below. Backgrounds range from white to pale green or red according to that
person's preference, with readable dark symbols. The bubble stays circular,
with the existing linen background and warm ink strokes. Its logical diameter
is 42 pixels; ordinary activity bubbles remain 26 pixels.

If no authored interest is positive, neutral small talk still provides company.
It does not recast a disliked activity as a liked interest. A disliked chosen
topic replaces the listener's ordinary positive completion reward with a small
negative affinity change; Social delivery remains positive.

Topics, waiting ownership and extension limits survive save/load. Previously
published saves remain loadable through their frozen format readers.

## Implementation and verification

1. Extend simulation selection and delivery together; test dislike, asymmetric
   affinity, family and solitary activities.
2. Implement waiting and bounded communal extensions; test interrupted travel,
   busy recipients, actual arrival, repeated newcomers and cleanup.
3. Add deterministic topics and expose aligned per-person topic and preference
   columns to the browser. Preserve simulation decisions across saves.
4. Render and inspect compound bubbles. Test icon placement, tint, instance
   allocation and ordinary activity bubbles.
5. Run affected local workflow checks, save compatibility tests, targeted
   mutation checks and an independent adversarial review. Resolve valid findings.
6. Update the public changelog, merge the reviewed branch, synchronize the
   checkout and verify the required Pages publication.

No dependency changes are required. Generated art and save formats must retain
their historical contracts. Remote test and review completion are not merge
gates for this delivery; deployment remains required.
