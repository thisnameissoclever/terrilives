# The installed game: build, test and release

This is the maintainer runbook for the installed game in `desktop/`, issue 276. Players read the README's [Local install](../README.md#local-install) section instead.

The installed game is an Electron app that serves the built website, `web/dist`, from disk under `natural-causes://game/`. It plays offline and saves to ordinary files. The Windows installer is unsigned, built on the owner's PC and attached to a draft GitHub release. The Mac app is signed with the owner's Developer ID and notarized by the `desktop-mac` workflow when that release is published. Changes under `desktop/` do not start the Pages deployment.

## How it fits together

- `desktop/src/main.js` is the only file that touches Electron. It registers the `natural-causes` scheme, opens the game window, answers save requests from the page, and asks the page to save before closing and when minimizing. On close, the page first waits for any save or load already running; the app waits up to ten seconds for the answer, and quitting waits up to five more for file writes in progress.
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

The Windows installer is built on the owner's Windows PC. The Mac disk images are built by the GitHub Actions workflow `.github/workflows/desktop-mac.yml` on GitHub's standard macOS runners, because the owner has no Mac. The owner approved that workflow on 2026-11-25. It runs only when a release is published, or when a maintainer starts it by hand for an existing release's tag; it never runs on a push or a pull request.

The release script refuses to run unless `gh` is signed in, the working tree is clean, HEAD equals `origin/main` after a fetch, wasm-pack matches the minor version pinned in `.github/workflows/pages.yml`, Node is 22.12 or later, and `.local-build/local-ci/report.json` records a complete, passing local CI run for HEAD. It runs only on Windows.

```text
py -3 -B scripts/check-local-ci.py run --report .local-build/local-ci/report.json
node desktop/scripts/release.js
```

The run builds wasm, the website and the installer, writes `SHA256SUMS-windows.txt`, prints sizes, creates the draft release `v<version>` at HEAD if it does not exist, and uploads four files: the installer, its `.blockmap`, `latest.yml` and the checksum file. The automatic updater reads `latest.yml` and the `.blockmap`, so a release without them cannot update anyone. The script checks that `latest.yml` names this version and this installer before it uploads anything. Add `--dry-run` to stop before touching GitHub, and `--replace` to replace the Windows files on an existing draft.

When the draft has the four Windows files, publish it:

```text
node desktop/scripts/release.js --publish
```

### Mac signing secrets

The workflow reads five repository secrets. None of this material is ever committed.

| Secret | What it holds | Where it comes from |
| --- | --- | --- |
| `MAC_CERT_P12_BASE64` | The Developer ID Application certificate and its private key, exported as a `.p12` file and base64 encoded. The workflow decodes it to a temporary file and passes that path as `CSC_LINK`. | The owner's Apple Developer account, team G8NAYQQS78. The owner holds the certificate privately. |
| `MAC_CERT_PASSWORD` | The password chosen when exporting the `.p12`; passed as `CSC_KEY_PASSWORD`. | Set by the owner at export. |
| `APPLE_API_KEY_P8` | The contents of the App Store Connect API key file (`AuthKey_<id>.p8`). The workflow writes it to a temporary file and passes that path as `APPLE_API_KEY`. | An App Store Connect team API key with the Developer role, created under Users and Access, Integrations. The file downloads only once. |
| `APPLE_API_KEY_ID` | That key's ID. | Shown beside the key in App Store Connect. |
| `APPLE_API_ISSUER` | The issuer ID for the team's keys. | Shown above the key list in App Store Connect. |

