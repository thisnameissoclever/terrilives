# Wages and bills played pass

These captures record the played pass of [WB-played] in [wages and bills](../../specs/2026-10-18-wages-and-bills.md) (issue 298). The findings and their dispositions are in the [verification record](../../specs/2026-10-18-wages-and-bills-verification.md#played-pass).

The branch's production build was served on its own port with `vite preview`, muted with `?audio=0`, in one Playwright Chromium page, on 2026-10-24. Captures whose names start with `d` are 1280 by 800, and those starting with `p` are 375 by 812. `d05`, `d13` and `p02` are crops of the household status panel.

Saved states were written into the page's save slot before loading. Three came from a scratch example that ran the shipped household natively and was removed afterward: Sunday 22:00 of the first week, Day 9 with the first month paid, and Day 14 with nobody employed, so the first month's bills were two days overdue. Two are the committed schema-21 fixtures in `crates/terri-wasm/tests/fixtures/bills-v21/`: the night watch worker with an open night shift, and the double bed moved to a yard tile.

| File | What it shows |
| --- | --- |
| `d05-new-game-hud-desktop.png` | A new game's Bills row, `$354 due Day 8` |
| `d36-new-game-panel-after-day-fix.png` | A new game's Bills panel on Day 1 |
| `d09-day7-2330-panel.png` | Day 7 at 23:31: Funds $1,708.34 and $426.11 to keep aside |
| `d12-day8-panel.png` | Day 8 at 00:00: the four bills paid on Day 8 and Funds $1,282.23, $426.11 less |
| `d13-overdue-hud.png` | The Bills row reading `$428 overdue` in the danger color |
| `d14-overdue-panel-top.png`, `d15-overdue-panel-bottom.png`, `d38-overdue-panel-electricity-open.png` | The overdue panel: the overdue bills with late fees, the next bills, last month unpaid and how bills work |
| `d16-overdue-mood.png` | Tim's mood list with Behind on bills, minus 8 |
| `d17-night-career.png` | The night watch worker's Career tab with the night pay sentence, $120.75 per shift |
| `d18-tim-career-migrated.png` | The office clerk at $180 after loading the schema-21 night-shift save |
| `d19-bed-in-yard-loaded.png` | The schema-21 save with the double bed still on its yard tile |
| `d20-build-bed-selected.png` | That bed selected in Build: Beds can only go inside a room |
| `d27-confirm-refused-bed-outside.png` | Confirm refused after a wall removal left the moved bed outside |
| `d29-bed-placed-new-room.png` | The bed placed in a room built in the same session |
| `d32-rent-after-confirm-day1.png`, `d33-rent-day2.png` | Rent after the confirmed change: 171 indoor tiles instead of 192, $277.40 expected instead of $293.60, and the next day's charge at the new size |
| `p04-new-game-phone.png`, `p05-day8-phone.png`, `p01-overdue-phone.png` | The Bills row on the phone on Day 1, on Day 8 after payment, and overdue |
| `p02-long-bills-value.png` | `$10,000 due Day 1,000` set into the phone row: 128 pixels wide and 44 tall inside the 182-pixel panel, on one line |
| `p03-panel-phone-0.png`, `p03-panel-phone-2.png` | The overdue panel on the phone, top and bottom; the dialog's content is 334 pixels wide with no sideways scroll |
