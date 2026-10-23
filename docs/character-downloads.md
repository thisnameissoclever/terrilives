# Character asset downloads

Character geometry, bundle manifests and clip-part manifests use the same HTTP reader. Successful geometry bytes still pass their source hash and topology checks before rendering.

HTTP 503 means the service is temporarily unavailable. The [HTTP specification](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.6.4) permits the server to provide a `Retry-After` delay. The reader makes at most three GET attempts for this status. Without a valid delay, it waits 500 milliseconds and then 1,500 milliseconds. A retry reloads the resource through the browser cache.

The reader honors numeric seconds and HTTP dates, with at most 15 seconds of additional waiting per asset. If the server requests a longer delay than the remaining allowance, the reader fails rather than sending an early request. It releases failed response bodies before waiting. A broken, unused error body does not replace the HTTP failure status.

Other HTTP failures, transport exceptions, malformed manifests and failed geometry hashes remain terminal. A successful file is not downloaded again because another file needed recovery. The final failure retains the status and resource path in the existing startup error message. This policy handles brief outages; a persistent service failure still prevents startup.

The reader changes no artwork, geometry, save data or graphics allocation policy. The original server-side reason for an observed 503 requires evidence from that service; successful client recovery does not identify it. The dated [character download evidence](evidence/2026-10-22-character-download/README.md) records the supplied report, local reproduction and acceptance limits.
