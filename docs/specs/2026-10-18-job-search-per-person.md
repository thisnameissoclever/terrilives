# Job search for each housemate

Issue 297: automatic job search for unemployed housemates becomes each housemate's own setting instead of one household setting. It is on for every housemate when they are created, and the player changes it in the Career tab of Sim details. This replaces the job search half of rules 13, 15 and 16 of the [careers spec](2026-10-17-careers.md); the change-of-path setting stays one household setting in Options. Rulings marked **For confirmation** are the implementer's choices and wait for the owner's confirmation.

## Contents

1. [The setting](#js-setting-the-setting)
2. [Commands](#js-commands-commands)
3. [The search](#js-search-the-search)
4. [World hash](#js-hash-world-hash)
5. [Saves](#js-save-saves)
6. [Older saves](#js-migration-older-saves)
7. [The Career tab](#js-shell-the-career-tab)
8. [Verification](#js-tests-verification)

## [JS-setting] The setting

Each living person either looks for work on their own while unemployed or does not. The `Careers` resource holds the set of people whose search is off, by permanent `SimId`; everyone else searches. A new game therefore starts with everyone on, and every newcomer, whether moved in from the character creator or by any other route, starts on without any extra step. A death removes the person from the set with their other career records.

**For confirmation:** the setting belongs to the person whether or not they hold a job. It does nothing while they are employed and applies again if they are fired or quit. Turning it off never stops player-directed assignment, the weekly reviews or a change of path; the change-of-path setting stays one household setting.

## [JS-commands] Commands

`SimCommand::SetJobSearch { agent, search }`, code 36, sets the search of the person carrying entity index `agent`, as the other per-person career commands name a person. An index that names no living person changes nothing. `SimCommand::SetCareerChange { change }`, code 37, sets the household change-of-path setting that the Options flyout shows. Both are settings: like the older settings command, they do not count toward the career command total that `last_career_result` follows. The published saved command records stay frozen: a save carries these two commands in schema eighteen's own list, as [JS-save] describes, not as new `SavedCommand` codes.

The older `SimCommand::SetCareerAutonomy { change, search }`, code 34, keeps its wire form because a saved game can hold it queued. The shell no longer sends it. **For confirmation:** when the drain meets it, it sets the change setting and gives every living person the `search` value, which is what the household setting meant; people who move in later start on.

## [JS-search] The search

Rule 13 of the careers spec still decides when and how an unemployed person looks for work. The only change is the test that admits a person: a person whose search is off is passed over before any random draw, exactly as an employed person or one at work is. The careers stream is drawn only for the people who look, in sim id order, so a household with everyone on draws the same numbers in the same order as before this change and plays out identically. [Shifts and more career paths](2026-10-18-shifts-and-careers.md) ([WS-search]) adds one careers draw between an applicant's apply and hire draws to choose the path by fit; a person whose search is off still draws nothing.

## [JS-hash] World hash

The careers part of the world hash keeps its layout. Where it wrote the household search setting, it now writes whether everyone's search is on, which is the same value for every game in which nobody's search is off. After the event moodlet timers it appends the people whose search is off, only when there are any. The careers enter the hash only when they differ from a new game's, and a world with someone's search off differs.

## [JS-save] Saves

Schema eighteen is the schema-seventeen envelope followed by `job_search_off`, the ids of living people whose search is off, ascending, each once, and `queued_settings`, each `SetJobSearch` or `SetCareerChange` waiting in the command queue with its position in the whole queue, positions ascending. A save lists only living people. The envelope's command records hold every other queued command in order, so schema seventeen's confirmed-order positions count only those; on load the settings return to their positions among them, as schema seventeen places its confirmed orders. The older household field inside the envelope, `SavedCareers::autonomous_search`, is always written on in schema eighteen. A schema-eighteen payload that names anyone who is not a living person, lists an id out of order or twice, places a queued setting out of order, twice at one position or past the end of the queue, exceeds the queue limit, or turns the older field off refuses the load and leaves the running game unchanged.

The current writer and every build transaction use schema nineteen, which wraps the complete schema-eighteen payload with household neglect timing, so a Build mode commit or cancel keeps each person's setting. The historical writers for schemas fourteen to seventeen remain for tests and comparisons, including the schema-seventeen projection of a Build session's committed baseline. **For confirmation:** they write the older household field off only when every living person's search is off, the one case that field can carry exactly, and on otherwise; queued settings have no place in them.

## [JS-migration] Older saves

A save from schema fourteen to seventeen carries one household value. On load, every living person takes it: a player who had turned job search off keeps it off for everyone, and a player who left it on keeps it on. A save from schema thirteen or earlier predates the setting and loads with everyone on, as before. Housemates who move in after the load start on, as in a new game.

## [JS-shell] The Career tab

The Career tab of Sim details gains a checkbox labeled **Look for work automatically when unemployed** for the selected person, beneath the assignment controls. It shows for every selected living person, employed or not, and is hidden when no person is selected. Changing it sends `SetJobSearch`; the box shows the sent value until the drain applies it and the tab reads the setting back. A send the queue refuses leaves the box at the setting and shows The setting could not be sent. A pending career assignment does not disable the box.

The Options flyout loses the Allow autonomous job search for unemployed sims checkbox and keeps Allow sims to change careers autonomously, which now sends `SetCareerChange`. **For confirmation:** the label is Look for work automatically when unemployed. The coordinating session's brief suggested Look for work automatically; the words when unemployed keep the box from reading as job hunting for someone who has a job. Both strings are functional text and are listed in the [player-visible string inventory](../player-visible-strings.md) for the owner's review.

## [JS-tests] Verification

Simulation tests pin the world hash and the careers stream's draw count of a new shipped household run from Monday to Thursday morning, which hires a housemate through the search, to the values main computed at commit 2b15dcfea before this change; they cover a person whose search is off being skipped with no draw and then hired once on, the others still looking while one is off, the setting commands touching only what they name, the older household command, the hash, a death, the schema-eighteen round trip with some, all and none of the household off, its refusals, queued settings saved beside their positions and applied after the load, a queued older household command in schema seventeen, the older writers' household field including a Build session's baseline, and loading schemas thirteen to seventeen with the household value on and off. Browser-boundary tests read and set the setting through the exports, round-trip schema eighteen through the save bytes, refuse a list naming nobody, load the published schema-fourteen and schema-fifteen fixtures, a current native schema-sixteen fixture and a schema-seventeen save with the setting as saved and turned off, and load two schema-seventeen saves that main wrote at 2b15dcfea, the shipped household and one with job search off, kept in `crates/terri-wasm/tests/fixtures/job-search-v17/`. The storage worker keeps the main-written save as its schema-seventeen recovery copy before a real schema-eighteen write. Shell tests cover the Career tab's box, the panel's reading and sending, the Options checkbox and the bridge's validation.
