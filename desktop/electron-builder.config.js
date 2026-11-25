'use strict';

/**
 * Packaging for the installed game. Installers are built on the owner's
 * machines and attached to a draft GitHub release; nothing here publishes.
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
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    differentialPackage: false,
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
