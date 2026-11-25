'use strict';

/**
 * Packaging for the installed game. The Windows installer is built on the
 * owner's PC and the Mac disk images by .github/workflows/desktop-mac.yml;
 * both are attached to a GitHub release by scripts, never by electron-builder
 * itself (every build runs with --publish never).
 *
 * The `publish` entry tells electron-updater where releases live. On
 * Windows it also makes electron-builder write latest.yml and the
 * installer's .blockmap, which the release must carry for updates.
 *
 * The version is typed once, in web/package.json, and copied into the
 * packaged app's metadata here.
 */

const fs = require('node:fs');
const path = require('node:path');

const webPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/package.json'), 'utf8'));

module.exports = {
  appId: 'life.natural-causes.game',
  productName: 'Natural Causes',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['src/**', 'package.json'],
  asar: true,
  extraResources: [{ from: '../web/dist', to: 'web' }],
  extraMetadata: { version: webPackage.version },
  publish: { provider: 'github', owner: 'thisnameissoclever', repo: 'terrilives' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    artifactName: 'Natural-Causes-Setup-${version}-x64.${ext}',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    identity: '-',
    hardenedRuntime: false,
    category: 'public.app-category.simulation-games',
    icon: 'build/icon.png',
  },
  dmg: {
    artifactName: 'Natural-Causes-${version}-${arch}.${ext}',
    writeUpdateInfo: false,
  },
};
