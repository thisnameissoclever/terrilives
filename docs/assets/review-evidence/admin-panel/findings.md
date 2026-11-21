# Admin panel played pass, 2026-11-21

Played at 1440x900 (desktop) and 390x844 (phone), day and night, in a muted headless browser on the dev server, from commit 2dc946d23 onward. Every still in this folder was opened at full size. `layout-check.js` returned no findings for every final panel state, with two known exceptions:

- In scrolled states, rows scrolled under the sticky header register as a doubled rule that no one can see. Those captures were moved a few pixels.
- The HUD activity text behind the backdrop is ellipsized on purpose.

## What was checked

- **Opening and closing.** Each tab opened with ~. A long press on the lot's bottom corner tile opened the panel on a phone. A long press elsewhere opened the object menu, and a tap on the bottom tile did nothing.
- **Pause and restore.** The clock stood still while the panel was open. Closing restored paused, 1x and 3x exactly.
- **Edits and Undo.** Need, trait add and remove, job change, feeling, fight, funds, pay from funds and add bill all applied, and Undo stepped back through them.
- **Refusals.** A refused job change showed its reason in place.
- **Skip ahead.** It ran, the clock moved, and Escape stopped it with the panel still open.
- **Debug overlay.** The plain backtick still toggles it. ~ opens the panel and leaves the overlay alone.
- **Saves.** A fight queued from the panel played out after resume, and a save made with the panel open reloaded with the edit.

## Defects found and fixed

| Id | Where | Defect | Fix |
|---|---|---|---|
| D1 | Header | Undo label had a stray gap before its colon | No gap; long changes end in an ellipsis |
| D2 | Traits, desktop | Remove moved around from trait to trait | Name and Remove share the first line |
| D3 | Likes and dislikes | Number boxes did not line up | The word after each number has a fixed minimum width |
| D4 | Relationship cards | Row labels wrapped | Labels get 12em |
| D5 | Bill table | Due select clipped, status wrapped, Delete dropped a line | Narrower money boxes, a 10em Due select, smaller bill buttons |
| D6 | Time card | "Now", "hours" and the date wrapped | 7em labels; the date takes the rest of the line |
| D7 | Relationships | A success note showed in refusal red | Success notes use the muted colour |
| D8 | Career, phone | Pay range and week hints were hidden | The phone rule now hides only the header's hint |
| D9 | Phone rows | A row's hint read as the next row's label | The hint sits under its own label |
| D10 | Traits, phone | Remove sat alone above the next trait | Name and Remove share the top line |
| D11 | Job select, phone | Job title clipped | Selects take their own line |
| D12 | Career | A refusal appeared below the fold | The status line scrolls into view |
| D13 | Bill table | A funds note broke "Delete" across two lines | The note goes under the buttons |
| D14 | Bill table | Status wrapped after D13 | Status stays on one line |
| D15 | Skip ahead | "Now" did not move during a skip | Now follows the skip |
| D16 | Bill table | Overdue looked like a bill still in grace | Overdue alone uses the warning colour |
| D17 | Skip ahead | Disabled number boxes looked live | Disabled number boxes are dimmed |
| N1 | Header | Opening the panel drew a focus ring around the title and Cheat badge | The title keeps its programmatic focus for screen readers and no longer has a focus-visible outline; keyboard rings on real controls are unchanged |
| N2 | Housemate, phone | The tab was about 3,500 px tall | Mood and moodlets, Repetition, Likes and dislikes, Skills, Traits and Career are native details elements, closed on a phone with a one-line summary where there is one (Okay, -8.6; 1 overdoing; the job title), always open on a larger screen; the phone stacks Mood before Repetition as the mockup does; each section keeps its open or closed state across re-reads, edits and Undo |
| N3 | Bill table | Only Overdue was coloured | Overdue is the danger colour and bold, the grace status is amber (a new panel token, as no existing token is a warning amber), Paid is the career-up green and plain weight |

Two phone-only summary strings were added for N2: "{mood word}, {score}" and "{n} overdoing". Both are built from words and values the panel already shows.

Fixes for N1 to N3 were played at 390x844 and 1440x900 after the first pass; `layout-check.js` returned no findings on the new stills apart from the known ellipsized HUD activity text. The stills that showed the old ring, `desktop-night-open-from-paused.png`, `-1x.png`, `-3x.png`, `desktop-night-housemate-tilde.png` and `desktop-night-tilde-opens-panel-not-overlay.png`, were captured again, as were the Household bills and the phone Housemate top. `phone-night-housemate-folded.png`, `phone-night-housemate-career.png` and the day pair show the folded layout; `phone-day-housemate-end.png` was removed with the old tall layout.

## Open after this pass

- **N4.** Outside the panel, a dev-server reload during the save written on page hide left a 0-byte save slot, and the next load failed. This is a persistence question, tracked separately.

## Review round, 2026-11-21

Played at 1440x900 and 390x844 in a muted browser on the dev server, from commit b616048fc. `layout-check.js` returned no findings for every state below. The check was run as an equivalent condensed copy of the file's logic (comments and fix text removed), loaded once per page. Every still named here was opened at full size.

| Fix | What changed | Where seen |
|---|---|---|
| Career refusal | The Career card's status line sits directly under the Job and Shift controls and still scrolls into view. | `desktop-night-refusal-job-change.png`, `phone-night-housemate-career.png` |
| Repetition rows | Rows that share an action label also name their object, and are numbered when the object names match too. | Unit tests only: a second bookshelf could not be set up in Build mode without playing until both shelves have been used. |
| New bill row | The row starts on the first free kind and due day, Add bill is disabled for a pair that exists, and the whole row is shut when none is free. | `desktop-night-household-bills.png` (rent on Day 1 offered, as Day 8 holds all four kinds) |
| Funds note | One bill short keeps its note under its row; two or more share "Funds don't cover these bills." once under the table. | `desktop-night-household-bills.png` |
| Job search on a phone | The description sits beside its check box. | `phone-night-housemate-career.png` |
| Close after a skip | A skip that ends with the session refused closes the panel with the same refresh as every other close (test). | Unit test |
| Build while broken | `begin_build` refuses a broken world as Build failure 17 (Rust test, web decoders and tests). | Rust and vitest |
| Dead-key tilde | The Dead keydown does nothing and the next key's tilde opens the panel (test only). Italian removed from the layouts named. | Unit test |
| Capability hint | "how far learned" is now "improvement" (owner wording). | `ui-admin-housemate-desktop.png` in the guide folder |

The guide pictures `ui-admin-household-desktop.png`, `ui-admin-household-mobile.png`, `ui-admin-housemate-desktop.png` and `ui-admin-housemate-mobile.png` were recaptured with their desktop crops, hashes and a new source snapshot.
