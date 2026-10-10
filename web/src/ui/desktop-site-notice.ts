/**
 * Tells a phone player when the browser is showing the desktop layout.
 *
 * Chrome's "Desktop site" setting ignores the page's viewport tag and lays
 * the page out about 980 CSS pixels wide, then shrinks it onto the phone.
 * The compact layout never applies (its rules key on a narrow width), and
 * every control ends up a fraction of its intended size. The page cannot
 * override that setting, so the honest fix is to say so, in text sized for
 * the shrunken page, and let the player switch it off.
 */

/** What the browser reports; split out so the decision can be tested. */
export interface ScreenFacts {
  /** `(any-pointer: coarse)`: a finger can point. */
  readonly coarse: boolean;
  /** `screen.width` and `screen.height`, in CSS pixels at normal zoom. */
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** `window.innerWidth`: the width the page is actually laid out at. */
  readonly layoutWidth: number;
}

/** The layout is this much wider than the screen before the notice shows. */
export const DESKTOP_LAYOUT_RATIO = 1.5;
/** A screen whose short side is at most this is treated as a phone. */
export const PHONE_SHORT_SIDE = 600;

export const DESKTOP_SITE_DISMISSED_KEY = 'natural-causes.desktop-site-notice-dismissed';

/** A touch phone laid out far wider than its screen: desktop mode. */
export function looksLikeDesktopSiteOnPhone(facts: ScreenFacts): boolean {
  const shortSide = Math.min(facts.screenWidth, facts.screenHeight);
  return facts.coarse
    && shortSide > 0
    && shortSide <= PHONE_SHORT_SIDE
    && facts.layoutWidth >= facts.screenWidth * DESKTOP_LAYOUT_RATIO;
}

/** How much larger to draw the notice so it reads at its normal size. */
export function noticeScale(facts: ScreenFacts): number {
  return Math.max(1, facts.layoutWidth / Math.max(1, facts.screenWidth));
}

export const DESKTOP_SITE_TEXT =
  'This page is in desktop mode, so everything is drawn small. ' +
  'For a phone-sized layout, open your browser menu and turn off Desktop site.';

interface NoticeWindow {
  readonly innerWidth: number;
  readonly screen: { readonly width: number; readonly height: number };
  matchMedia(query: string): { readonly matches: boolean };
  readonly localStorage?: Storage;
}

function dismissed(view: NoticeWindow): boolean {
  try { return view.localStorage?.getItem(DESKTOP_SITE_DISMISSED_KEY) === '1'; } catch { return false; }
}

function remember(view: NoticeWindow): void {
  try { view.localStorage?.setItem(DESKTOP_SITE_DISMISSED_KEY, '1'); } catch { /* still closes */ }
}

/** Shows the notice when it applies; returns whether it did. */
export function showDesktopSiteNotice(view: NoticeWindow, document: Document): boolean {
  const facts: ScreenFacts = {
    coarse: view.matchMedia('(any-pointer: coarse)').matches,
    screenWidth: view.screen.width,
    screenHeight: view.screen.height,
    layoutWidth: view.innerWidth,
  };
  if (!looksLikeDesktopSiteOnPhone(facts) || dismissed(view)) return false;
  const scale = noticeScale(facts);
  const panel = document.createElement('div');
  panel.id = 'desktop-site-notice';
  panel.setAttribute('role', 'status');
  // Inline, like the startup failure card: this shows before the game's own
  // styles matter, and above the loading cover (z-index 30).
  panel.style.cssText = [
    'position:fixed', 'left:50%', 'top:0', 'transform:translateX(-50%)',
    `width:${Math.round(380 * scale)}px`, 'max-width:100vw', 'box-sizing:border-box',
    `padding:${Math.round(12 * scale)}px`, `font:${Math.round(16 * scale)}px/1.4 system-ui, sans-serif`,
    'background:#23232b', 'color:#fff', 'border:1px solid #6fb2d2', 'z-index:40',
    'display:flex', 'flex-direction:column', `gap:${Math.round(10 * scale)}px`,
  ].join(';');
  const text = document.createElement('p');
  text.style.margin = '0';
  text.textContent = DESKTOP_SITE_TEXT;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.style.cssText = [
    `min-height:${Math.round(44 * scale)}px`, 'font:inherit', 'color:inherit',
    'background:#16161c', 'border:1px solid #9aa3ad', 'cursor:pointer',
  ].join(';');
  close.addEventListener('click', () => {
    remember(view);
    panel.remove();
  });
  panel.append(text, close);
  document.body.append(panel);
  return true;
}
