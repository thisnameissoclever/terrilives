'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const policy = require('../src/window-policy.js');

test('the guide, changelog and report open as app windows; the game page focuses the game', () => {
  assert.equal(policy.windowOpenDecision('natural-causes://game/guide/'), 'app-window');
  assert.equal(policy.windowOpenDecision('natural-causes://game/guide/ui-elements/#saves'), 'app-window');
  assert.equal(policy.windowOpenDecision('natural-causes://game/changelog/'), 'app-window');
  assert.equal(policy.windowOpenDecision('natural-causes://game/startup-report.html'), 'app-window');
  assert.equal(policy.windowOpenDecision('natural-causes://game/'), 'focus-game');
  assert.equal(policy.windowOpenDecision('natural-causes://game/index.html'), 'focus-game');
});

test('allowed websites and mail links go to the system; everything else is refused', () => {
  for (const url of [
    'https://natural-causes.life/changelog/',
    'https://thisnameissoclever.github.io/natural-causes-old-save/',
    'https://github.com/thisnameissoclever/terrilives/releases',
    'mailto:bugreport@stfuai.com?subject=x',
  ]) {
    assert.equal(policy.windowOpenDecision(url), 'external', url);
  }
  for (const url of [
    'http://natural-causes.life/',
    'https://natural-causes.life.example.com/',
    'https://evil.github.com.example/',
    'https://user:pass@github.com/',
    'https://example.com/',
    'file:///C:/Windows/system32/calc.exe',
    'javascript:alert(1)',
    'natural-causes://other/index.html',
    'not a url',
  ]) {
    assert.equal(policy.windowOpenDecision(url), 'deny', url);
  }
});

test('the game window may move only within the game site', () => {
  const game = { isGameWindow: true };
  assert.equal(policy.navigationDecision('natural-causes://game/index.html', game), 'allow');
  assert.equal(policy.navigationDecision('natural-causes://game/startup-report.html', game), 'allow');
  assert.equal(policy.navigationDecision('mailto:bugreport@stfuai.com', game), 'external');
  assert.equal(policy.navigationDecision('https://natural-causes.life/', game), 'external');
  assert.equal(policy.navigationDecision('https://example.com/', game), 'deny');
  assert.equal(policy.navigationDecision('file:///C:/', game), 'deny');
});

test('a guide window never loads a second copy of the game', () => {
  const guide = { isGameWindow: false };
  assert.equal(policy.navigationDecision('natural-causes://game/changelog/', guide), 'allow');
  assert.equal(policy.navigationDecision('natural-causes://game/guide/needs/', guide), 'allow');
  assert.equal(policy.navigationDecision('natural-causes://game/', guide), 'focus-game');
  assert.equal(policy.navigationDecision('natural-causes://game/index.html', guide), 'focus-game');
  assert.equal(policy.navigationDecision('https://example.com/', guide), 'deny');
});

test('only clipboard writing and full screen are granted', () => {
  assert.deepEqual([...policy.ALLOWED_PERMISSIONS], ['clipboard-sanitized-write', 'fullscreen']);
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'pointerLock']) {
    assert.equal(policy.allowPermission(permission), false, permission);
  }
  assert.equal(policy.allowPermission('fullscreen'), true);
});

test('save requests are trusted only from the game window on the game site', () => {
  assert.equal(policy.isTrustedSaveSender({ fromGameWindow: true, frameUrl: 'natural-causes://game/index.html' }), true);
  assert.equal(policy.isTrustedSaveSender({ fromGameWindow: false, frameUrl: 'natural-causes://game/index.html' }), false);
  assert.equal(policy.isTrustedSaveSender({ fromGameWindow: true, frameUrl: 'https://natural-causes.life/' }), false);
  assert.equal(policy.isTrustedSaveSender({ fromGameWindow: true, frameUrl: 'natural-causes://gamex/' }), false);
  assert.equal(policy.isTrustedSaveSender({ fromGameWindow: true, frameUrl: undefined }), false);
});
