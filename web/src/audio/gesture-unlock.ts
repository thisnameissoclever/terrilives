/**
 * Arms the browser's autoplay gate on the gestures that actually open it.
 *
 * The rule is narrower than it looks. `pointerdown` grants user activation for
 * a mouse and never for a finger: Blink grants it when the finger lifts, and
 * then only if a scroll did not claim the gesture first. Wiring the unlock to
 * `pointerdown` alone therefore works for every developer with a mouse and for
 * no player with a phone.
 *
 * Rather than re-deriving that rule here, this asks the browser what it thinks.
 * `navigator.userActivation.isActive` is the same flag the autoplay gate
 * consults, so a gesture is worth acting on exactly when it says so, including
 * for clauses a hand-written list cannot know about such as the scroll one.
 * The event list below is only the set of moments worth asking at. Browsers
 * without `userActivation` (Firefox, Safari before 16.4) fall back to the HTML
 * standard's activation triggering input event list.
 *
 * This module owns that decision and nothing else. It never touches an
 * `AudioContext`; the controller it is handed decides what an unlock means.
 */

/** The fields of a DOM event this module reads. Nothing else is needed. */
export interface GestureUnlockEvent {
  readonly type: string;
  readonly pointerType?: string;
  readonly key?: string;
}

/** The live `navigator.userActivation`. `isActive` is transient activation. */
export interface UserActivationPort {
  readonly isActive: boolean;
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
 * The moments worth asking the browser about. Listening broadly is safe
 * because the answer, not the event type, decides whether to act.
 */
const ARMED_EVENT_TYPES: readonly string[] = [
  'pointerdown',
  'pointerup',
  'touchend',
  'click',
  'keydown',
];

/**
 * The HTML standard's activation triggering input event list, used only when
 * the browser does not expose `navigator.userActivation`. Escape is excluded
 * there because backing out of a dialog is not consent to start making noise.
 */
function specGrantsActivation(event: GestureUnlockEvent): boolean {
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
 * Reports whether a resume attempted from this event would have user
 * activation behind it. Prefers the browser's own flag, and falls back to the
 * standard's event list when the browser does not publish one.
 */
export function grantsUserActivation(
  event: GestureUnlockEvent,
  activation?: UserActivationPort,
): boolean {
  if (activation !== undefined) return activation.isActive;
  return specGrantsActivation(event);
}

function browserUserActivation(): UserActivationPort | undefined {
  try {
    return globalThis.navigator?.userActivation as UserActivationPort | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Registers the unlock on `target`. Nothing is returned to unwind: the
 * listeners stay armed for the life of the document, so a device interruption
 * or a rejected tab resume can still be recovered by the next gesture.
 *
 * Capture phase, because the gesture that unlocks sound is usually the same
 * one that issues a command, and a handler that stops propagation must not
 * also silence the game.
 */
export function armAudioUnlock(
  target: GestureUnlockTarget,
  audio: GestureUnlockAudio,
  activation: UserActivationPort | undefined = browserUserActivation(),
): void {
  const unlock = (event: GestureUnlockEvent): void => {
    if (audio.isUnlocked()) return;
    if (!grantsUserActivation(event, activation)) return;
    // Deliberately not awaited. `resume()` has to be called inside this
    // handler's task for the activation to still be live when it runs.
    void audio.unlockFromGesture();
  };
  for (const type of ARMED_EVENT_TYPES) {
    target.addEventListener(type, unlock, { capture: true });
  }
}
