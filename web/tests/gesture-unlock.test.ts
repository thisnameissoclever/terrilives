import { describe, expect, it } from 'vitest';

import {
  armAudioUnlock,
  grantsUserActivation,
  type GestureUnlockAudio,
  type GestureUnlockEvent,
  type GestureUnlockTarget,
  type UserActivationPort,
} from '../src/audio/gesture-unlock.js';

interface Registration {
  readonly type: string;
  readonly listener: (event: GestureUnlockEvent) => void;
  readonly capture: boolean;
}

interface Harness {
  readonly registrations: Registration[];
  /** The events that were in flight when `unlockFromGesture` was called. */
  readonly attempts: GestureUnlockEvent[];
  /** Stands in for the browser's transient activation window. */
  activation: { isActive: boolean };
  dispatch(event: GestureUnlockEvent): void;
}

interface HarnessOptions {
  readonly settles?: boolean;
  /** Omit to model a browser with no `navigator.userActivation` at all. */
  readonly reportsActivation?: boolean;
}

/**
 * Wires a recording target to a recording controller. The controller records
 * the event the target is mid-dispatch on, which is the only way to attribute
 * an attempt to a gesture without inventing a parameter the real
 * `unlockFromGesture()` does not take.
 */
function harness(options: HarnessOptions = {}): Harness {
  const settles = options.settles ?? true;
  const reportsActivation = options.reportsActivation ?? true;
  const registrations: Registration[] = [];
  const attempts: GestureUnlockEvent[] = [];
  const activation = { isActive: true };
  let inFlight: GestureUnlockEvent | null = null;
  let unlocked = false;

  const target: GestureUnlockTarget = {
    addEventListener(type, listener, listenerOptions) {
      registrations.push({
        type,
        listener,
        capture: listenerOptions?.capture === true,
      });
    },
  };
  const audio: GestureUnlockAudio = {
    isUnlocked: () => unlocked,
    unlockFromGesture() {
      if (inFlight !== null) attempts.push(inFlight);
      if (!settles) return new Promise<boolean>(() => {});
      unlocked = true;
      return Promise.resolve(true);
    },
  };
  const port: UserActivationPort | undefined = reportsActivation
    ? {
        get isActive() {
          return activation.isActive;
        },
      }
    : undefined;
  armAudioUnlock(target, audio, port);

  return {
    registrations,
    attempts,
    activation,
    dispatch(event) {
      inFlight = event;
      try {
        for (const registration of registrations) {
          if (registration.type === event.type) registration.listener(event);
        }
      } finally {
        inFlight = null;
      }
    },
  };
}

/**
 * The HTML standard's activation triggering input event list, transcribed so
 * the fallback is checked against the browser's rule rather than against
 * itself. `pointerdown` is the trap: it activates for a mouse, never a finger.
 */
function specSaysActivating(event: GestureUnlockEvent): boolean {
  switch (event.type) {
    case 'keydown':
      return event.key !== 'Escape';
    case 'mousedown':
      return true;
    case 'pointerdown':
      return event.pointerType === 'mouse';
    case 'pointerup':
      return event.pointerType !== 'mouse';
    case 'touchend':
      return true;
    default:
      return false;
  }
}

const TOUCH_TAP: readonly GestureUnlockEvent[] = [
  { type: 'pointerdown', pointerType: 'touch' },
  { type: 'pointerup', pointerType: 'touch' },
  { type: 'touchend' },
];

describe('grantsUserActivation', () => {
  it('believes the browser over the event type when the browser reports one', () => {
    const live: UserActivationPort = { isActive: true };
    const spent: UserActivationPort = { isActive: false };
    // A touch pointerdown is not on the standard's list, but if activation is
    // live from a moment ago then a resume now would still be allowed.
    expect(
      grantsUserActivation({ type: 'pointerdown', pointerType: 'touch' }, live),
    ).toBe(true);
    // A lift that a scroll claimed grants nothing, and only the browser knows.
    expect(
      grantsUserActivation({ type: 'pointerup', pointerType: 'touch' }, spent),
    ).toBe(false);
    expect(grantsUserActivation({ type: 'touchend' }, spent)).toBe(false);
  });

  it('falls back to the HTML standard when the browser reports nothing', () => {
    const cases: GestureUnlockEvent[] = [
      { type: 'pointerdown', pointerType: 'mouse' },
      { type: 'pointerdown', pointerType: 'touch' },
      { type: 'pointerdown', pointerType: 'pen' },
      { type: 'pointerdown' },
      { type: 'pointerup', pointerType: 'mouse' },
      { type: 'pointerup', pointerType: 'touch' },
      { type: 'pointerup', pointerType: 'pen' },
      { type: 'pointerup' },
      { type: 'touchend' },
      { type: 'keydown', key: 'a' },
      { type: 'keydown', key: 'Escape' },
    ];
    for (const event of cases) {
      expect({ event, activating: grantsUserActivation(event) }).toEqual({
        event,
        activating: specSaysActivating(event),
      });
    }
  });
});