Publishing starts the Mac workflow. GitHub runs the workflow file as it exists at the release's tag, so a tag made before the workflow was added never starts it; and uploading after publication works only while the repository's immutable releases setting stays off. It checks out the release's tag, confirms that `web/package.json` has the same version, builds wasm, the website and the app for arm64 and x64, signs it with the Developer ID Application certificate for team G8NAYQQS78 under the hardened runtime (`desktop/build/entitlements.mac.plist` allows only JIT and unsigned executable memory, which V8 needs), notarizes and staples it, and uploads both disk images, both update zips with their `.blockmap` files, `latest-mac.yml` and `SHA256SUMS-macos.txt` to the release. It fails with a clear message if any signing secret is missing, and fails unless `codesign`, `stapler` and `spctl` accept both apps. It needs only the `contents: write` permission, and gives the token only to the steps that read the release and upload. The signing secrets exist only in the build step, the certificate and key are written to the runner's temp folder, and an `always()` step deletes them. If it fails, fix the cause and run it again from the Actions tab with the release's tag; it replaces any Mac files already uploaded. A published release cannot be given new Windows files; raise the version for the next one.

## Automatic updates

The installed game checks for updates when it starts, only when it is packaged and never on the website. Pass `--no-update-check` to skip the check during verification.

- electron-updater (pinned to 6.8.11, the version that shares `builder-util-runtime` 9.7.0 with electron-builder 26.18.0) reads `latest.yml` on Windows or `latest-mac.yml` on a Mac from the newest published release of `thisnameissoclever/terrilives`, downloads the update in the background (the installer on Windows, the zip for the Mac's processor on a Mac), and installs it when the player closes the game. Nothing shows until the download is ready; then the time panel says "Update ready. It installs when you close the game." Nothing restarts the game. Drafts are ignored, so nothing updates before `--publish`.
- macOS installs updates only into a signed app whose signature matches, which is why the Mac app is signed and notarized. Windows checks no signature, because no `publisherName` is configured.
- The NSIS installer keeps a copy of itself in `%LOCALAPPDATA%\natural-causes-desktop-updater\installer.exe`. electron-updater uses that folder for downloads and differential updates; uninstalling does not remove it.

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

Nobody on the project has a Mac. The workflow log shows whether both apps built, signed, notarized and passed `spctl`. A Mac user must still check: the app opens without a Gatekeeper warning, WebGPU runs on Metal, saves land in `~/Library/Application Support/Natural Causes/saves`, Cmd+Q saves, a Dock minimize keeps the clock running, the Edit menu's Copy and Paste work, and an older installed version updates itself after a newer release is published.

## Measured sizes

Measured on 2026-11-25 for version 1.1.0 with Electron 45.3.0 and electron-builder 26.18.0, on a Windows 11 x64 desktop. The second build is the first with automatic updates: electron-updater adds about 2 MB to the app, and the installer is packed for partial updates (the `.blockmap`), which compresses it less tightly. Later updates then download only the blocks that changed.

| Output | Commit `dd932d662` | Commit `7a1d6c3a2` |
| --- | ---: | ---: |
| `web/dist`, the built website, bytes | 585,338,082 | 585,373,052 |
| `desktop/dist/win-unpacked`, the unpacked app, bytes | 958,933,744 | 961,158,316 |
| `Natural-Causes-Setup-1.1.0-x64.exe`, the installer, bytes | 259,855,869 | 314,407,671 |
| `Natural-Causes-Setup-1.1.0-x64.exe.blockmap`, bytes | none | 320,553 |

Measure again with `Get-ChildItem -Recurse -File <folder> | Measure-Object Length -Sum` in PowerShell, or `du -sb <folder>` on a Mac. The Mac disk images have not been measured yet.

The installer leaves a copy of itself in `%LOCALAPPDATA%\natural-causes-desktop-updater\installer.exe` (the same size as the installer) after installing, and uninstalling does not remove it. electron-updater keeps that folder for its downloads.

## Follow-ups

- Electron fuses stay at their defaults. Turning off `RunAsNode`, `EnableNodeCliInspectArguments` and `EnableNodeOptionsEnvironmentVariable`, and turning on asar integrity validation and `OnlyLoadAppFromAsar`, would harden the packaged app. Each needs its own packaged verification.
- Windows can end the app during shutdown before the close save finishes. The page's autosaves and the minimize save limit what can be lost.
- Saving copies the save across the bridge up to three times per save (slot, last good copy, recovery backup). Measure an autosave's frame time if saves grow large.
