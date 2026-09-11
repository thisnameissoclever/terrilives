import { describe, expect, it } from 'vitest';

import {
  armAudioUnlock,
  grantsUserActivation,
  type GestureUnlockAudio,
  type GestureUnlockEvent,
  type GestureUnlockTarget,
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
  dispatch(event: GestureUnlockEvent): void;
}

/**
 * Wires a recording target to a recording controller. The controller records
 * the event the target is mid-dispatch on, which is the only way to attribute
 * an attempt to a gesture without inventing a parameter the real
 * `unlockFromGesture()` does not take.
 */
function harness(options: { readonly settles?: boolean } = {}): Harness {
  const settles = options.settles ?? true;
  const registrations: Registration[] = [];
  const attempts: GestureUnlockEvent[] = [];
  let inFlight: GestureUnlockEvent | null = null;
  let unlocked = false;

  const target: GestureUnlockTarget = {
    addEventListener(type, listener, options) {
      registrations.push({
        type,
        listener,
        capture: options?.capture === true,
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
  armAudioUnlock(target, audio);

  return {
    registrations,
    attempts,
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
 * the wiring is checked against the browser's rule rather than against itself.
 * `pointerdown` is the trap: it activates for a mouse and never for a finger.
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

const MOUSE_CLICK: readonly GestureUnlockEvent[] = [
  { type: 'pointerdown', pointerType: 'mouse' },
  { type: 'pointerup', pointerType: 'mouse' },
];

describe('grantsUserActivation', () => {
  it('agrees with the HTML standard on every event the wiring listens for', () => {
    const cases: GestureUnlockEvent[] = [
      { type: 'pointerdown', pointerType: 'mouse' },
      { type: 'pointerdown', pointerType: 'touch' },
      { type: 'pointerdown', pointerType: 'pen' },
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

  it('treats a pointerdown of unknown pointer type as non-activating', () => {
    expect(grantsUserActivation({ type: 'pointerdown' })).toBe(false);
  });
});

describe('armAudioUnlock', () => {
  it('unlocks a touch tap, and only from an event that carries activation', () => {
    const game = harness();

    for (const event of TOUCH_TAP) game.dispatch(event);

    expect(game.attempts.length).toBeGreaterThan(0);
    for (const attempt of game.attempts) {
      expect({ attempt, activating: specSaysActivating(attempt) }).toEqual({
        attempt,
        activating: true,
      });
    }
  });

  it('never attempts an unlock from a touch pointerdown', () => {
    const game = harness({ settles: false });

    game.dispatch({ type: 'pointerdown', pointerType: 'touch' });

    expect(game.attempts).toEqual([]);
  });

  it('unlocks a mouse press without waiting for the button to come back up', () => {
    const game = harness();

    game.dispatch(MOUSE_CLICK[0]);

    expect(game.attempts).toEqual([
      { type: 'pointerdown', pointerType: 'mouse' },
    ]);
  });

  it('unlocks from a keypress but not from Escape', () => {
    const game = harness();

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

  it('registers every event type that can carry activation on a touch device', () => {
    const game = harness();

    const types = new Set(game.registrations.map((entry) => entry.type));
    expect(types.has('pointerup')).toBe(true);
    expect(types.has('touchend')).toBe(true);
  });
});
