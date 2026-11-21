import { beginRefusalText } from './admin-words.js';
import { editsText } from './admin-panel.js';

// The keyboard route into the admin panel ([AP-web-keys] in
// docs/specs/2026-11-20-admin-panel.md). The tilde key opens and closes the
// panel and does nothing else. The plain backtick stays the developer
// overlay's, so `isDebugOverlayKey` is the one place that says which presses
// belong to it and which to the panel. The touch route is in `input.ts`.

/** What this module needs of the panel; `AdminPanel` satisfies it. */
export interface AdminOpeningPanel {
  readonly isOpen: boolean;
  open(): boolean;
  close(): void;
}

export interface AdminOpeningDeps {
  readonly doc: Document;
  readonly panel: AdminOpeningPanel;
  /** Whether Build mode is active; the panel cannot open in it. */
  buildActive(): boolean;
  /** Shows a short sentence in the command status line. */
  say(text: string): void;
  /** Skip ahead's runner; a running skip is stopped before the panel closes. */
  readonly skip?: { readonly running: boolean; stop(): void };
}

type KeyFacts = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>;

/** A press that types a tilde, with no chord: the panel's key. Matching the character keeps other layouts working. */
function isTilde(event: KeyFacts): boolean {
  return event.key === '~' && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * Whether a keydown toggles the developer overlay: the backquote key typing a
 * backtick. Shift plus that key types a tilde on a US layout, and any press
 * that types a tilde belongs to the admin panel, so neither toggles the overlay.
 */
export function isDebugOverlayKey(event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>): boolean {
  return event.code === 'Backquote' && !event.shiftKey && event.key !== '~';
}

function anotherDialogOpen(doc: Document): boolean {
  try {
    return doc.querySelector('dialog[open], dialog:popover-open') !== null;
  } catch {
    // A browser without :popover-open still knows `open`.
    return doc.querySelector('dialog[open]') !== null;
  }
}

/** Installs the tilde key; returns the function that removes it. */
export function installAdminOpening(deps: AdminOpeningDeps): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isTilde(event) || event.repeat) return;
    if (deps.panel.isOpen) {
      // Inside the panel, from anywhere (a number box included): close it, and type nothing.
      event.preventDefault();
      if (deps.skip?.running) deps.skip.stop();
      deps.panel.close();
      return;
    }
    if (editsText(event.target) || anotherDialogOpen(deps.doc)) return;
    event.preventDefault();
    if (deps.buildActive()) {
      deps.say(beginRefusalText('build-active'));
      return;
    }
    deps.panel.open();
  };
  deps.doc.addEventListener('keydown', onKeyDown);
  return () => deps.doc.removeEventListener('keydown', onKeyDown);
}