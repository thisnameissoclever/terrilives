/**
 * Wording for the installed game, applied once at startup.
 *
 * On the website, the Player guide, Changelog and the old-website recovery
 * link open in a new browser tab, and their labels say so. In the installed
 * game, the guide and changelog open in a new app window, and a website link
 * opens in the player's web browser. Only the parts of the labels that name
 * the destination change. The Export save recovery panel's note about what
 * Export save writes also names the app instead of "this website".
 */

/** The recovery panel's last note, as the installed game shows it. */
export const DESKTOP_EXPORT_NOTE =
  "Export save writes the game in this app to a file. Use the recovery page above for the old website's save.";

const NEW_TAB = 'opens in a new tab';
const NEW_TAB_SENTENCE = 'Opens in a new tab';

/** The wording for one link: an app window for the game's own pages, the web browser for websites. */
function destination(link: HTMLAnchorElement): { lower: string; sentence: string } {
  const external = /^https:/i.test(link.getAttribute('href') ?? '');
  return external
    ? { lower: 'opens in your web browser', sentence: 'Opens in your web browser' }
    : { lower: 'opens in a new window', sentence: 'Opens in a new window' };
}

function reword(text: string, wording: { lower: string; sentence: string }): string {
  return text.replaceAll(NEW_TAB, wording.lower).replaceAll(NEW_TAB_SENTENCE, wording.sentence);
}

/** Applies every installed-game wording change to the game page. */
export function applyDesktopWording(root: ParentNode & Pick<Document, 'getElementById'>): void {
  applyDesktopLinkWording(root);
  const exportNote = root.getElementById('save-transfer-export');
  if (exportNote) exportNote.textContent = DESKTOP_EXPORT_NOTE;
}

/** Rewrites "opens in a new tab" on every new-window link under `root`. */
export function applyDesktopLinkWording(root: ParentNode): void {
  for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'))) {
    const wording = destination(link);
    for (const attribute of ['aria-label', 'title']) {
      const value = link.getAttribute(attribute);
      if (value !== null) link.setAttribute(attribute, reword(value, wording));
    }
    // Only plain-text links carry the wording in their visible text.
    if (link.children.length === 0 && link.textContent?.includes(NEW_TAB)) {
      link.textContent = reword(link.textContent, wording);
    }
  }
}
