'use strict';

/**
 * Decides where links may take a window. Pure: the caller in main.js turns a
 * decision into Electron calls, so these rules are tested under plain Node.
 *
 * The game window stays on natural-causes://game/. The player guide, the
 * changelog and the startup report open as separate app windows. A few https
 * sites and mail links go to the system's default programs. Everything else
 * is refused.
 */

const { HOST, SCHEME } = require('./app-protocol.js');

const EXTERNAL_HOSTS = Object.freeze(['natural-causes.life', 'thisnameissoclever.github.io', 'github.com']);
const ALLOWED_PERMISSIONS = Object.freeze(['clipboard-sanitized-write', 'fullscreen']);

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** A URL served by the app's own protocol. */
function isGameUrl(url) {
  const parsed = parse(url);
  return parsed !== null && parsed.protocol === `${SCHEME}:` && parsed.host === HOST;
}

/** The game itself, as opposed to the guide, changelog or report pages beside it. */
function isGamePage(url) {
  if (!isGameUrl(url)) return false;
  const { pathname } = new URL(url);
  return pathname === '/' || pathname === '/index.html';
}

/** A link the system's browser or mail program should open. */
function isExternalUrl(url) {
  const parsed = parse(url);
  if (parsed === null) return false;
  if (parsed.protocol === 'mailto:') return true;
  return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
    && EXTERNAL_HOSTS.includes(parsed.hostname);
}

/**
 * What a link opened in a new window becomes.
 * - `app-window`: a page of the game's own site, in a separate app window.
 * - `focus-game`: the game page itself; the existing game window is focused instead
 *   of starting a second copy of the game.
 * - `external`: handed to the system and refused in the app.
 * - `deny`: refused.
 */
function windowOpenDecision(url) {
  if (isGamePage(url)) return 'focus-game';
  if (isGameUrl(url)) return 'app-window';
  if (isExternalUrl(url)) return 'external';
  return 'deny';
}

/**
 * What an in-window navigation becomes. The game window may move within the
 * game's own site, as the website does for Report bug. A secondary window may
 * move between site pages but never load a second copy of the game, which
 * would write its own save.
 */
function navigationDecision(url, { isGameWindow }) {
  if (isGameWindow) {
    if (isGameUrl(url)) return 'allow';
  } else {
    if (isGamePage(url)) return 'focus-game';
    if (isGameUrl(url)) return 'allow';
  }
  if (isExternalUrl(url)) return 'external';
  return 'deny';
}

function allowPermission(permission) {
  return ALLOWED_PERMISSIONS.includes(permission);
}

/** Save requests are accepted only from the game window showing the game's own site. */
function isTrustedSaveSender({ fromGameWindow, frameUrl }) {
  return fromGameWindow === true && typeof frameUrl === 'string' && frameUrl.startsWith(`${SCHEME}://${HOST}/`);
}

module.exports = {
  ALLOWED_PERMISSIONS,
  EXTERNAL_HOSTS,
  allowPermission,
  isExternalUrl,
  isGamePage,
  isGameUrl,
  isTrustedSaveSender,
  navigationDecision,
  windowOpenDecision,
};
