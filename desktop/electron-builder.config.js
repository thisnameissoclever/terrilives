'use strict';

/**
 * Packaging for the installed game. The unsigned Windows installer is built
 * on the owner's PC; the signed and notarized Mac builds come from
 * .github/workflows/desktop-mac.yml;
 * both are attached to a GitHub release by scripts, never by electron-builder
 * itself (every build runs with --publish never).
 *
 * The `publish` entry tells electron-updater where releases live. It also
 * makes electron-builder write latest.yml with the installer's .blockmap on
 * Windows, and latest-mac.yml with the zips' .blockmap files on a Mac, which
 * the release must carry for updates.
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
  // The packaged app never runs as plain Node and ignores Node's debugging
  // switches and NODE_OPTIONS, so nobody can use it to run their own code.
  electronFuses: {
    runAsNode: false,
    enableNodeCliInspectArguments: false,
    enableNodeOptionsEnvironmentVariable: false,
  },
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
  // Signed with the owner's Developer ID Application certificate (team
  // G8NAYQQS78) and notarized, which macOS updates require. The certificate
  // and the notarization key reach the build only through the desktop-mac
  // workflow's secrets (CSC_LINK, APPLE_API_KEY and friends). The zip is
  // what electron-updater downloads on a Mac; the dmg is for first installs.
  mac: {
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }, { target: 'zip', arch: ['arm64', 'x64'] }],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    notarize: true,
    category: 'public.app-category.simulation-games',
    icon: 'build/icon.png',
    artifactName: 'Natural-Causes-${version}-${arch}-mac.${ext}',
  },
  dmg: {
    artifactName: 'Natural-Causes-${version}-${arch}.${ext}',
    writeUpdateInfo: false,
  },
};
