/**
 * The cover shown from the first paint until the first full frame.
 *
 * The markup and its styles live in index.html, so the cover appears before
 * the script bundle, the WASM and the 40-odd sprite pages have downloaded.
 * On a phone that wait was a blank canvas for minutes, with no sign that
 * anything was happening. This module only changes its text and removes it.
 *
 * Every step is named and numbered, and downloads show a file count and a
 * running total, so something on the screen changes often enough that a slow
 * load does not look like a frozen one.
 *
 * Missing markup is tolerated rather than thrown on, unlike the HUD panels
 * ([L17]): the cover hides nothing the player needs, so failing to find it
 * must never be the reason the game does not start.
 */

/**
 * Startup in order. index.html shows the first one before any script runs,
 * so its text there must match; `startup-loading.test.ts` checks it.
 */
export const STARTUP_STEPS = [
  'Downloading the game',
  'Downloading the simulation',
  'Starting the simulation',
  'Loading the household',
  'Starting graphics',
  'Loading walls and floors',
  'Loading furniture and people',
  'Preparing graphics',
  'Setting up the game',
  'Drawing the house',
] as const;

export type StartupStep = (typeof STARTUP_STEPS)[number];

/** The line for a numbered step, as index.html also writes the first. */
export function startupStepLine(step: StartupStep): string {
  return `Step ${STARTUP_STEPS.indexOf(step) + 1} of ${STARTUP_STEPS.length}: ${step}`;
}

/** Bytes as the cover shows them: megabytes, one decimal place. */
export function loadedLine(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB loaded`;
}

export interface StartupLoading {
  /** Names the current step and clears the previous step's file count. */
  step(step: StartupStep): void;
  /** An unnumbered step, for a wait outside the usual order. */
  note(text: string): void;
  /** Shows how many of `total` files the current step has finished. */
  files(done: number, total: number): void;
  /** Adds to the running total of data loaded since the page opened. */
  bytes(count: number): void;
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
  const bytesText = document.getElementById('startup-loading-bytes') as LoadingElement | null;
  let finished = false;
  let loaded = 0;
  const show = (text: string): void => {
    if (finished) return;
    if (stepText) stepText.textContent = text;
    if (countText) { countText.textContent = ''; countText.hidden = true; }
    if (bar) bar.hidden = true;
  };
  return {
    step(step) { show(startupStepLine(step)); },
    note(text) { show(text); },
    files(done, total) {
      if (finished || total <= 0) return;
      const shown = Math.min(Math.max(0, done), total);
      if (countText) { countText.textContent = `${shown} of ${total} files`; countText.hidden = false; }
      if (bar) { bar.max = total; bar.value = shown; bar.hidden = false; }
    },
    bytes(count) {
      if (finished || !(count > 0)) return;
      loaded += count;
      if (!bytesText) return;
      // Chunks arrive every few kilobytes; touch the page only when the
      // shown figure changes.
      const line = loadedLine(loaded);
      if (bytesText.textContent !== line) bytesText.textContent = line;
      bytesText.hidden = false;
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

/**
 * Resolves once the browser has had a chance to paint.
 *
 * A step that runs long synchronous work has to yield first, or its name is
 * never drawn before the work starts. Animation frames stop in a background
 * tab, so a timer also resolves it there; startup must not stall unseen.
 */
export function afterPaint(
  frame: (fn: () => void) => unknown = requestAnimationFrame,
  schedule: (fn: () => void, ms: number) => unknown = setTimeout,
): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const go = (): void => {
      if (done) return;
      done = true;
      schedule(resolve, 0);
    };
    frame(go);
    schedule(go, 100);
  });
}
