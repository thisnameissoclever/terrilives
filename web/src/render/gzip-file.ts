/**
 * Unpacking for the binary files the generator publishes gzip-compressed:
 * the coverage file and the wall and floor depth and role files.
 *
 * GitHub Pages does not compress binary files, so the generator compresses
 * them itself. A server that does label one as gzip-encoded makes fetch()
 * unpack it already, so callers check the signature before unpacking.
 */

/** Whether `bytes` start with the gzip signature. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Decompresses straight into one buffer of exactly `length` bytes, and throws
 * if the file holds more or less. Collecting the chunks first would briefly
 * hold large files twice. `what` names the file in the error.
 */
export async function gunzipExact(bytes: Uint8Array<ArrayBuffer>, length: number,
  what: string): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const out = new Uint8Array(length);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.byteLength > length) {
      await reader.cancel();
      throw new Error(`${what} unpacks to more than the expected ${length} bytes`);
    }
    out.set(value, at);
    at += value.byteLength;
  }
  if (at !== length) {
    throw new Error(`${what} unpacks to ${at} bytes but ${length} were expected`);
  }
  return out;
}

/**
 * The exact bytes of a downloaded file that may or may not still be gzipped,
 * after checking they are `length` long.
 */
export async function unpackedBytes(body: Uint8Array<ArrayBuffer>, length: number,
  what: string): Promise<Uint8Array<ArrayBuffer>> {
  // The signature check is safe for the current files: their unpacked bytes
  // start with zeros. A file whose unpacked bytes begin 1f 8b would need the
  // caller to decide from the response headers instead.
  if (!isGzip(body)) {
    if (body.byteLength !== length) {
      throw new Error(`${what} is ${body.byteLength} bytes but ${length} were expected`);
    }
    return body;
  }
  return gunzipExact(body, length, what);
}
