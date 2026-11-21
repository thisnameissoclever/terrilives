# Admin panel verification record

Verification record for issue 312 ([the admin panel plan](2026-11-20-admin-panel.md)). It holds the gate results and the unchanged pins. Sections marked pending are filled in by the played pass and the final gate; nothing below is claimed until its result is written.

## Documentation checks (task T15)

Run on the worktree `twcl-admin-panel`, branch `twcl/admin-panel-312`, with the commands the repository defines.

| Check | Result |
| --- | --- |
| `node --test scripts/build-player-guide.test.mjs scripts/player-activity-filters.test.mjs scripts/player-coverage.test.mjs scripts/check-player-reference.test.mjs scripts/build-changelog.test.mjs` | 33 of 33 passed |
| `node scripts/build-player-guide.mjs` | built |
| `node --test scripts/build-changelog.test.mjs` | 12 of 12 passed |
| `node scripts/build-changelog.mjs` | built |
| `node scripts/check-player-reference.mjs --check` | matched, no refresh needed |

## Player guide screenshots

Pending. The captures `admin-housemate`, `admin-relationships` and `admin-household`, desktop and phone, are listed in `docs/player/screenshots.json` as pending capture. When they exist, add their image paths and hashes, a new source snapshot and the matching figures in `docs/player/illustrations.json`, then move the guide's Admin panel subsection out from under Options to its own heading with its illustrations.

## Played visual pass

Pending ([AP-tests-played] of the plan).

## Final gate

Pending: `py -3 -B scripts/check-local-ci.py run` on the final head.

## Pins

Pending confirmation on the final head: GOLDEN, `SHIPPED_THURSDAY`, `STANDARD_ONLY_HASH` and the published witnesses are expected unchanged ([AP-save-hash]), and `SAVE_SCHEMA_VERSION` stays 24.
