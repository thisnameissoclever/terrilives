# The installed game: build, test and release

This is the maintainer runbook for the installed game in `desktop/`, issue 276. Players read the README's [Local install](../README.md#local-install) section instead.

The installed game is an Electron app that serves the built website, `web/dist`, from disk under `natural-causes://game/`. It plays offline and saves to ordinary files. Installers are unsigned, built on the owner's machines, and attached to a draft GitHub release. No GitHub Actions workflow builds or publishes them, and changes under `desktop/` do not start the Pages deployment.

## How it fits together

- `desktop/src/main.js` is the only file that touches Electron. It registers the `natural-causes` scheme, opens the game window, answers save requests from the page, and asks the page to save before closing and when minimizing.
- `desktop/src/app-protocol.js` serves files from the bundle with the three cross-origin isolation headers on every response. It never sends `Content-Encoding`: the game decompresses its own `.gz` files.
- `desktop/src/save-files.js` stores the save files in `<userData>/saves`. It accepts only the names the game's slot rules produce, writes each file atomically, and runs one operation at a time.
- `desktop/src/window-policy.js` decides where links go. The game window stays on the game's site. The guide, changelog and startup report open in separate app windows. Links to `natural-causes.life`, `thisnameissoclever.github.io`, `github.com` and `mailto:` go to the system's browser or mail program. Everything else is refused.
- `desktop/src/preload.js` exposes one global to the game page, `window.naturalCausesDesktop`. The page detects the installed game by that global alone (`web/src/storage/desktop-bridge.ts`) and then saves through `FileSaveBackend`, which applies the same slot rules as the website's storage worker (`web/src/storage/save-slot.ts`).

The app identifier `life.natural-causes.game`, the product name "Natural Causes", the scheme `natural-causes` and the host `game` are permanent. The origin keys the page's stored preferences, and the product name names the user data folder, so changing any of them loses settings or strands saves.

## Run it without packaging

Build the website first, then start Electron on it:

```text
wasm-pack build crates/terri-wasm --target web --out-dir ../../web/src/wasm
npm --prefix web ci
npm --prefix web run build
npm --prefix desktop ci
npm --prefix desktop start
```

Electron downloads its own binary the first time `electron` runs. In this version the npm package downloads it on first use, not during `npm ci`.

For verification, keep the test away from your real saves and speakers:

```text
desktop/node_modules/.bin/electron desktop --user-data-dir=.scratch/desktop-profile --mute-audio --remote-debugging-port=9333
```

- `--user-data-dir=<path>` puts the profile, preferences and `saves` folder in a throwaway folder. Delete it afterwards.
- `--mute-audio` mutes every window. Turn Sound off in Options as well.
- `--remote-debugging-port=9333` lets a Chrome DevTools Protocol client, such as Playwright's `connectOverCDP`, drive the page.

The packaged app accepts the same switches. Close every instance you start; a second launch only focuses the first window.

## Tests

`node --test` runs the shell's tests without Electron:

```text
cd desktop
node --test test/app-protocol.test.js test/save-files.test.js test/window-policy.test.js test/builder-config.test.js test/release.test.js
```

The protocol test reads the fresh `web/dist` and fails if the build contains a file type the protocol has no deliberate content type for. Local CI runs these tests in its `desktop` group after the web build; see [local checks](local-checks.md). It never packages an installer.

## Package

```text
cd desktop
npx electron-builder --win --dir --config electron-builder.config.js --publish never
npx electron-builder --win --config electron-builder.config.js --publish never
```

The first command writes the unpacked app to `desktop/dist/win-unpacked`. The second writes the per-user NSIS installer, `desktop/dist/Natural-Causes-Setup-<version>-x64.exe`. `desktop/dist/` is ignored by Git. The version comes from `web/package.json` through `extraMetadata`; `desktop/package.json` has no version of its own.

The first build downloads Electron, NSIS and winCodeSign into the electron-builder cache. If extracting winCodeSign fails with "A required privilege is not held by the client", Windows is refusing to create symbolic links. Enabling Windows Developer Mode fixes it; that is the owner's decision, so stop and ask.

