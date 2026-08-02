# terrilives
Parallel lives? Nah-- Terribel lives. Terri..bel. Terrible. - ...Terrible lives.

## Where the documentation is

Start with **[docs/glossary.md](docs/glossary.md)** - every term the
game, the debug overlay and the specs use, defined in plain language.
If a word anywhere in this project did not explain itself, it is
there; if it is not there, that is a bug in the docs.

Then, by what you want:

| You want | Read |
| --- | --- |
| What the game is meant to become | [docs/alpha-goals.md](docs/alpha-goals.md) - eleven DONE criteria |
| What is built so far | [docs/FEATURES.md](docs/FEATURES.md) |
| How it is put together, and why | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Why one specific decision went that way | `docs/specs/` - one working design per milestone, IDs stable |
| What play actually felt like, measured | [docs/alpha-feel-notes.md](docs/alpha-feel-notes.md) |
| Which UI strings are functional and which await the owner's voice pass | [docs/player-visible-strings.md](docs/player-visible-strings.md) |
| Mistakes already made, so they are not made twice | [docs/lessons-learned.md](docs/lessons-learned.md) |
| How the testing gates work | [docs/testing-protocol.md](docs/testing-protocol.md) |

Run it - there are exactly two instances, by standing rule, and no
others should be started:

| Port | Command | Serves |
| --- | --- | --- |
| 5174 | `npm --prefix web run dev` | the working tree, live |
| 4173 | `npm --prefix web run preview` | the last `npm run build` |

Both are HTTPS (a LAN address needs a secure context for WebGPU, so a
phone on the same network can play at `https://<lan-ip>:5174`). Add
`?debug=1` for the developer overlay - it folds to a pill on narrow
screens, and every line it prints is defined in the glossary.

The game restores its one browser-local save slot on startup and autosaves
once per simulated day. Save, Load, New game, Queue, Clear orders, and Help
are in the normal HUD. Tap or click to select and direct; long-press or
right-click for the full action menu; drag and pinch or wheel for the camera.
With the canvas focused, arrow keys cycle world targets, Space selects a
person, Enter opens actions, and Escape closes the action menu.
