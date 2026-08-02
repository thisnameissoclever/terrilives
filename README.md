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
| What the playable alpha must prove | [docs/alpha-goals.md](docs/alpha-goals.md) - eleven acceptance criteria; ten complete and the owner's voice pass open |
| What is built so far | [docs/FEATURES.md](docs/FEATURES.md) |
| How it is put together, and why | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Why one specific decision went that way | `docs/specs/` - one working design per milestone, IDs stable |
| What play actually felt like, measured | [docs/alpha-feel-notes.md](docs/alpha-feel-notes.md) |
| Which UI strings are functional and which await the owner's voice pass | [docs/player-visible-strings.md](docs/player-visible-strings.md) |
| Mistakes already made, so they are not made twice | [docs/lessons-learned.md](docs/lessons-learned.md) |
| How the testing gates work | [docs/testing-protocol.md](docs/testing-protocol.md) |

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
