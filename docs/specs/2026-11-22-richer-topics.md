# Richer conversation topics (issue 275, phase 2)

This document replaces [AL-topics] in [the activity log specification](2026-10-18-activity-log.md) and Tasks 14 to 19 of [its plan](../superpowers/plans/2026-10-18-activity-log.md). Those were written on 2026-10-18; the fights work, save schema 27 and the activity log changed the code they describe. Facts below were read on main `b0aa7799c`.

## Contents

- [[RT-decisions] Owner decisions](#rt-decisions-owner-decisions)
- [[RT-today] How topics work today](#rt-today-how-topics-work-today)
- [[RT-content] Topics in content](#rt-content-topics-in-content)
- [[RT-identity] Topic rows replace activity codes outside saves](#rt-identity-topic-rows-replace-activity-codes-outside-saves)
- [[RT-subjects] Subjects](#rt-subjects-subjects)
- [[RT-saves] Saves, hashes and the content digest](#rt-saves-saves-hashes-and-the-content-digest)
- [[RT-shell] Shell changes](#rt-shell-shell-changes)
- [[RT-tests] Tests](#rt-tests-tests)
- [[RT-rulings] Rulings for owner confirmation](#rt-rulings-rulings-for-owner-confirmation)
- [[RT-out] What this does not do](#rt-out-what-this-does-not-do)

## [RT-decisions] Owner decisions

The owner decided these on 2026-11-22:

1. Subject interests are derived from existing traits, skills, likes and job satisfaction plus a fixed personal variation. They are not saved and are not editable in the creator or the admin panel.
2. Subjects change chats only. They do not enter `compatibility::between`, so relationship drift and friction are unchanged.
3. Each housemate's subject interests appear, read only, in their Likes and dislikes panel with the existing Loves to Hates words.
4. The subjects are Trains, Bicycling, Gardening, Weather and Work. Only an employed housemate offers Work.
5. Subjects use the existing Talk symbol with the like or dislike tint until they have their own art.
6. The internal refactor ships in the same pull request: every topic moves into content, and outside saves a topic is identified by its content row instead of an activity code.

## [RT-today] How topics work today

- A runtime `Topic` (`crates/terri-sim/src/social_episode.rs`) holds a saved `code`, a `tag` and both people's preferences. `begin_topics` draws one from the initiator's positive activity preferences with one `SimRng::next_f32`. `fights::begin_topic` builds a fight topic with no draw from the saved fight context.
- The code doubles as art. `TOPIC_CODES` maps tags to activity-status codes 3 to 23; any other tag gets 7. Fight reasons take codes 24 to 32 and random fights 33 to 53 (`Reason::code`, code = activity code + 30). Codes 24 to 26 collide with the mopping, wiping and bin activity codes in `render_buffer.rs`; nothing misreads them today.
- The render column `conversation_topics` carries the raw code. `web/src/render/conversation-bubbles.ts` indexes a 54-entry `TOPICS` sprite table by it, draws the Dislike sprite and a red tint for any code 24 or above, and otherwise draws Like or Dislike by the preference's sign with a tint by its size. Code 7 draws the Use sprite.
- The activity log stores the topic's tag through its label table, and `web/src/ui/activity-log-words.ts` maps tags to words in a TypeScript table.

## [RT-content] Topics in content

`content/topics.toml` holds one `[[topic]]` per topic, in a fixed order that becomes the row number:

| Field | Meaning |
| --- | --- |
| `id` | Stable identifier, unique. |
| `kind` | `smalltalk`, `activity`, `fight` or `subject`. |
| `label` | Player word used in "about {label}" and in Likes and dislikes. Empty for a topic with no subject (small talk, a plain argument). |
| `icon` | Name of a conversation bubble sprite. The web shell test proves every name resolves. |
| `code` | For `smalltalk`, `activity` and `fight`: the frozen saved code. It must equal today's `tag_code` (chats) or `Reason::code` (fights) for every tag of the row. |
| `tags` | For `smalltalk` and `activity`: the saved tags that resolve to this row. A tag may appear in only one row. Tags need not appear on any object; several are legacy aliases that old saves still carry. |
| `reason` | For `fight`: the fight reason tag. |
| `sources`, `variation`, `bias`, `requires` | For `subject`; see [RT-subjects]. |

Activity rows cover every code 3 to 23 that the current `TOPICS` table draws, including codes reached only by random fights. One activity row, `other`, has code 7, no tags, the label `something` and the Use icon; every unknown chat tag resolves to it, which is how code 7 behaves today. One subject row, `unknown-subject`, is never offered and resolves any `subject:` tag that content no longer has.

The compiler (`crates/terri-data`) follows the `books.toml` pattern: it compiles after `compile()`, stores `pack.topics`, and refuses duplicate ids or tags, an unknown kind, a missing or extra field for the kind, a weight outside -1 to 1, a negative variation, an unknown skill, affinity or `requires` value, and a subject without sources, bias or variation. Every `ContentPack` struct literal, including the frozen and published pack readers, gains the field with its default.

## [RT-identity] Topic rows replace activity codes outside saves

1. The runtime `Topic` gains `row: u16`, resolved when the topic is created and when it is loaded: a subject tag `subject:{id}` resolves to its row or to `unknown-subject`; a fight reason tag to its fight row; `fight-random-{n}` to the activity row whose `code` is `n`; any other tag to its activity row, small talk's row or `other`. `code` and `tag` stay the saved fields with unchanged values.
2. The render column carries `row + 1`, with bit 16 set for a random fight, and 0 outside a chat. The column type stays `u32`.
3. A new wasm export `conversation_topic_table()` returns one line per row: `kind`, `icon` and `label`, tab separated, in row order. The shell reads it once.
4. A new wasm export `activity_log_topic_rows()` returns, for each entry of the activity log label table, the same render value for that tag, or 0 for a tag that is not a topic. The log composer uses it for topic words.
5. The bubble table is built from the topic table. A fight row or the random-fight bit draws the Dislike sprite and the red tint; any other row draws Like or Dislike by the preference's sign and tints by its size, as today. A random fight draws the art of its activity row, as code `n + 30` does today.
6. `TOPIC_CODES` and `tag_code` survive only to compute and validate saved codes. A test proves every row's `code` equals them.

## [RT-subjects] Subjects

### Interest

`interest(person, subject) = clamp(bias + sum(weight * source value) + variation * personal(person, subject), -1, 1)`

| Source kind | Value |
| --- | --- |
| `tag` | The person's `compatibility::preferences` value for the tag, or 0. |
| `skill` | The person's mastery of the skill, 0 to 1. |
| `affinity` | The person's saved affinity for the kind, -1 to 1. |
| `job` | `(job_satisfaction - 50) / 50` for an employed person, 0 otherwise. |

`personal` is FNV-1a 64 over the person's `SimId` as little-endian bytes and then the subject id's bytes, mapped to -1 to 1 by its top 53 bits. It draws nothing from `SimRng`, needs no saved state and does not depend on entity order. `requires = "job"` means only an employed person offers the subject; a listener without a job still has an interest from the other terms.

### Authored subjects

These values are rulings for owner confirmation ([RT-rulings]); they are tuned by the frequency measurement in [RT-tests].

| id | label | bias | sources | variation | requires |
| --- | --- | --- | --- | --- | --- |
| trains | trains | 0 | none | 0.45 | |
| bicycling | bicycling | 0 | tag exercise 0.5; skill exercise 0.3 | 0.5 | |
| gardening | gardening | 0 | affinity plants 0.6 | 0.5 | |
| weather | the weather | 0.1 | none | 0.6 | |
| work | work | 0 | job 0.8 | 0.3 | job |

### In conversations

`begin_topics` appends every subject the initiator offers with a positive interest after the activity candidates, in content order, with the same `topic_weight(mine, theirs, inclination)` and the same single draw. The initiator's preference is their interest and the listener's preference is the listener's interest, so a listener can dislike trains while the initiator loves them. Completion, the activity log and interruption rules read the saved preferences exactly as they do for activity topics. A chat with no candidate is still small talk, and a fight still takes its reason with no draw.

## [RT-saves] Saves, hashes and the content digest

1. **Schema.** Unchanged. A subject topic saves as code 7 with the tag `subject:{id}`, which `restore_into_mode` in `crates/terri-sim/src/save/social.rs` already accepts: the code is in 3 to 23 and not 6, equals `tag_code` of an unknown tag, and the initiator preference is positive. Old saves load to the same rows they draw today.
2. **Random stream.** Each chat still spends one draw, or none for small talk or a fight. The topic a draw selects changes whenever a subject is a candidate, so worlds diverge after the first such chat. That is the intended behavior change.
3. **World hash.** The `social-episodes-v1` block keeps hashing code and tag; the row is derived and is not hashed.
4. **Pins.** `world_hash_matches_its_golden_vector` and its browser copy complete three chats in their 100 ticks, so subjects move them; both are re-pinned with the reason, measured on native and on rebuilt release WebAssembly. Every other pin that moves is classified by [L-fingerprint-fixtures-by-role](../lessons-learned.md#l-fingerprint-fixtures-by-role-classify-every-digest-expectation-before-changing-a-hash), confirmed to complete a chat, and re-pinned with the reason beside it. Published-save continuation pins are reported to the owner before any is re-pinned.
5. **Content digest.** Topics stay out of `content_fingerprint`. A restored topic carries both preferences, completion reads only those, and a row resolves from the saved tag with a defined fallback, so no restored state depends on topic content ([L-save-digest-must-follow-post-load-reads](../lessons-learned.md#l-save-digest-must-follow-post-load-reads-a-save-digest-owns-current-content-reads-after-load-too)). A test pins that adding `topics.toml` leaves the digest unchanged.
6. **Save manifest.** Topics are not added to `SavedActionManifest`.

## [RT-shell] Shell changes

1. `conversation-bubbles.ts` builds its sprite and tint lookup from `conversation_topic_table`. The legacy 54-entry table survives only in a test, which proves every old code draws the same sprite and tint as before through its row.
2. `activity-log-words.ts` drops its tag-to-word table; a topic's word is its row's label, and an empty label means no subject. The phrases around topics are unchanged. As before, a chat tag that no row names, such as one from an older save, is not in the Log's label table, so its line names no subject; its bubble still draws the `other` row.
3. The Likes and dislikes panel appends one read-only row per subject after the affinity rows, through a new read `subject_words_of(entity)` with the same band words and edges as `affinity::band`, aligned with `subject_labels()`. The Work row shows only for an employed housemate; for anyone else its entry is empty. The admin panel's editable likes are unchanged.

## [RT-tests] Tests

- `terri-data`: compiler tests for each refusal in [RT-content]; `topics_do_not_move_the_content_digest`; `every_topic_row_code_matches_its_saved_code`.
- `terri-sim`: `old_topic_tags_resolve_to_the_same_rows_after_load`; `random_fight_topics_resolve_to_their_activity_row`; `subject_interest_is_independent_of_entity_order` with archetype churn; `subject_interest_stays_within_range`; one test per source kind; `work_is_offered_only_by_employed_people`; `topic_draw_spends_one_value_and_includes_subjects`; `subject_topic_round_trips_through_a_current_save`; `subject_topic_loads_through_the_v19_published_reader`; `missing_subject_loads_as_unknown_subject`; `subjects_do_not_change_compatibility`.
- `terri-wasm`: the two new exports, and a subject chat crossing the activity log with its row.
- `web/tests`: `legacy_topic_codes_keep_their_art`, every icon resolves to a sprite, log words come from rows, and the Likes and dislikes subject rows, against a freshly built wasm.
- Frequency: topic counts over 20 game days for three seeds, recorded in `docs/assets/review-evidence/richer-topics/`. Subjects should be chosen in roughly 15 to 35 percent of chats without removing any activity topic that appeared before.
- Played pass per [Testing Protocol, section 9](../testing-protocol.md#9-every-milestone-ends-with-a-played-visual-pass) at 1440 by 900 and 390 by 844: a watched subject chat with its Talk bubble and tint, the log line naming the subject and both reactions, the Likes and dislikes subject rows, and an old save's chats drawing as before.

## [RT-rulings] Rulings for owner confirmation

- [RT-R1] The subject weights, biases and variations in [RT-subjects], subject to the frequency measurement.
- [RT-R2] The subject labels read in sentences as "about trains", "about bicycling", "about gardening", "about the weather" and "about work", and in Likes and dislikes as Trains, Bicycling, Gardening, The weather and Work.
- [RT-R3] A subject that later leaves content loads with the word "something".

## [RT-out] What this does not do

No saved interests, creator or admin fields, compatibility change, new bubble art, new chat frequency, or change to how fights choose their reasons.