describe('armAudioUnlock', () => {
  it('unlocks a touch tap once the browser says activation is live', () => {
    const game = harness();
    game.activation.isActive = false;

    game.dispatch(TOUCH_TAP[0]);
    expect(game.attempts).toEqual([]);

    // The finger lifts and Blink grants activation.
    game.activation.isActive = true;
    game.dispatch(TOUCH_TAP[1]);

    expect(game.attempts).toEqual([{ type: 'pointerup', pointerType: 'touch' }]);
  });

  it('spends nothing on a first touch that only scrolled the HUD', () => {
    // Blink withholds activation when a scroll claimed the gesture, so every
    // event in the sequence reports a dead window.
    const game = harness({ settles: false });
    game.activation.isActive = false;

    for (const event of TOUCH_TAP) game.dispatch(event);

    expect(game.attempts).toEqual([]);
  });

  it('still unlocks a touch tap with no browser activation flag', () => {
    const game = harness({ reportsActivation: false });

    for (const event of TOUCH_TAP) game.dispatch(event);

    expect(game.attempts.length).toBeGreaterThan(0);
    for (const attempt of game.attempts) {
      expect({ attempt, activating: specSaysActivating(attempt) }).toEqual({
        attempt,
        activating: true,
      });
    }
  });

  it('never attempts from a touch pointerdown without the browser flag', () => {
    const game = harness({ settles: false, reportsActivation: false });

    game.dispatch({ type: 'pointerdown', pointerType: 'touch' });

    expect(game.attempts).toEqual([]);
  });

  it('unlocks a mouse press without waiting for the button to come back up', () => {
    const game = harness({ reportsActivation: false });

    game.dispatch({ type: 'pointerdown', pointerType: 'mouse' });

    expect(game.attempts).toEqual([
      { type: 'pointerdown', pointerType: 'mouse' },
    ]);
  });

  it('unlocks from a keypress but not from Escape without the flag', () => {
    const game = harness({ reportsActivation: false });

    game.dispatch({ type: 'keydown', key: 'Escape' });
    expect(game.attempts).toEqual([]);

    game.dispatch({ type: 'keydown', key: ' ' });
    expect(game.attempts).toEqual([{ type: 'keydown', key: ' ' }]);
  });

  it('stops attempting once the context is running', () => {
    const game = harness();

    for (const event of TOUCH_TAP) game.dispatch(event);
    const afterFirstTap = game.attempts.length;
    for (const event of TOUCH_TAP) game.dispatch(event);

    expect(game.attempts.length).toEqual(afterFirstTap);
  });

  it('offers every later gesture while the context is still locked', () => {
    // The controller no longer caches an in-flight attempt, so the wiring must
    // not reintroduce a latch of its own.
    const game = harness({ settles: false });

    game.dispatch({ type: 'pointerup', pointerType: 'touch' });
    const first = game.attempts.length;
    expect(first).toBeGreaterThan(0);

    game.dispatch({ type: 'pointerup', pointerType: 'touch' });

    expect(game.attempts.length).toBeGreaterThan(first);
  });

  it('listens in the capture phase so a handled gesture still unlocks', () => {
    const game = harness();

    expect(game.registrations.length).toBeGreaterThan(0);
    for (const registration of game.registrations) {
      expect({ type: registration.type, capture: registration.capture }).toEqual({
        type: registration.type,
        capture: true,
      });
    }
  });

  it('asks at every moment a touch device can carry activation', () => {
    const game = harness();

    const types = new Set(game.registrations.map((entry) => entry.type));
    expect(types.has('pointerup')).toBe(true);
    expect(types.has('touchend')).toBe(true);
    expect(types.has('click')).toBe(true);
  });
});
