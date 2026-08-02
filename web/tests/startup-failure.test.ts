/**
 * The failure card's message chooser, every branch.
 *
 * The card exists because a startup failure used to be console-only -
 * "surfaced rather than swallowed" that swallowed it for players, who
 * saw a dark void with one pause button. The branch that earns the
 * tests is the LAN one: the same build that runs on localhost renders
 * nothing at http://<LAN-IP>:5173, because WebGPU requires a secure
 * context and a plain-http network address is not one. The card must
 * blame the ADDRESS in that case, not the browser, or it sends the
 * player off to install a Chrome they already have.
 */
// `renderStartupFailure` is deliberately untested: it is DOM wiring of
// the kind main.ts's header names as untestable in Node (this suite has
// no jsdom, and adding one to test createElement calls would be a
// dependency bought for nothing). The chooser below is where every
// decision lives.
import { describe, expect, it } from 'vitest';

import { describeStartupFailure } from '../src/ui/startup-failure';

describe('describeStartupFailure', () => {
  const gpuMissing = new Error('WebGPU is not available in this browser.');

  it('blames the address, not the browser, on an insecure origin', () => {
    const notice = describeStartupFailure(gpuMissing, {
      webgpu: false,
      secure: false,
    });
    expect(notice.title).toBe('This address cannot render the game');
    // The hints must carry the two actionable moves: localhost on the
    // host machine, and the secure-context story for remote devices.
    const hints = notice.hints.join(' ');
    expect(hints).toContain('https://localhost:5174');
    expect(hints).toContain('secure');
    expect(notice.detail).toBe(gpuMissing.message);
  });

  it('blames the browser when WebGPU is missing on a SECURE page', () => {
    const notice = describeStartupFailure(gpuMissing, {
      webgpu: false,
      secure: true,
    });
    expect(notice.title).toBe('This browser cannot render the game');
    expect(notice.hints.join(' ')).toContain('Chrome');
  });

  it('passes an ordinary error through verbatim when WebGPU exists', () => {
    // A real bug must not hide behind browser-support advice: the
    // player-facing card carries the actual message.
    const notice = describeStartupFailure(new Error('atlas decode failed'), {
      webgpu: true,
      secure: true,
    });
    expect(notice.title).toBe('The game failed to start');
    expect(notice.detail).toBe('atlas decode failed');
  });

  it('stringifies a non-Error throw instead of printing undefined', () => {
    const notice = describeStartupFailure('bare string panic', {
      webgpu: true,
      secure: true,
    });
    expect(notice.detail).toBe('bare string panic');
  });
});
