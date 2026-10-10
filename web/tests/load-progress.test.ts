import { describe, expect, it } from 'vitest';
import { countResponseBytes } from '../src/load-progress.js';

describe('counting a response as it arrives', () => {
  it('reports every chunk and the end, and keeps the body, status and headers', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const body = new ReadableStream<Uint8Array>({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    });
    const original = new Response(body, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
    const counts: number[] = [];
    let ended = 0;
    const counted = countResponseBytes(original, count => counts.push(count), () => { ended++; });
    expect(counted.headers.get('Content-Type')).toBe('application/wasm');
    expect(counted.ok).toBe(true);
    expect([...new Uint8Array(await counted.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(counts).toEqual([3, 2]);
    expect(ended).toBe(1);
  });

  it('keeps a failed status, so callers still see the failure', () => {
    const counted = countResponseBytes(new Response('missing', { status: 404 }), () => {});
    expect(counted.ok).toBe(false);
    expect(counted.status).toBe(404);
  });

  it('returns the response untouched when nothing is counting or there is no body', () => {
    const plain = new Response('x');
    expect(countResponseBytes(plain, undefined)).toBe(plain);
    const empty = new Response(null, { status: 204 });
    expect(countResponseBytes(empty, () => {})).toBe(empty);
  });
});
