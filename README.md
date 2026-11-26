# Natural Causes

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/branding/logo-dark.png">
    <img src="web/public/branding/logo-light.png" alt="Natural Causes wilted-flower logo" width="420">
  </picture>
</p>

<p align="center">
  <a href="https://natural-causes.life/">
    <img src="docs/assets/play-natural-causes.svg" alt="Play Natural Causes in your browser" width="360" height="80">
  </a>
</p>

<p align="center">Play the live game at natural-causes.life. Use a browser with WebGPU support.</p>

<p align="center"><a href="https://natural-causes.life/guide/">Player guide</a> | <a href="https://natural-causes.life/changelog/">Changelog</a></p>

Natural Causes is a dark-comedy life sim that runs in the browser, or as an
installed game on Windows and Mac (see [Local install](#local-install)). The
current cast is Tim, Bill, and Casey.

Version 1.1.0. The game reads its version from `web/package.json` and shows it
at the top of the Options panel. This line and the Rust workspace version in
`Cargo.toml` are copies; `web/tests/game-version.test.ts` fails if either
differs.

**`terrilives` was the working title and is still the internal codename.** The
repository, the play URL, the `terri-*` crates, the browser storage keys, and
the save file all keep it on purpose: renaming the storage keys would reset
every player's settings, renaming the save fingerprint seeds would invalidate
every existing save, and renaming the repository would move the public play
URL. `docs/TIM-TODO.md` [T1] records the decision and what is still open.

## Local install

The installed game is the same game as the website, packaged for Windows and
Mac. Download it from the repository's
[Releases page](https://github.com/thisnameissoclever/terrilives/releases):
`Natural-Causes-Setup-<version>-x64.exe` for Windows,
`Natural-Causes-<version>-arm64.dmg` for a Mac with Apple silicon, or
`Natural-Causes-<version>-x64.dmg` for a Mac with an Intel processor. The
download is several hundred MB, because it carries its own copy of the
Chromium browser engine. On Windows, run the installer; it installs for your
user account unless you choose to install it for everyone on the computer. On Mac, open the disk image and drag Natural Causes into
Applications.

How it differs from the website:

- It plays offline. Updates download in the background while you play; see
  below.
- Your saved game is an ordinary file, not browser storage, so browser storage
  limits and clearing site data do not affect it. It lives in
  `%APPDATA%\Natural Causes\saves` on Windows and
  `~/Library/Application Support/Natural Causes/saves` on Mac. Uninstalling
  the game leaves that folder in place. The Windows installer also keeps a
  copy of itself, about 315 MB, in
  `%LOCALAPPDATA%\natural-causes-desktop-updater`; delete that folder after
  uninstalling if you want the space back.
- The game keeps running while its window is minimized, and it saves when you
  minimize or close the window.
- **Export save** and **Import save** in Options move a game between the
  website and the installed game, in either direction. Export save writes a
  file; Import save loads one after you confirm, replacing the current game.
- The game updates itself on Windows and Mac: it downloads a new version in
  the background and installs it when you close the game. A short note under
  the time says when an update is ready. Your saves stay where they are.

The Mac app is signed with the developer's Apple Developer ID and notarized
by Apple; macOS may ask you to confirm once before it first opens. The Windows
installer is not signed, so Windows warns before the first install: if
SmartScreen says it protected your PC, choose **More info**, then **Run
anyway**. Some antivirus programs also flag unsigned installers.

Each release lists SHA-256 checksums for its downloads. Maintainers build and
publish releases with [the desktop release runbook](docs/desktop-release.md).

## Where the documentation is

Start with **[docs/glossary.md](docs/glossary.md)** - every term the
game, the debug overlay and the specs use, defined in plain language.
If a word anywhere in this project did not explain itself, it is
there; if it is not there, that is a bug in the docs.

Then, by what you want:

| You want | Read |
| --- | --- |
| What the playable alpha must prove | [docs/alpha-goals.md](docs/alpha-goals.md) - eleven acceptance criteria; ten complete and the owner's voice pass open |
| What is built so far | [docs/FEATURES.md](docs/FEATURES.md) |
| Significant changes to the game | [Public changelog](https://natural-causes.life/changelog/) and [maintenance guide](docs/changelog.md) |
| How it is put together, and why | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Why one specific decision went that way | `docs/specs/` - one working design per milestone, IDs stable |
| What play actually felt like, measured | [docs/alpha-feel-notes.md](docs/alpha-feel-notes.md) |
| Which UI strings are functional and which await the owner's voice pass | [docs/player-visible-strings.md](docs/player-visible-strings.md) |
| Mistakes already made, so they are not made twice | [docs/lessons-learned.md](docs/lessons-learned.md) |
| How the testing gates work | [docs/testing-protocol.md](docs/testing-protocol.md) |
| How to run checks locally and retain their results | [docs/local-checks.md](docs/local-checks.md) |
| How to build, test and release the installed game | [docs/desktop-release.md](docs/desktop-release.md) |

### The bracketed tags in code comments and docs

Comments across `crates/` and `web/src/` cite decisions by tag rather
than repeating them. Each letter says which file the tag lives in, so a
citation can be followed without asking anyone:

| Tag | Points at | Example |
| --- | --- | --- |
| `[L...]` | a mistake already made, in [docs/lessons-learned.md](docs/lessons-learned.md) | `[L41]`, `[L-shared-counter-ids]` |
| `[A-...]` | a measured or watched play session, in [docs/alpha-feel-notes.md](docs/alpha-feel-notes.md) | `[A-14]` |
| `[T...]` | something only the owner can do, in [docs/TIM-TODO.md](docs/TIM-TODO.md) | `[T22]` |
| `[D...]`, `[E...]`, `[K...]`, `[X...]` and friends | a decision inside one working design in `docs/specs/` | `[E4]` is the career design |

Older tags are numbered and newer ones are slugs; both are permanent and
neither is ever reused. `docs/lessons-learned.md` explains why the
numbering stopped, and `check-doc-ids.py` enforces it.

Run it - there are exactly two instances, by standing rule, and no
others should be started:

| Port | Command | Serves |
| --- | --- | --- |
| 5174 | `npm --prefix web run dev` | the working tree, live |
| 4173 | `npm --prefix web run preview` | the last `npm run build` |

Both use HTTPS when `web/.cert/cert.pem` and `web/.cert/key.pem` exist;
otherwise they use HTTP. Localhost still counts as a secure WebGPU context,
but a phone on the same network needs the certificate-backed
`https://<lan-ip>:5174` route. Add
`?debug=1` for the developer overlay - it folds to a pill on narrow
screens, and every line it prints is defined in the glossary.

The game restores its one browser-local save slot on startup and autosaves
once per simulated day. Save, Load, New game, Queue, Clear orders, and Help
are in the normal HUD. Tap or click to select and direct; long-press or
right-click for the full action menu; drag and pinch or wheel for the camera.
With the canvas focused, arrow keys cycle world targets, Space selects a
person, Enter opens actions, and Escape closes the action menu.
