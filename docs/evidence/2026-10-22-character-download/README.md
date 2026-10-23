# Character file service failure and recovery

The supplied screenshot is explicitly from a previous build. It reports an iPhone 16 Pro Max running iOS 27.0.1 and shows the application's startup failure card: `Character asset could not load: 503 /terrilives/assets/runtime.normalTriangles-DitPThSI.bin`.

This records a failed HTTP download while the page can still display its own error. It does not identify the cause of the earlier browser-process failures or establish that the newly published memory repair failed. The original 503 response headers and server diagnostics are unavailable.

## File identity and injected response handling

The exact public file currently returns HTTP 200. Its 147,816 bytes have SHA-256 `1922467d482252adec60f8958e3888dd1b97ae0b05d8af6c23b6344aba949c53`, matching the built file. There is no evidence that this file is missing or corrupt.

The baseline browser check runs public revision `dda9ae81fa137ce971df6efbaf90d292bed00f97`, entry `index-D0anJtTF.js`, SHA-256 `11192025c6828dd0c92920ebc6fe0a6185c8f34b9e6c88bb1b7f06bf9dbd2a6e`. A browser route returns one injected 503 for that exact filename. The application immediately stops with the same status/path error and completes zero frames. This reproduces the loader's handling of a supplied status. It does not reproduce the conditions that caused the user's response.

The current loader treats any unsuccessful download as terminal. The repair gives geometry bytes, bundle manifests and clip-part manifests the same [bounded 503 recovery policy](../../character-downloads.md). Successful geometry still passes its original SHA-256 and topology validation. No asset bytes, rendering rules, save formats, dependencies or hosted test workflows change.

## Local verification

1. The first real `loadGeometryAssets` test fails with the expected 503 before implementation. After the repair, all 19 download tests pass. Cases cover numeric/date server delays, malformed delays, cumulative waiting, three-attempt exhaustion, failed-body cleanup, persistent errors, terminal non-503 responses, network exceptions and corruption after recovery. Four related creator/world/preparation suites bring the focused total to 47 passing tests.
2. TypeScript checking passes. Compiled player-reference generation and source review checking pass. Thirty guide, changelog and review-record tests pass. The production web build passes with its existing large-bundle and mixed static/dynamic import warnings. Simulation sources and the previous memory repair are unchanged; unrelated native and full web suites were not repeated for this transport-only delta.
3. `node scripts/verify-character-download.cjs` operates the actual compiled game in headed, muted Windows Chrome at 402 by 874 CSS pixels and device scale three. The recovery case injects one 503 for the named binary and one for a clip-part manifest. Both recover after the one-second `Retry-After` delay, and the game completes frames. Reloading the retained test household produces a screenshot whose complete PNG hash matches the prior accepted scene: `4f7f7c2fd7a18f3501c425a6e80e1985809aa36d1f409cd225aafc3fc0ac08a6`.
4. The persistent-service case supplies 503 for every request to the binary. The loader makes exactly three attempts and shows the existing failure card with zero completed frames. The corruption case supplies 503 once, then alters the successful response. The loader makes two requests and rejects the SHA-256 mismatch. Neither case reaches gameplay.
5. Every browser case closes its task-owned browser in `finally`. Selected stills and JSON records retain the outcomes. There are no review videos, trace archives or private user screenshots in this evidence directory.

The candidate build entry is `index-DjPw67ST.js`, SHA-256 `e447662c2af92f6d167e52d44549fe61bcd27ae7a1c9dbd32a17943f64c4abba`. The baseline command used `DOWNLOAD_PROOF_MODE=baseline` and the public URL before publication. Candidate cases use `recover`, `persistent` and `corrupt`, with a local static release server at `/terrilives/`. The committed `household.json` contains the test session's default household, rather than a player's save.

One initial browser assertion expected exactly two requests for the parts-manifest URL. The game made a later third read while startup still succeeded. The corrected assertion requires recovery of the injected read and the server delay without restricting later consumers. The exact binary retry count and final screenshot identity remain enforced.

## Guide and acceptance limits

The owner reports consistent failure on every attempt. The supplied 503 screenshot remains explicitly from a previous build; there is no supplied physical-device result for revision `f7293d547974b35390b403113656868de2ad9d6e`. Describing the reported 503 as temporary was unsupported. The status code alone identifies neither duration nor producer.

On October 22, Pacific time, `node .scratch/ios-resident-memory/natural-network.cjs` observed the normal public URL without request interception, injected failures or graphics constraints. The checked source revision was `f7293d547974b35390b403113656868de2ad9d6e`; the public entry was `index-DYnMdxA5.js`. Installed Windows Chrome completed cold and warm loads. A separate cold load using an iPhone Safari request header also completed in Windows Chrome. Changing the header does not emulate iOS or WebKit.

Each run advanced the simulation clock, recorded no startup failure or console/page diagnostic, and verified all 217 observed character binary response bodies against the corresponding built files. No observed HTTP response failed. Page-target network records included HTTP/2; they do not establish worker-target protocol coverage. Requests used the local route through the PDX cache. These successful observations do not explain the affected user's consistent failure or prove recovery on their phone. The [compact network record](natural-network-summary.json) retains the results and exact-file response identity. Full local observations and screenshots remain in ignored `.local-build/character-causality/`. The harness closed its browser after the checks.

The change affects automatic download recovery during loading. It changes no player control, interface layout or documented simulation value. Existing guide articles, effects mappings and screenshots remain accurate; source fingerprints were reviewed and refreshed for the transport change.

Recovery on either reported physical iPhone remains unobserved. A persistent server outage still prevents loading, and this client repair does not establish which server or intermediary produced the original 503. The earlier graphics-memory evidence and browser-process reports retain their separate acceptance limits.
