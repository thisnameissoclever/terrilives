# Character asset downloads

Character geometry, bundle manifests and clip-part manifests use the same HTTP reader. Successful geometry bytes still pass their source hash and topology checks before rendering.

HTTP 503 reports service unavailability. The status alone does not establish how long the failure lasts or which server or intermediary produced it. The [HTTP specification](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4) permits a `Retry-After` delay. The reader makes at most three GET attempts for this status. Without a valid delay, it waits 500 milliseconds and then 1,500 milliseconds. A retry reloads the resource through the browser cache.

The reader honors numeric seconds and HTTP dates, with at most 15 seconds of additional retry waiting per asset. If the server requests a longer delay than the remaining allowance, the reader fails rather than sending an early request. It requests cancellation of discarded response bodies without waiting for cleanup to settle. A broken, unused error body does not replace the HTTP failure status or prevent the next attempt.

Other HTTP failures, transport exceptions, malformed manifests and failed geometry hashes remain terminal. A successful file is not downloaded again because another file needed recovery. A final unsuccessful HTTP response retains its status, resource path, selected delivery headers and at most 1,024 response-body bytes. Reading that error body waits at most one second; cancellation cannot extend the wait. The error message also includes the response details so errors crossing the existing worker boundary preserve them. This policy handles brief outages; a persistent service failure still prevents startup.

The reader changes no artwork, geometry, save data or graphics allocation policy. Identifying an observed 503 requires evidence from the failed request and the server or intermediary that produced the response. A successful local download or recovery from an injected failure does not identify that cause. The dated [character download evidence](evidence/2026-10-22-character-download/README.md) distinguishes injected response handling from observations of normal public loading and physical-device acceptance.

The [startup report](startup-diagnostics.md) retains these errors and loading steps in the same browser. It can be opened without starting graphics or loading the simulation.
