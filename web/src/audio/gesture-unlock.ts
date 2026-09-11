/**
 * Arms the browser's autoplay gate on the events that actually open it.
 *
 * The HTML standard is narrow about which input event grants user activation,
 * and `pointerdown` is the trap: it counts for a mouse and never for a finger.
 * A touch device grants activation when the finger lifts - `pointerup` with a
 * non-mouse pointer, or `touchend` - so wiring the unlock to `pointerdown`
 * alone calls `AudioContext.resume()` with no activation behind it on every
 * phone. Chrome leaves that resume pending rather than rejecting it, so the
 * context stays suspended, every cue is dropped, and no later tap recovers it.
 *
 * This module owns the event list and nothing else. It never touches an
 * `AudioContext`; the controller it is handed decides what an unlock means.
 */

/** The fields of a DOM event this module reads. Nothing else is needed. */
export interface GestureUnlockEvent {
  readonly type: string;
  readonly pointerType?: string;
  readonly key?: string;
}

export interface GestureUnlockTarget {
  addEventListener(
    type: string,
    listener: (event: GestureUnlockEvent) => void,
    options?: { readonly capture?: boolean },
  ): void;
}

export interface GestureUnlockAudio {
  isUnlocked(): boolean;
  unlockFromGesture(): Promise<boolean>;
}

/**
 * The event types that can carry user activation, so the listener set and the
 * per-event test cannot drift apart. `mousedown` is deliberately absent:
 * pointer events cover the same press, and listening for both would open two
 * unlock attempts for one click.
 */
const ARMED_EVENT_TYPES: readonly string[] = [
  'pointerdown',
  'pointerup',
  'touchend',
  'keydown',
];

/**
 * Reports whether the browser would treat this event as an activation
 * triggering input event, per the HTML standard's user activation processing
 * model. Escape is excluded there because it is how a player backs out of a
 * dialog, which is not consent to start making noise.
 */
export function grantsUserActivation(event: GestureUnlockEvent): boolean {
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

/**
 * Registers the unlock on `target` and returns nothing to unwind: the listeners
 * stay armed for the life of the document so a device interruption or a
 * rejected tab resume can still be recovered by the next gesture.
 *
 * Capture phase, because the gesture that unlocks sound is usually the same one
 * that issues a command, and a handler that stops propagation must not also
 * silence the game.
 */
export function armAudioUnlock(
  target: GestureUnlockTarget,
  audio: GestureUnlockAudio,
): void {
  const unlock = (event: GestureUnlockEvent): void => {
    if (!grantsUserActivation(event)) return;
    if (audio.isUnlocked()) return;
    // Deliberately not awaited. `resume()` has to be called inside this
    // handler's task for the activation to still be live when it runs.
    void audio.unlockFromGesture();
  };
  for (const type of ARMED_EVENT_TYPES) {
    target.addEventListener(type, unlock, { capture: true });
  }
}
