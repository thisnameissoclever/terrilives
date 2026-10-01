# Activity bubbles

Activities and waiting have a bubble above the Sim's displayed head. Walking
has no bubble because it is travel toward an activity. The 21 displayed symbols
share a linen circle, charcoal strokes, a logical 26-pixel size,
and texture density two. Revised existing symbols append alongside new ones;
the 1,370 historical atlas records retain their indices and decoded pixels.

`activity` is optional authored presentation metadata on ordinary interactions
and chain steps. It does not enter the compatibility fingerprint, persisted
simulation state or world hash. The exact live target and interaction identity,
or running chain step and matching station role, must validate before the code
can reach the renderer. Existing exact body visuals keep their precedence.
An unauthored or malformed ordinary use retains the generic gear. A walking
chain carrier shows its carried item; its activity bubble appears when station
work begins. The unused footprints sprite remains in the append-only atlas.

| Interaction or state | Code | Symbol |
| --- | --- | --- |
| Walking, wandering travel, commute travel | 1 | No bubble |
| Reserved conversation partner or blocked item wait | 2 | Clock |
| `fridge.grab_snack`, dinner step 3 at table or desk | 3 | Fork and spoon |
| Both conversation participants | 4 | Speech bubbles |
| `bed.sleep`, `double_bed.sleep_properly` | 5 | Zz |
| Generic unauthored ordinary use | 7 | Gear |
| `bookshelf.read`, `reading_chair.settle_in` | 8 | Open book |
| `moving_box.use_exercise_bike` | 9 | Bicycle |
| `reference_shelf.watch_fish` | 10 | Centered fish |
| `sofa.lounge`, `dining_table.sit_properly`, `armchair.take_the_chair` | 11 | Chair |
| `shower.take_shower` | 12 | Showerhead and drops |
| `toilet.relieve_self` | 13 | Toilet |
| `television.watch_tv` | 14 | Television |
| `long_sofa.stretch_out` | 15 | Person lying on a couch |
| `sink.wash_hands` | 16 | Hand and water drop |
| `kitchen_sink.wash_up` | 17 | Plate and bubbles |
| `radio.listen` | 18 | Radio |
| `desk.attend_correspondence` | 19 | Envelope |
| `bathtub.soak` | 20 | Bathtub |
| Dinner step 0, cold storage | 21 | Ingredient basket |
| Dinner step 1, preparation surface | 22 | Knife and board |
| Dinner step 2, hob | 23 | Steaming pot |

Idle/deciding code 0 has no active task and no bubble. At-work code 6 has no
visible body on the lot. Decorative furniture, laundry and loose chairs have
no executable interactions in this content pack and need no invented activity.
The dining table's existing menu label says "Sit down to eat", but that
ordinary interaction supplies comfort and social needs; its icon correctly
shows sitting. Actual dinner eating is the terminal dinner-chain step.

The bubble follows the displayed body's content top, scales with the camera,
and shares occupied footprint depth so near furniture cannot cut it in half.
The renderer and its instance counter use the same activity mapping and draw
bubbles only for agents. Reduced motion and pause preserve meaningful icons.

Review evidence and validation are recorded in
`docs/assets/review-evidence/activity-bubbles/README.md`.
