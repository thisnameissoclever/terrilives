/**
 * Gives Node tests the same coverage bytes the browser downloads.
 *
 * The browser fetches the coverage file at startup, before anything samples
 * it. Tests import the tables synchronously instead, so this reads the
 * committed file from web/public on first use. Tests that never sample
 * coverage never read it.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { COVERAGE_FILE_NAME } from '../../src/render/coverage-file.js';
import { provideCoveragePayload } from '../../src/render/coverage-payload.js';

provideCoveragePayload(() => {
  const file = readFileSync(new URL(`../../public/${COVERAGE_FILE_NAME}`, import.meta.url));
  const bytes = gunzipSync(file);
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
});
