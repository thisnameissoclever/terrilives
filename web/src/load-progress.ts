/**
 * Progress reports from the startup downloads, for the loading screen.
 *
 * Both callbacks are optional so the loaders stay usable without a screen to
 * report to, as they are when floor materials are swapped mid-game.
 */
export interface LoadProgress {
  /** `done` of `total` files have finished, for the current step. */
  files?(done: number, total: number): void;
  /** `count` more bytes of response body arrived. */
  bytes?(count: number): void;
}

/**
 * Returns `response` with a body that reports each chunk as it arrives, and
 * calls `onEnd` once the whole body has.
 *
 * Counts the bytes the page receives after any HTTP decompression, so a
 * gzipped file reports its full size rather than its transfer size. Without
 * a body or stream support, the original response is returned uncounted:
 * the count is for the player's reassurance and must never stop a load.
 */
export function countResponseBytes(
  response: Response,
  onBytes: ((count: number) => void) | undefined,
  onEnd?: () => void,
): Response {
  if (!onBytes || !response.body || typeof TransformStream !== 'function') return response;
  const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      onBytes(chunk.byteLength);
      controller.enqueue(chunk);
    },
    flush() { onEnd?.(); },
  }));
  return new Response(counted, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Counts `response`'s body from a clone and returns the original untouched.
 *
 * For the WASM module: `WebAssembly.instantiateStreaming` caches compiled
 * code against the original response's URL and HTTP cache entry, and a
 * Response rebuilt around a counting stream has neither, so every visit
 * would compile the module from scratch. The clone is read alongside; `onEnd`
 * fires once it has been read to the end, or failed, or cannot be read.
 */
export function countAlongside(
  response: Response,
  onBytes: (count: number) => void,
  onEnd?: () => void,
): Response {
  let copy: Response;
  try {
    copy = response.clone();
  } catch {
    onEnd?.();
    return response;
  }
  const body = copy.body;
  if (!body) {
    onEnd?.();
    return response;
  }
  void (async () => {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onBytes(value.byteLength);
      }
    } catch {
      // The original reports its own failure; the count just stops.
    } finally {
      onEnd?.();
    }
  })();
  return response;
}
