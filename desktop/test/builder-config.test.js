'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const config = require('../electron-builder.config.js');

const read = (relative) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'));
const desktopPackage = read('package.json');
const desktopLock = read('package-lock.json');
const webPackage = read('../web/package.json');

test('identifies the app permanently', () => {
  assert.equal(config.appId, 'life.natural-causes.game');
  assert.equal(config.productName, 'Natural Causes');
  assert.equal(desktopPackage.productName, 'Natural Causes');
  assert.equal(desktopPackage.main, 'src/main.js');
});

test('packages the shell and the built website, and names GitHub releases for updates', () => {
  assert.deepEqual(config.files, ['src/**', 'package.json']);
  assert.equal(config.asar, true);
  assert.deepEqual(config.extraResources, [{ from: '../web/dist', to: 'web' }]);
  assert.deepEqual(config.publish, { provider: 'github', owner: 'thisnameissoclever', repo: 'terrilives' });
  assert.equal(config.directories.output, 'dist');
  // Nothing in the package scripts lets electron-builder publish by itself.
  assert.match(desktopPackage.scripts['pack:dir'], /--publish never/);
});

test('takes its version from web/package.json, the only typed copy', () => {
  assert.match(webPackage.version, /^\d+\.\d+\.\d+$/);
  assert.equal(config.extraMetadata.version, webPackage.version);
  assert.equal(desktopPackage.version, undefined);
});

test('installs per user on Windows and keeps saves on uninstall', () => {
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  // Left at its default so the installer gets the .blockmap updates use.
  assert.equal(config.nsis.differentialPackage, undefined);
  assert.equal(config.nsis.artifactName, 'Natural-Causes-Setup-${version}-x64.${ext}');
});

test('builds ad hoc signed Mac disk images for both processors', () => {
  assert.deepEqual(config.mac.target, [{ target: 'dmg', arch: ['arm64', 'x64'] }]);
  assert.equal(config.mac.identity, '-');
  assert.equal(config.mac.hardenedRuntime, false);
  assert.equal(config.dmg.artifactName, 'Natural-Causes-${version}-${arch}.${ext}');
  assert.equal(config.dmg.writeUpdateInfo, false);
});

test('ships its icons', () => {
  for (const icon of [config.win.icon, config.mac.icon]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', icon)), icon);
  }
  const png = fs.readFileSync(path.join(__dirname, '..', config.mac.icon));
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  const ico = fs.readFileSync(path.join(__dirname, '..', config.win.icon));
  const sizes = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) sizes.push(ico[6 + i * 16] || 256);
  assert.ok(sizes.includes(256), `icon.ico sizes ${sizes}`);
});

test('pins exactly Electron, electron-builder and the matching electron-updater', () => {
  assert.deepEqual(desktopPackage.devDependencies, { electron: '45.3.0', 'electron-builder': '26.18.0' });
  assert.deepEqual(desktopPackage.dependencies, { 'electron-updater': '6.8.11' });
  const root = desktopLock.packages[''];
  assert.deepEqual(root.devDependencies, desktopPackage.devDependencies);
  assert.deepEqual(root.dependencies, desktopPackage.dependencies);
  assert.equal(desktopLock.packages['node_modules/electron'].version, '45.3.0');
  assert.equal(desktopLock.packages['node_modules/electron-builder'].version, '26.18.0');
  assert.equal(desktopLock.packages['node_modules/electron-updater'].version, '6.8.11');
  // electron-updater reads the update files with the runtime electron-builder writes them with.
  assert.equal(desktopLock.packages['node_modules/builder-util-runtime'].version,
    desktopLock.packages['node_modules/app-builder-lib'].dependencies['builder-util-runtime']);
});

test('the shell is plain CommonJS that the website never imports', () => {
  assert.equal(desktopPackage.type, 'commonjs');
  const webSource = path.join(__dirname, '../../web/src');
  for (const name of fs.readdirSync(webSource, { recursive: true })) {
    const file = path.join(webSource, String(name));
    if (!/\.(ts|js|mjs)$/.test(file) || !fs.statSync(file).isFile()) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /from ['"][^'"]*desktop\/|require\(['"][^'"]*desktop\//, file);
  }
});
