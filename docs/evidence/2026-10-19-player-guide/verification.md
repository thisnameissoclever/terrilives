# Player guide verification

This record covers issue #313 on October 19, 2026, on `twcx/player-guide-313`. The approved guide was based on main `96b14aa45fc20a0e92f9e8f3de7501110ec16359`, including attributable arguments and cleaning appreciation. The owner subsequently approved publication and requested a visible Player guide link directly below Build and Options. Delivery preparation also incorporates main `d59d004d783097cb312225a475645ea31b1bb125` and its background-play behavior.

## Source and build identity

Player articles, navigation, activity filter tags, effect coverage, numerical data and screenshot metadata live under `docs/player/`. Changelog source moved there with its filenames and public addresses preserved. Guide topics exclude Changelog; both sites have a link to the other.

The approval build has these SHA-256 fingerprints:

1. Root HTML: `368b974c87e19c4d2aeeb4c328c4b3257a95441ad49431629d042f984417d551`.
2. JavaScript `index-fopipe25.js`: `8bb9c6dfb18d32f2774fc675f69fd7ca3aeb5370bb0986294a04e41b1bff8beb`.
3. WebAssembly `terri_wasm_bg-CpN8-IQR.wasm`: `7ab495173fb68fd97e90ecde2045b9f82c518443213911e2977ab44ff05139f8`.

The official guide generator was rerun into that production artifact after the approval screenshot refresh, which contained 82 complete desktop/mobile entries. [Screenshot metadata](../../player/screenshots.json) records individual capture builds, exact access paths and panel close-ups, including subsequent delivery additions. Unchanged controls retain their earlier capture provenance. Help was refreshed against the main-based approval build. Captures use displayed Chrome on Windows at 1440 by 960 and a touch-enabled 390 by 844 viewport, with real saved mute preferences. No audio API was replaced.

Weather captures show actual falling and grounded leaves, natural winter snow, and mild weather. The snow event occurred through ordinary game time; the capture did not force its probability. Stills establish appearance, not guaranteed weather on a particular date.

## Executed checks

1. Node guide, changelog, reference, effect coverage, filter and branding tests: 36 passed. Rejection cases cover missing fragments and images, unsafe markup, changed source fingerprints, altered generated data, missing effect mappings and unreviewed filter rows.
2. Focused web tests for object menus, camera, conversation bubbles and skill mirrors: 69 passed with one worker.
3. Rust exporter tests: two passed. Compiled reference export matches the committed snapshot, including the new argument and chore-repair tuning.
4. Workflow classification and publication guard tests: 26 passed. Documentation IDs are unique. Web type checking, release WebAssembly compilation and the normal Vite production build passed.
5. The authored guide and maintenance instructions passed the prose phrase scan. This scan supplements editorial review; it does not establish factual accuracy.

Browser checks visited the index and every topic. They verified heading uniqueness, local anchors, absence of Changelog from topic navigation, successful and empty searches, Clear, cross-page focus, browser Back, keyboard disclosures, persistent light/dark selection, image loading and reading without JavaScript. Expanded UI, activity and weather pages had no page-level overflow at widths 320, 390, 768 and 1280. Wide tables scroll within their own region.

Activity filters were exercised with beneficial and costly needs, no direct need benefit, harm to feelings, an impossible combination and reset. Hygiene costs select exercise; Energy benefits include sleep and lying down; harm to feelings selects Fight. Without JavaScript, the full overview remains visible. The changelog backlink returns to the guide with the saved theme intact.

## Independent review

A fresh novice-player reviewer inspected the rendered guide on desktop and phone widths in both themes, followed task and subsection links, tested search, Back and disclosures, and inspected the relevant actual screenshots. The reviewer distinguished Social from directional feelings, found phone needs, followed Options to New housemate, and read the condition and weather examples.

Review corrections included search reset state, escaped search snippets, creator completion controls, explicit condition-management instructions, table scrolling, current Help headings and the distinction between cleanliness preference and current Hygiene. After the main refresh, the reviewer challenged an ambiguous dish-repair explanation. The corrected chapters now state both cases: an assigned owner who contributes most can qualify when a helper washes the final plate; a helper's larger contribution prevents the owner's final plate from earning repair. This distinction follows the completion caller and contribution-credit code, without claiming a newly played repair scenario.

For the visible menu repairs, the reviewer independently rejected blinded captures with clipped description text and a corrupt zoom-out glyph. The replacement captures were accepted. A further contrast finding led to dark backing behind collapsed as well as expanded object identities. Final object cards, condition examples, all weather counterparts, and the refreshed Help panels and guide gallery received visual review. Automated image decoding was treated separately from visual judgment.

## Limits and review access

Phone evidence uses a desktop browser's touch-enabled responsive viewport. No physical phone, screen reader or full native simulation suite was tested for this documentation change. The independent reviewer inspected stated samples and paths; image decoding does not mean every pixel of every screenshot was reviewed.

The approval preview used `http://127.0.0.1:8322/guide/`. No push, merge or deployment had occurred at that review checkpoint. The owner later authorized push, merge and live verification, with game-related remote checks skipped. The direct HUD link and background-play advice were added during delivery preparation. Final publication is established by the merged pull request, an executed Pages deployment and checks of the public pages, rather than this local-build record.

Delivery follow-up passed 31 documentation/reference tests, web type checking, 34 focused layout/wiring tests and a normal production build. The direct link sits four pixels below the Build/Options row at both captured sizes. Real mouse/touch and keyboard activation opened the guide; Build controls remained unobstructed. A fresh independent review accepted those captures and the updated time-control advice. The capture browser awaited removal of the startup overlay before acting; the zero-time, zero-funds scene is a genuinely paused new household, not a loading placeholder. Final screenshot metadata contains the delivery build identities and interaction receipts.
