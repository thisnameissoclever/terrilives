import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FrameClock, type FrameClockHost } from '../src/frame-clock.js';
import { BackgroundTicker, type TickerWorker } from '../src/background-ticker.js';

const MAIN = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

it('drives the game through the clock, with background steps except under ?stress', () => {
  expect(MAIN).not.toMatch(/requestAnimationFrame\(loop\)/);
  expect(MAIN).toMatch(/frame\(nowMs, presenting\);[\s\S]*?\}, stressParam === null \? FRAME_STALL_MS : null\);/);
  expect(MAIN).toMatch(/clock\.start\(\);\s*\}\s*$/m);
  // Background steps skip the draw and keep the frame-time samples clean.
  expect(MAIN).toMatch(/if \(presenting&&floorScene\.visible&&!graphicsRecovering\) \{/);
  expect(MAIN).toMatch(/if \(presenting\) \{\s*timer\.sample\(/);
});

const STALL_MS = 250;

/** A controllable browser: pending animation frames, one timer, and a clock. */
function fakeHost() {
  const frames: ((nowMs: number) => void)[] = [];
  let timer: (() => void) | null = null;
  let now = 0;
  const host: FrameClockHost = {
    now: () => now,
    requestFrame: (callback) => { frames.push(callback); },
    startTimer: (callback) => {
      expect(timer).toBeNull();
      timer = callback;
      return () => { if (timer === callback) timer = null; };
    },
  };
  return {
    host,
    frames,
    get timerRunning() { return timer !== null; },
    /** Runs every frame pending now; the ones they request wait for the next call. */
    frame(nowMs: number) {
      now = nowMs;
      for (const frame of frames.splice(0)) frame(nowMs);
    },
    /** Advances the clock to `nowMs` and delivers one timer beat. */
    beat(nowMs: number) { now = nowMs; timer?.(); },
  };
}

describe('FrameClock', () => {
  it('chains animation frames and presents each one', () => {
    const browser = fakeHost();
    const steps: [number, boolean][] = [];
    new FrameClock(browser.host, (nowMs, presenting) => steps.push([nowMs, presenting]), STALL_MS).start();

    browser.frame(16);
    browser.frame(33);
    expect(steps).toEqual([[16, true], [33, true]]);
    expect(browser.frames).toHaveLength(1);
  });

  it('leaves the timer idle while animation frames keep arriving', () => {
    const browser = fakeHost();
    let steps = 0;
    new FrameClock(browser.host, () => steps++, STALL_MS).start();
    for (let ms = 16; ms <= 1000; ms += 16) {
      browser.frame(ms);
      browser.beat(ms + 8);
    }
    expect(steps).toBe(62);
  });

  it('steps from the timer without presenting once frames stop, as in a hidden tab', () => {
    const browser = fakeHost();
    const steps: [number, boolean][] = [];
    new FrameClock(browser.host, (nowMs, presenting) => steps.push([nowMs, presenting]), STALL_MS).start();
    browser.frame(16);

    browser.beat(200);
    expect(steps).toHaveLength(1);
    browser.beat(300);
    browser.beat(400);
    expect(steps).toEqual([[16, true], [300, false], [400, false]]);
  });

  it('fills the gaps between throttled frames and resumes presenting with them', () => {
    // An unselected tab may get one animation frame a second while it still
    // counts as visible. The timer covers the time between them.
    const browser = fakeHost();
    const steps: [number, boolean][] = [];
    new FrameClock(browser.host, (nowMs, presenting) => steps.push([nowMs, presenting]), STALL_MS).start();
    browser.frame(0);
    for (let ms = 100; ms < 1000; ms += 100) browser.beat(ms);
    browser.frame(1000);
    browser.beat(1100);
    expect(steps.map(([, presenting]) => presenting)).toEqual([true, ...Array(7).fill(false), true]);
    expect(steps.at(-1)).toEqual([1000, true]);
  });

  it('never steps backward when a late frame carries an earlier timestamp', () => {
    const browser = fakeHost();
    const times: number[] = [];
    new FrameClock(browser.host, (nowMs) => times.push(nowMs), STALL_MS).start();
    browser.beat(300);
    // The returning frame was stamped when its frame began, before the beat.
    for (const frame of browser.frames.splice(0)) frame(290);
    expect(times).toEqual([300, 300]);
  });

  it('keeps animation frames as the only driver without a stall limit', () => {
    const browser = fakeHost();
    let steps = 0;
    new FrameClock(browser.host, () => steps++, null).start();
    expect(browser.timerRunning).toBe(false);
    browser.beat(10_000);
    expect(steps).toBe(0);
    expect(browser.frames).toHaveLength(1);
  });

  it('stops both drivers, and a restart ignores frames left from before', () => {
    const browser = fakeHost();
    let steps = 0;
    const clock = new FrameClock(browser.host, () => steps++, STALL_MS);
    clock.start();
    clock.stop();
    expect(browser.timerRunning).toBe(false);
    browser.frame(16);
    expect(steps).toBe(0);

    clock.start();
    clock.start();
    browser.frame(32);
    expect(steps).toBe(1);
    expect(browser.frames).toHaveLength(1);
  });

  it('can be stopped from inside a step', () => {
    const browser = fakeHost();
    let steps = 0;
    const clock = new FrameClock(browser.host, () => { steps++; clock.stop(); }, STALL_MS);
    clock.start();
    browser.frame(16);
    expect(browser.frames).toHaveLength(0);
    expect(browser.timerRunning).toBe(false);
    expect(steps).toBe(1);
  });

  it('ends the loop when a step throws, whichever driver ran it', () => {
    for (const driver of ['frame', 'timer'] as const) {
      const browser = fakeHost();
      new FrameClock(browser.host, () => { throw new Error('frame failed'); }, STALL_MS).start();
      if (driver === 'timer') expect(() => browser.beat(1000)).toThrow('frame failed');
      else expect(() => browser.frame(16)).toThrow('frame failed');
      expect(browser.timerRunning).toBe(false);
      browser.frame(2000);
      browser.beat(3000);
    }
  });
});

class FakeWorker implements TickerWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: (number | null)[] = [];
  terminated = false;
  postMessage(message: number | null): void { this.posted.push(message); }
  terminate(): void { this.terminated = true; }
  beat(): void { this.onmessage?.({ data: null } as MessageEvent); }
  fail(): void { this.onerror?.({ preventDefault() {} } as ErrorEvent); }
}

