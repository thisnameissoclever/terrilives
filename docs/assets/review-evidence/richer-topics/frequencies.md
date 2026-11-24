# Richer topics: how often a chat is about a subject

Measured on 2026-11-23 for [RT-tests] in
[the richer topics specification](../../../specs/2026-11-22-richer-topics.md).

## Command

```
cargo run --release -p terri-sim --example topic_frequencies -- 1 3 20
```

The arguments are the first seed, the last seed and the game days. Each world
starts from the shipped lot as `conversation_households` does: seed set with
`SimRng::from_seed(seed)`, the chore stream seeded with `seed ^ 0x4348_4f52_4553`,
mortality on. Every finished chat or fight is read from the activity log, and
its topic is the log record's second label. The example is
`crates/terri-sim/examples/topic_frequencies.rs`.

Seeds 1, 2 and 3, 20 game days each. No fight finished in any run, so every
count below is a chat.

## Before subjects

The same command with `content/topics.toml` holding only the `unknown-subject`
row, which is never offered.

| Topic | Seed 1 | Seed 2 | Seed 3 | Total |
| --- | ---: | ---: | ---: | ---: |
| television | 12 | 1 | 8 | 21 |
| socialising | 10 | 5 | 7 | 22 |
| exercise | 2 | 5 | 3 | 10 |
| lounging | 0 | 4 | 1 | 5 |
| reading | 0 | 3 | 1 | 4 |
| cooking | 2 | 1 | 0 | 3 |
| aquarium | 1 | 1 | 0 | 2 |
| correspondence | 2 | 0 | 0 | 2 |
| Chats | 29 | 20 | 20 | 69 |

## First authored values

Trains variation 0.9, the other four subjects as in the specification: 28 of 78
chats were about a subject, 35.9 percent, with trains alone taking 17. That is
over the 35 percent edge, and one subject dominated.

Trains variation 0.6 gave 26 of 80, 32.5 percent, with trains still 14 of them.

## Final values

Trains variation 0.45. Nothing else changed: bicycling, gardening, the weather
and work are as the specification gives them.

| Topic | Seed 1 | Seed 2 | Seed 3 | Total |
| --- | ---: | ---: | ---: | ---: |
| television | 4 | 8 | 9 | 21 |
| socialising | 4 | 2 | 5 | 11 |
| reading | 4 | 2 | 1 | 7 |
| lounging | 2 | 2 | 2 | 6 |
| correspondence | 2 | 2 | 1 | 5 |
| exercise | 3 | 0 | 1 | 4 |
| aquarium | 2 | 1 | 0 | 3 |
| cooking | 0 | 2 | 0 | 2 |
| subject: trains | 6 | 1 | 2 | 9 |
| subject: gardening | 1 | 2 | 1 | 4 |
| subject: the weather | 1 | 1 | 2 | 4 |
| subject: bicycling | 1 | 0 | 1 | 2 |
| subject: work | 1 | 0 | 1 | 2 |
| Chats | 31 | 23 | 26 | 80 |
| About a subject | 10 | 4 | 7 | 21 |
| Share about a subject | 32.3% | 17.4% | 26.9% | 26.3% |

The share is inside 15 to 35 percent in every seed and overall.

## No activity topic vanished

Every topic in the first table appears in the second. A single seed can lose a
topic it had before, such as exercise in seed 2, because the first subject chat
changes every draw after it and the three worlds then diverge from their old
courses. Across the three seeds, each of the eight activity topics still
occurs. The totals fall because subjects take about a quarter of the chats.

## Limits

Eighty chats is a small sample, and a world's later draws depend on its earlier
ones. Treat the share as showing the order of magnitude, not a precise rate.
