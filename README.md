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
| Mistakes already made, so they are not made twice | [docs/lessons-learned.md](docs/lessons-learned.md) |
| How the testing gates work | [docs/testing-protocol.md](docs/testing-protocol.md) |

Run it: `npm --prefix web run dev:lan` (live tree, port 5174) or
`npm --prefix web run preview` (built, port 4173). Add `?debug=1` for
the developer overlay.
