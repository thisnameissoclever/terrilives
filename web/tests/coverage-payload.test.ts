import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COVERAGE_BYTE_LENGTH, COVERAGE_FILE_NAME } from '../src/render/coverage-file.js';

const committed = readFileSync(new URL(`../public/${COVERAGE_FILE_NAME}`, import.meta.url));

/** A fresh copy of the loader, without the test setup's disk source. */
async function freshLoader(): Promise<typeof import('../src/render/coverage-payload.js')> {
  vi.resetModules();
  return import('../src/render/coverage-payload.js');
}

function served(body: Uint8Array, status = 200): Response {
  return new Response(new Uint8Array(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('coverage payload', () => {
  it('is a gzip file named by the SHA-256 of its bytes and unpacks to the length the tables expect', async () => {
    const { createHash } = await import('node:crypto');
    expect(COVERAGE_FILE_NAME).toBe(`coverage-${createHash('sha256').update(committed).digest('hex')}.bin`);
    expect(gunzipSync(committed).byteLength).toBe(COVERAGE_BYTE_LENGTH);
  });

  it('downloads, counts and unpacks the file once, then serves its bytes', async () => {
    const loader = await freshLoader();
    expect(() => loader.coveragePayload()).toThrow(/before it finished loading/);
    const fetch = vi.fn(async () => served(committed));
    vi.stubGlobal('fetch', fetch);
    let counted = 0;
    await Promise.all([
      loader.loadCoveragePayload('./', { bytes: count => { counted += count; } }),
      loader.loadCoveragePayload('./'),
    ]);
    await loader.loadCoveragePayload('./');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`./${COVERAGE_FILE_NAME}`);
    expect(counted).toBe(committed.byteLength);
    expect(Buffer.from(loader.coveragePayload()).equals(gunzipSync(committed))).toBe(true);
  });

  it('accepts bytes a server has already unpacked', async () => {
    const loader = await freshLoader();
    vi.stubGlobal('fetch', async () => served(gunzipSync(committed)));
    await loader.loadCoveragePayload('./');
    expect(loader.coveragePayload().byteLength).toBe(COVERAGE_BYTE_LENGTH);
  });

  it('fails with a clear message when the file cannot be reached, then tries again', async () => {
    const loader = await freshLoader();
    const fetch = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetch);
    await expect(loader.loadCoveragePayload('./')).rejects.toThrow(
      `could not reach the click-area data at ./${COVERAGE_FILE_NAME}`);
    await expect(loader.loadCoveragePayload('./')).rejects.toThrow(/could not reach/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fails with the status when the server refuses the file', async () => {
    const loader = await freshLoader();
    vi.stubGlobal('fetch', async () => served(new TextEncoder().encode('<!doctype html>'), 404));
    await expect(loader.loadCoveragePayload('./')).rejects.toThrow(
      `the click-area data at ./${COVERAGE_FILE_NAME} returned 404`);
  });

  it('rejects damaged, short and long files instead of sampling the wrong bytes', async () => {
    for (const body of [committed.subarray(0, 1000), gzipSync(new Uint8Array(16)),
      gzipSync(new Uint8Array(COVERAGE_BYTE_LENGTH + 4))]) {
      const loader = await freshLoader();
      vi.stubGlobal('fetch', async () => served(body));
      await expect(loader.loadCoveragePayload('./')).rejects.toThrow(/damaged and could not be unpacked/);
      expect(() => loader.coveragePayload()).toThrow(/before it finished loading/);
    }
    const loader = await freshLoader();
    vi.stubGlobal('fetch', async () => served(new Uint8Array(12)));
    await expect(loader.loadCoveragePayload('./')).rejects.toThrow(/is 12 bytes but coverage-file.ts expects/);
  });
});
