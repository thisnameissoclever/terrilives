# Chair registration review, 2026-10-14

The independent visual review rejected the old chair placement and found no severe chair/upper-torso intersection in the 24 current captures reviewed. This is a decision about the captured reading pose, not blanket acceptance of the character creator.

## Blind comparison

All eight `set-a-{0..3}.png` and `set-b-{0..3}.png` images were opened at their original size before reading `report.json` or the capture script. Each image includes the enlarged preview and the game-size thumbnail. The verdict was delivered before the mapping was revealed.

1. **Reject set A, all four facings.** In the two front views, the chair arms cross the upper chest just below the chin, hiding most of the shirt. Both legs extend well below the chair base. In the rear views, the chair back reaches head height and obscures nearly the whole torso. The defect remains visible in the thumbnails.
2. **Accept set B for visible registration in this pose.** The head and upper torso remain clear, the book sits above the lap, the arms of the chair sit near the hips and elbows, and the chair back remains behind the lower torso. Rear-view concealment of the lower back and hips is ordinary furniture occlusion. It does not justify reopening the previously accepted minor contact overlap.

After the verdict, `report.json` identified set A as `old-anchor` and set B as `current`. The blind review therefore detected the deliberately restored defect.

## Additional current captures

Opened all 20 additional images at original size: `male-0-{0..3}.png`, `male-100-{0..3}.png`, `female-0-{0..3}.png`, `female-50-{0..3}.png`, and `female-100-{0..3}.png`.

No severe chair/upper-torso crossing or other clear new visual issue was found. Smaller bodies sit deeper in the chair; larger bodies extend farther above and outside the seat. Their upper torso, book, arms, and lap remain readable. The enlarged views and thumbnails agree. Together with set B, this covers masculine and feminine presentations with all five body controls set together to 0, 50, or 100, in all four facings.

## Test and capture evidence

1. The test at `web/tests/preview-fixture.test.ts:53` compares uploaded placement with the source camera and projected chair vertices. Reintroducing the old anchor moves the chair by 21 logical pixels at scale 1 and 63 at scale 3. The preserved `../registration-01/old-anchor.log` first caught this at a redundant hard-coded anchor expectation: received `116.00043487548828`, expected `95.0004369020462`. That hard-coded X/Y pair was subsequently removed. The current `../registration-02/old-anchor.log` fails directly in the independent source-camera vertex equality at test line 74: `20.999999516069217` is not less than `0.0001`. Its receipt records baseline exit 0, old-anchor exit 1, and restored exit 0; `restored.log` confirms all four tests pass. The renderer, test, and recorded source inputs have identical before/after hashes for that run. This reviewer inspected both receipts, the failure logs, the current assertion, and the second restored log without rerunning tests.
2. All 29 image hashes in `report.json` were checked against the files, with zero mismatches. This includes `restored.png`, whose pixels were not part of the independent visual review.
3. The reported source hashes before and after capture match. The live `preview-fixture.ts` SHA-256 also matches the receipt: `672eb62dc095c5b373fbd3c62d22edd3c975b0ee415ed0e1720b5dd7b9efe929`.
4. The receipt identifies Chrome `155.0.8059.39`, the preview modules served from `http://127.0.0.1:5187/`, no captured errors, and closure of the capture browser. Those are receipt observations, not an independently controlled browser session.

## Limits

Every reviewed image is paused at frame 0. This review does not establish full animation quality, entry or exit transitions, household occupancy, arbitrary combinations of body controls, every hairstyle or accessory, or visual quality of unrelated actions. The unit test mocks the graphics device, pipeline, and draw calls; it cannot establish shader execution, depth ordering, or final pixels. The exact regression was caught by both the test and this blind image review, but neither makes future visual review optional.
