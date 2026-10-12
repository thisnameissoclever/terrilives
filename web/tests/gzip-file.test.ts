import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gunzipExact, isGzip, unpackedBytes } from '../src/render/gzip-file.js';

const bytes = Uint8Array.from({ length: 5000 }, (_, i) => i % 7);
const packed = (data: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(gzipSync(data));

describe('gzip files', () => {
  it('recognizes the gzip signature', () => {
    expect(isGzip(packed(bytes))).toBe(true);
    expect(isGzip(bytes)).toBe(false);
    expect(isGzip(new Uint8Array([0x1f]))).toBe(false);
  });

  it('unpacks to exactly the expected length or throws', async () => {
    expect(await gunzipExact(packed(bytes), 5000, 'test')).toEqual(bytes);
    await expect(gunzipExact(packed(bytes), 4999, 'the test file')).rejects.toThrow(
      'the test file unpacks to more than the expected 4999 bytes');
    await expect(gunzipExact(packed(bytes), 5001, 'the test file')).rejects.toThrow(
      'the test file unpacks to 5000 bytes but 5001 were expected');
  });

  it('accepts bytes a server already unpacked, at the expected length only', async () => {
    const plain = new Uint8Array(bytes);
    expect(await unpackedBytes(plain, 5000, 'test')).toBe(plain);
    expect(await unpackedBytes(packed(bytes), 5000, 'test')).toEqual(bytes);
    await expect(unpackedBytes(plain, 10, 'the test file')).rejects.toThrow(
      'the test file is 5000 bytes but 10 were expected');
  });
});
