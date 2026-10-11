/**
 * The bytes behind every coverage table: which pixels of a bed, chair,
 * fixture or body a click lands on, and the scene alpha the renderer uploads.
 *
 * They used to be base64 strings inside atlas.ts, which made the script bundle
 * about a hundred megabytes that a phone had to download and compile before
 * the loading screen could even change. The generator now writes them to one
 * gzip-compressed, content-addressed file beside the atlas pages, and each
 * coverage record keeps only its `offset` into the decompressed bytes.
 *
 * The file is compressed by the generator, not the server, because GitHub
 * Pages does not compress binary files and the bytes are mostly zeros.
 *
 * `loadCoveragePayload` must finish before anything samples or uploads
 * coverage. `SpriteRenderer.create` awaits it, and picking and dining support
 * only run once a renderer exists.
 */
import { COVERAGE_BYTE_LENGTH, COVERAGE_FILE_NAME } from './coverage-file.js';
import { countResponseBytes, type LoadProgress } from '../load-progress.js';

let payload: Uint8Array<ArrayBuffer> | undefined;
let lazySource: (() => Uint8Array<ArrayBuffer>) | undefined;
let pending: Promise<void> | undefined;

/** The content-addressed public URL of the coverage file. */
export function coverageUrl(baseUrl: string): string {
  return `${baseUrl}${COVERAGE_FILE_NAME}`;
}

/** Whether `bytes` start with the gzip signature. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Makes `bytes` the coverage payload, after checking its length. */
export function installCoveragePayload(bytes: Uint8Array<ArrayBuffer>, expectedLength = COVERAGE_BYTE_LENGTH): void {
  if (bytes.byteLength !== expectedLength) {
    throw new Error(`the click-area data is ${bytes.byteLength} bytes but coverage-file.ts expects ${expectedLength}`);
  }
  payload = bytes;
}

/**
 * Supplies the payload on first use instead of at startup. For Node tests,
 * which read the same file from disk; the browser always downloads it.
 */
export function provideCoveragePayload(source: () => Uint8Array<ArrayBuffer>): void {
  lazySource = source;
}

/** The decompressed coverage bytes. Throws if they have not loaded yet. */
export function coveragePayload(): Uint8Array<ArrayBuffer> {
  if (!payload && lazySource) installCoveragePayload(lazySource());
  if (!payload) {
    throw new Error('click-area data was used before it finished loading');
  }
  return payload;
}

/**
 * Decompresses straight into one buffer of the expected size. Collecting the
 * chunks first would briefly hold the seventy-odd megabytes twice.
 */
export async function gunzip(bytes: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const out = new Uint8Array(length);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.byteLength > length) {
      await reader.cancel();
      throw new Error(`the click-area data unpacks to more than the ${length} bytes coverage-file.ts expects`);
    }
    out.set(value, at);
    at += value.byteLength;
  }
  if (at !== length) {
    throw new Error(`the click-area data unpacks to ${at} bytes but coverage-file.ts expects ${length}`);
  }
  return out;
}

async function download(url: string, progress?: LoadProgress): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(
      `could not reach the click-area data at ${url} - check the server and device connection`,
      { cause },
    );
  }
  if (!response.ok) {
    throw new Error(`the click-area data at ${url} returned ${response.status}`);
  }
  const body = new Uint8Array(await countResponseBytes(response, progress?.bytes).arrayBuffer());
  // A server that labels the file as gzip-encoded makes fetch() unpack it
  // already. The length check still applies to what arrives.
  if (!isGzip(body)) {
    installCoveragePayload(body);
    return;
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await gunzip(body, COVERAGE_BYTE_LENGTH);
  } catch (cause) {
    throw new Error(`the click-area data at ${url} is damaged and could not be unpacked`, { cause });
  }
  installCoveragePayload(bytes);
}

/**
 * Downloads and unpacks the coverage file once. Later calls share the first
 * download; a failed one is forgotten, so a later call tries again.
 */
export function loadCoveragePayload(baseUrl: string, progress?: LoadProgress): Promise<void> {
  if (payload) return Promise.resolve();
  pending ??= download(coverageUrl(baseUrl), progress).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
