/**
 * The cover shown from the first paint until the first full frame.
 *
 * The markup and its styles live in index.html, so the cover appears before
 * the script bundle, the WASM and the 40-odd sprite pages have downloaded.
 * On a phone that wait was a blank canvas for minutes, with no sign that
 * anything was happening. This module only changes its text and removes it.
 *
 * Missing markup is tolerated rather than thrown on, unlike the HUD panels
 * ([L17]): the cover hides nothing the player needs, so failing to find it
 * must never be the reason the game does not start.
 */
export interface StartupLoading {
  /** Names the current startup step and clears any page count. */
  step(text: string): void;
  /** Shows how many of `total` items the current step has finished. */
  progress(done: number, total: number): void;
  /** Removes the cover. Safe to call more than once. */
  finish(): void;
}

interface LoadingElement {
  hidden: boolean;
  textContent: string | null;
  dataset: DOMStringMap;
  remove(): void;
}

interface ProgressElement extends LoadingElement {
  value: number;
  max: number;
}

/** How long the fade in index.html's `#startup-loading` transition lasts. */
export const STARTUP_FADE_MS = 250;

export function startupLoading(
  document: Pick<Document, 'getElementById'>,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): StartupLoading {
  const root = document.getElementById('startup-loading') as LoadingElement | null;
  const stepText = document.getElementById('startup-loading-step') as LoadingElement | null;
  const countText = document.getElementById('startup-loading-count') as LoadingElement | null;
  const bar = document.getElementById('startup-loading-progress') as ProgressElement | null;
  let finished = false;
  const clearCount = (): void => {
    if (countText) { countText.textContent = ''; countText.hidden = true; }
    if (bar) bar.hidden = true;
  };
  return {
    step(text) {
      if (finished) return;
      if (stepText) stepText.textContent = text;
      clearCount();
    },
    progress(done, total) {
      if (finished || total <= 0) return;
      const shown = Math.min(Math.max(0, done), total);
      if (countText) { countText.textContent = `${shown} of ${total}`; countText.hidden = false; }
      if (bar) { bar.max = total; bar.value = shown; bar.hidden = false; }
    },
    finish() {
      if (finished || !root) return;
      finished = true;
      // The fade is CSS; reduced motion turns the transition off there, and
      // the element goes either way once the fade would have finished.
      root.dataset.done = 'true';
      schedule(() => root.remove(), STARTUP_FADE_MS);
    },
  };
}