## Release

Releases are drafts until both platforms have uploaded. The script refuses to run unless `gh` is signed in, the working tree is clean, HEAD equals `origin/main` after a fetch, wasm-pack matches the minor version pinned in `.github/workflows/pages.yml`, and Node is 22.12 or later. On Windows it also requires `.local-build/local-ci/report.json` to record a complete, passing local CI run for HEAD.

On Windows:

```text
py -3 -B scripts/check-local-ci.py run --report .local-build/local-ci/report.json
node desktop/scripts/release.js --win
```

On the Mac, from the same commit:

```text
sh desktop/scripts/release-mac.sh
```

The Mac script checks for the Xcode command line tools, rustup, wasm-pack, Node and gh, then runs the release script with `--mac`.

Each run builds wasm, the website and the installers, writes `SHA256SUMS-windows.txt` or `SHA256SUMS-macos.txt`, prints sizes, creates the draft release `v<version>` at HEAD if it does not exist, and uploads only the installers and the checksum file. It never uploads `latest*.yml` or `.blockmap` files: the game has no auto-updater. Add `--dry-run` to stop before touching GitHub, and `--replace` to replace this platform's installers on an existing draft.

When the draft has the Windows installer, both Mac disk images and both checksum files, publish it:

```text
node desktop/scripts/release.js --publish
```

A published release cannot be added to; raise the version for the next one.

## Versions and cadence

`web/package.json` is the only typed copy of the version. The Rust workspace version, the README's version line and the npm lockfile are checked copies (`web/tests/game-version.test.ts`). Patch bumps are at the implementing agent's discretion; minor and major bumps need the owner. The tag is `v<version>`.

Aim for a weekly release when the game has changed. Each release reuses the public changelog for its player-facing notes.

When re-pinning Electron, choose the newest stable release that has been public for at least two weeks, pin it exactly in `desktop/package.json`, regenerate `desktop/package-lock.json`, update `desktop/test/builder-config.test.js`, and rerun every check in this runbook. The two-week rule means security fixes arrive up to two weeks late.

## Verify a build on Windows

1. Run the unpacked app and the installed app with a throwaway profile and `--mute-audio`.
2. Confirm the window shows the household, `crossOriginIsolated` is true, `SharedArrayBuffer` exists and `navigator.gpu.requestAdapter()` returns an adapter. Every network request should use `natural-causes:` or `data:`.
3. Save from Options. `saves/terri-save-1.bin` starts with `TERRISAV`; a second save creates `terri-save-1.previous.bin` with the first save's bytes; no `.tmp-` file remains.
4. Close the window and relaunch: the same household, day and time return.
5. Minimize for two minutes at a known speed: game time keeps passing, and the slot is written when the window minimizes.
6. Export save opens a native save dialog; Import save opens a native open dialog and then the confirmation.
7. Install per user, launch from the Start menu, uninstall, and confirm the `saves` folder remains.

A Mac must check: both disk images build, `codesign -dv` reports an ad hoc signature for arm64 and x64, the app launches through the Gatekeeper steps in the README, WebGPU runs on Metal, saves land in `~/Library/Application Support/Natural Causes/saves`, Cmd+Q saves, a Dock minimize keeps the clock running, and the Edit menu's Copy and Paste work.

## Measured sizes

MEASUREMENTS_PLACEHOLDER

## Follow-ups

- Electron fuses stay at their defaults. Turning off `RunAsNode`, `EnableNodeCliInspectArguments` and `EnableNodeOptionsEnvironmentVariable`, and turning on asar integrity validation and `OnlyLoadAppFromAsar`, would harden the packaged app. Each needs its own packaged verification.
- Windows can end the app during shutdown before the close save finishes. The page's autosaves and the minimize save limit what can be lost.
- Saving copies the save across the bridge up to three times per save (slot, last good copy, recovery backup). Measure an autosave's frame time if saves grow large.
