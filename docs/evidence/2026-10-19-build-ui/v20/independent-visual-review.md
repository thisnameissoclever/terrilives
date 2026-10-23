# V20 independent visual acceptance review

Verdict: accept the four supplied captures for the stated compact-layout and visible-state criteria. I found no visual defect in these images. This is a bounded still-image review, not a full gameplay acceptance claim.

I read AGENTS.md, Testing Protocol section 9, and the relevant lessons on capture bytes, final receipts, focus space, intrinsic control height, activation across focus transfer, dirty local inputs, and review Back cancellation. I personally inspected each original JPEG through view_image at original resolution. I did not inspect application source, run the browser, build, test, change Git state, or revisit historical fault controls.

## Captured pixels

1. **dock-390.jpg:** The 390x844 image shows the complete household dock inside the viewport with an inset on both sides and below it. Tim, Walking, Edit, Sim details, Chores, Collapse, both mood labels, and all three roster names are readable. The Chores focus outline is complete on every side and has space around it. The buttons do not overlap; neither the dock nor its labels are horizontally clipped. The controls look compact without making the roster labels cramped. The HUD reads Day 1, Monday 01:05 and shows Pause selected.

2. **dock-434.jpg:** The 434x683 image shows the same readable dock arrangement in the shorter viewport. Chores has a complete focus outline, all three roster names fit, and the right-hand Content label remains within the panel. I see no overlapping controls or horizontal clipping. The dock leaves the household scene visible above it. The HUD again reads 01:05 with Pause selected.

3. **exit-dialog-390-keyboard.jpg:** The 390x844 image visibly contains the Leave Build mode? dialog. Its heading and consequence text are readable. Keep building is the first, neutral-colored row and has a complete focus outline. The red Discard changes row sits directly below it, followed by the green Confirm changes row. All three rows and their labels fit inside the dialog without overlap or horizontal clipping. The dimmed background still shows Kitchen V20 draft in the room name context. The visible zoom-out mark is a single horizontal minus shape; I see no corrupted multi-character glyph.

4. **walls-land-review-back-390.jpg:** The 390x844 image visibly shows Walls selected, while Land has the ordinary unselected appearance. The doorway tool, rotation controls, highlighted floor-edge location, Remove control, large Cancel control, footer Cancel/Confirm, and Build navigation remain present. The panel says Wall removed. This is ordinary last-action feedback and does not read as a failed confirmation. No generic confirmation-failure message is visible. The zoom-out control contains a clean single horizontal minus, and the plus is recognizable. The selected Walls tab and retained tool context match the reported return from review. A still image alone cannot establish the preceding Back action or prove that its draft survived internally.

## Measurements and provenance

I independently decoded the saved files with System.Drawing. All four are JPEGs, and the decoded dimensions match their respective JSON viewport receipts at device pixel ratio 1.

| Image | Decoded pixels | Receipt viewport | SHA256 |
| --- | --- | --- | --- |
| dock-390.jpg | 390x844 | 390x844, DPR 1 | d1d73118ca8a63b9e89b30c28c7cb18f9c50e184d95a805c36f89b4a3dd44c62 |
| dock-434.jpg | 434x683 | 434x683, DPR 1 | d7846e66aaef6292fd7ae20c208ff313373918c3f5672994e1337ea7993a9529 |
| exit-dialog-390-keyboard.jpg | 390x844 | 390x844, DPR 1 | b3d5ec68cb6f464d52ecf7e7bbf68052be2d17b50ea9e029eaff9ddb12f02dca |
| walls-land-review-back-390.jpg | 390x844 | 390x844, DPR 1 | 4b7b533cdc239b5973f33349dc389976567c2321fb0cfd465a479a07f58ecdf0 |

The two dock receipts measure Edit, Sim details, Chores, Collapse, and the Tim/Bill/Casey roster buttons at 36px high. Their measured panel scrollWidth equals clientWidth: 372px at the 390px viewport and 416px at the 434px viewport. The dialog receipt reports Keep building active, a 2px solid outline, and three 320x44px rows. Its scrollWidth and clientWidth both equal 356px. The Walls-return receipt measures its panel at equal 372px scrollWidth/clientWidth and records Walls with selected styling. Its active control is Land, which is distinct from the selected tool. These are receipt measurements; the visible findings above come from the saved pixels.

The parent reports application source merge 0b886b73d8fb0492fe8e8029957e0fc1db5715a7, incorporating current main 96b14aa, and release Wasm SHA256 7ab495173fb68fd97e90ecde2045b9f82c518443213911e2977ab44ff05139f8. I did not independently verify source or binary provenance under this read-only review scope.

## Behavior evidence and limits

The parent reports an actual visible floor-edge doorway removal, Land decision, Confirm changes, native merge review, and Back sequence before the Walls-return capture. It also reports that keyboard Keep preserved the exact pending room name; footer Cancel restored the separate 48-tile rooms; footer Confirm adopted Kitchen V20 confirmed; Land Discard restored it; a clean Land change did not prompt; Land Confirm adopted Kitchen V20 Land; and current Save/Load retained that 48-tile room name. I did not replay these operations.

I read loaded-v19-room.txt, merge-review.txt, and loaded-v20-room.txt. They supplement the reported sequence with DOM records of Kitchen Land confirmed at 48 tiles, a proposed Kitchen/Living-room merge from 48 to 96 tiles, and loaded Kitchen V20 Land at 48 tiles. They are not direct assertions about native save bytes. cleanup.json records no warnings or errors, the task tab closure, and the clock held at 01:05 during subsequent checks. The parent additionally reports viewport reset and server shutdown; I did not independently perform cleanup.

The parent explicitly observed startup running at 1x before manual Pause at 01:05. Neither these stills nor the later held-clock checks establish a paused startup. Still images also do not prove physical touch behavior, operating-system held-key repeat, all gameplay, actual save-byte integrity, or animation and transition quality. The earlier independently rejected corrupt-minus evidence is separate; I did not repeat that historical review or invent a new defective control.

**Next steps**: The parent can use this bounded independent acceptance alongside its played-flow evidence. No repair is requested by this visual review.
