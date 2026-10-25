# Wages and bills played pass

These captures record the played pass of [WB-played] in [wages and bills](../../specs/2026-10-18-wages-and-bills.md) (issue 298). The findings and their dispositions are in the [verification record](../../specs/2026-10-18-wages-and-bills-verification.md#played-pass).

The branch's production build at `bdd6b65f1`, with the $0.90 indoor rent rate and $400 starting funds, was served on its own port with `vite preview` and played on 2026-10-25 in headed, muted Google Chrome driven by Playwright, one browser at a time. Captures whose names start with `d` are 1280 by 800, those starting with `p` are 375 by 812 on an emulated touch phone, `p16` is 812 by 375 and `t01` is 1024 by 768, both with touch. `d05`, `d10`, `d12` and `p02` are clips of the household status panel.

Saved states were written into the page's save slot before loading. Four came from a scratch example that ran the shipped household natively and was removed afterward: Sunday 22:00 of the first week; Day 9 with the first month paid; and a household in which nobody works, on Day 17 with the second month's bills unpaid within their grace and on Day 21 with them overdue. Two are the committed schema-21 fixtures in `crates/terri-wasm/tests/fixtures/bills-v21/`: the night watch worker with an open night shift, and the double bed moved to a yard tile.

| File | What it shows |
| --- | --- |
| `d05-new-game-hud.png`, `p05-new-game-hud.png` | A new game's Funds of 400 and Bills row, `$316 due Day 8` |
| `d06-new-game-panel.png` | A new game's Bills panel on Day 1: Funds $400.00, $315.55 to keep aside, `Funds cover these bills.`, and every bill's lines adding up to its amount so far |
| `d07-day7-eve-panel.png` | Day 7 at 22:45: Funds $2,005.39 and $384.71 to keep aside, before a late shift's pay and a trip home |
| `d08-day7-2344-panel.png` | Day 7 at 23:44, after that pay: Funds $2,108.34 and $387.71 to keep aside |
| `d09-day8-panel-last-month.png`, `p08-day8-hud.png` | Day 8 at 00:00: Funds $1,720.63, exactly $387.71 less, and Last month lists the four bills as paid Day 8; the row reads `$388 due Day 15` |
| `d10-unpaid-hud.png` | Day 17 with the second month's bills unpaid within their grace: the row reads `$351 due Day 15`, the unpaid amount and its due day |
| `d11-unpaid-panel.png`, `p11-unpaid-panel.png` | The same day's panel: `Unpaid bills due Day 15 are overdue from Day 20.` |
| `d12-overdue-hud.png`, `p12-overdue-hud.png` | Day 21: the row reads `$386 overdue` in the danger color |
| `d13-overdue-panel-top.png`, `d14-overdue-panel-bottom.png`, `p13-overdue-panel-top.png`, `p14-overdue-panel-bottom.png` | The overdue panel: the overdue bills with late fees, the payment-order note, the next bills, last month unpaid and how bills work |
| `d15-overdue-panel-lines-open.png`, `p15-overdue-panel-lines-open.png` | The overdue panel with every bill open: rent's base and tile lines and each usage line |
| `d16-overdue-mood.png` | Tim's mood list with Behind on bills, minus 8 |
| `d17-night-career.png` | The night watch worker's Career tab with the night pay sentence, $120.75 per shift |
| `d18-tim-career-migrated.png` | The office clerk at $180 after loading the schema-21 night-shift save |
| `d19-bed-in-yard-loaded.png` | The schema-21 save with the double bed still on its yard tile |
| `d20-build-bed-selected.png` | That bed selected in Build: it previews in place, with Place available and no refusal |
| `d21-bed-to-yard-refused.png` | The same bed moved to another yard tile: `Beds can only go inside a room.` |
| `d27-confirm-refused-bed-outside.png` | After the bed was moved into Bedroom 1 and confirmed, the wall between Bedroom 1 and the porch was removed: Confirm refuses with `The Standard Double bed would be left outside. Move it into a room, or choose Cancel, before confirming.` |
| `d28-bed-into-new-room-preview.png`, `d29-bed-in-new-room-confirmed.png` | In the same session, a room built on the yard with a doorway takes the bed, and the batch confirms |
| `d30-room-review.png` | From the yard-bed save, the same wall removed while Bedroom 1 is empty: the batch reaches the room review, Bedroom 1 open to Outside, because the bed already outdoors did not move |
| `d32-rent-after-confirm-day1.png`, `d33-rent-day2.png` | Rent after that change: expected rent falls from $255.20 to $233.60, with 156 indoor tiles today against 192 before; on Day 2 the tile lines read 174 indoor tiles a day on average, and rent's three lines add up to its $69.32 so far |
| `p02-long-bills-value.png` | The longest value, `$10,000 due Day 1,000`, set into the phone row by script to measure it: 128 pixels wide and 44 tall inside the 182-pixel panel, on one line |
| `p16-landscape-phone-panel.png`, `t01-tablet-panel.png` | The overdue panel on a landscape phone and a tablet; the Bills button, the Close button and the summary line that opens each bill measured 44 pixels tall at both sizes, with no sideways scroll |