describe('BackgroundTicker', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('asks one reused worker for the interval and relays its beats', () => {
    const worker = new FakeWorker();
    let created = 0;
    const ticker = new BackgroundTicker(100, () => { created++; return worker; });
    let beats = 0;
    const stop = ticker.start(() => beats++);
    worker.beat();
    worker.beat();
    stop();
    worker.beat();
    ticker.start(() => beats++)();
    expect(beats).toBe(2);
    expect(created).toBe(1);
    expect(worker.posted).toEqual([100, null, null, 100, null]);
  });

  it('lets a stale stop leave a newer callback running', () => {
    const worker = new FakeWorker();
    const ticker = new BackgroundTicker(100, () => worker);
    const calls: string[] = [];
    const stopFirst = ticker.start(() => calls.push('first'));
    ticker.start(() => calls.push('second'));
    stopFirst();
    worker.beat();
    expect(calls).toEqual(['second']);
  });

  it('falls back to a main-thread interval when the worker cannot start', () => {
    vi.useFakeTimers();
    const ticker = new BackgroundTicker(100, () => { throw new Error('no workers'); });
    let beats = 0;
    const stop = ticker.start(() => beats++);
    vi.advanceTimersByTime(350);
    stop();
    vi.advanceTimersByTime(500);
    expect(beats).toBe(3);
  });

  it('falls back to a main-thread interval when the worker fails while running', () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const ticker = new BackgroundTicker(100, () => worker);
    let beats = 0;
    const stop = ticker.start(() => beats++);
    worker.fail();
    expect(worker.terminated).toBe(true);
    vi.advanceTimersByTime(250);
    stop();
    vi.advanceTimersByTime(500);
    expect(beats).toBe(2);
  });
});
