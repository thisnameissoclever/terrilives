# Design language: five options

Status: **options paper, nothing agreed.** Feeds [T12] (palette), [T13]
(style bible) and the new [T-design-language] in `docs/TIM-TODO.md`.
Nothing here is scheduled and nothing here is built. Written 2026-08-03.

## Summary

The alpha looks like what it is: CC0 Kenney furniture on a dark HUD that
was explicitly scoped as "legible enough to read a decision against"
([D-7]). That was correct for M0 through M2g and it is the wrong thing to
ship, because `docs/TECH_STACK.md` already names the cost honestly - a
game built from public CC0 packs looks like other games built from public
CC0 packs, and the mitigation that works is making the **palette,
lighting and UI** distinctive, all three of which are code.

This paper proposes five design languages and costs each one. The finding
that matters most is structural rather than aesthetic:

**The interface and the world are fully separable in this codebase.** The
UI is DOM and CSS, the world is a WebGPU canvas, and nothing couples
them. Three of the five options below live entirely in the interface and
touch no sprite; two rewrite the sprites. That means the interface fiction
can be chosen this month for the price of a CSS rewrite, thrown away if it
is wrong, and the expensive world treatment decided separately and later.
Treating "the design language" as one indivisible decision is what would
make it expensive.

The five, cheapest first:

| Option | Where the identity comes from | Money | Work | Reversible |
| --- | --- | --- | --- | --- |
| [DL-broadcast] Channel 9 | Interface + generated text | none | ~3 days | fully |
| [DL-casefile] Case File | Interface + one grade pass | none | ~4 days | fully |
| [DL-triplicate] Triplicate | Both: ink-line sprites, form UI | none | ~2 weeks | atlas is regenerable |
| [DL-riso] Civic Riso | World: 4-ink quantise + screen-space grain | none | ~2 weeks | atlas is regenerable |
| [DL-gouache] Gouache Diorama | World: AI-painted renders | GPU time | ~6 weeks + forever | no |

My recommendation is at the bottom, after the shared prerequisites and
the five write-ups.

## [DL-prereqs] What any of these needs first

Six things are common to more than one option, and four of them are real
engineering rather than taste. Reading this section first stops each
option's cost estimate from re-explaining the same work.

**A cross-platform atlas post-pass.** `assets/sprites/build-atlas.ps1` is
Windows-only, uses `System.Drawing`, and CI never runs it - the atlas is a
committed artifact. Every option that changes how sprites look needs
per-sprite image processing: quantise, dither, edge-detect, dilate,
outline. Do not extend the PowerShell. Write a separate Python and Pillow
step that reads `atlas.png` and writes `atlas.png`, so it runs on Linux,
in CI, and under an agent. The PowerShell keeps its current job of
assembling the sheet from the kit; the new step keeps the job of styling
it. Roughly 150 lines, plus a test that the sprite rects in `atlas.toml`
still match after the pass.

**`MAX_SPRITES` is 128 and 48 are used.** The atlas table in
`sprites.wgsl` is a fixed-size uniform array and WGSL clamps an
out-of-range index silently rather than trapping, which the comment there
already warns about. Four facings per object, which the next engineering
slice in `docs/FEATURES.md` wants anyway, blows past 128 on its own. Any
option that multiplies sprite variants needs the atlas table moved from a
uniform array to a read-only storage buffer first. That is about 20 lines
across `sprites.ts` and `sprites.wgsl` and it should happen regardless of
which option wins.

**Per-instance tint does not exist.** An instance is one `vec4<f32>`:
screen x, screen y, depth, sprite index. There is nowhere to put a colour.
[DL-riso] and any palette-recolour work ([G4]) need a second `vec4`
attribute, which is a contract change across `instances.ts`,
`sprites.wgsl`, `frame.ts`, `tiles.ts` and their tests. Instance size goes
16 to 32 bytes, so 1,000 entities cost 32 KB a frame instead of 16 KB.
Against a measured mean of 0.261 ms in a 16.6 ms budget that is not a
performance question, only a plumbing one.

**A post-process pass costs the one-draw-call claim.** [D10] and
`docs/gpu-verification.md` both state one draw and one submit per frame,
and that number is quoted in several places. A screen-space grade means
rendering to an offscreen texture and then drawing one fullscreen triangle
to the swapchain: two render passes in one submit, two draws. The frame
budget does not care. The documentation does, and
`docs/gpu-verification.md` would need re-measuring rather than editing,
because [L19] is exactly about quoting numbers that were not measured the
way the claim implies.

**Fonts are the cheapest identity available and are currently unused.**
The shell asks for `system-ui, sans-serif`, so the game looks like the
operating system it is running on. Two self-hosted woff2 faces under the
SIL Open Font License change the read of every screen for the price of two
files in `web/public` and a `@font-face` block. Every option below names
its two.

**Motion has to switch off.** The codebase already respects
`prefers-reduced-motion` for the walking lift. A crawling ticker, a
scanline sweep, a paper boil and a CRT flicker are all in the same
category and all need the same switch, not as a polish item but as part of
the first commit that introduces them.

---

## [DL-triplicate] Triplicate

**You are not playing a household. You are reading its file.**

The world is drawn as a technical document: ink lines on paper, flat
category fills, no shading, no material. A grid on the floor because the
floor is a plan. The satire lands before a single string is written,
because a game that renders a marriage as a form is already making the
joke `docs/FEATURES.md` says the tone is about - institutional form,
deadpan, not named people.

**The world.** Run every Kenney isometric render through the offline pass:
a morphological gradient on alpha plus a luminance edge, thresholded to a
one-pixel ink line, then flood the interior with one of three flat tints
keyed to what the object is **for** rather than what it is made of.
Bedroom things one tint, kitchen things another, plumbing a third. The
pack's soft ambient-occlusion gradients are what make Kenney renders
recognisable at a glance, and this pass throws all of them away. The
generated `floor` sprite gets regenerated as a diamond with a hairline
grid rather than a darker edge, which is a change to code that already
exists rather than new art.

**The sims.** The current sim sprite is an ellipse assembly, honestly
described in `ASSETS.md` as the cheapest thing that reads as a person at
78 px. Under this direction it becomes a drafting figure, which is what
human symbols in architectural drawings are supposed to be - schematic,
unshaded, obviously a notation rather than a portrait. This is the only
option where "the developer cannot draw people" stops being a liability
and becomes the style. Worth weighing heavily, because [O6] says
characters are the hard part and this option deletes the problem instead
of paying for it.

**The interface.** Forms. Public Sans for labels, which is the typeface
the US federal government publishes under the OFL, and Courier Prime for
values, so entered data looks typed and printed data looks set. Panels are
pale sheets with a rule under every field label and boxed fields.
Need meters stop being gradient bars and become printed bars of block
characters or a row of ticked boxes, which is both more in register and
more legible at a glance than a colour ramp. State changes are rubber
stamps: SELECTED, AT WORK, ASLEEP, DECEASED, rotated a couple of degrees
and slightly ink-starved.

**The palette, which is the whole of [T12] under this option.** Three
inks. Paper, black, and one stamp red, with a form blue optional as a
fourth. That is the entire approval decision, and [K1]'s "define ~32
colours and snap everything to them" collapses to something Tim can
approve in a minute rather than a session.

**Where AI helps.** Only in the places `docs/TECH_STACK.md` already
fenced as good fits: department seals and letterheads ([AI3]), the paper
grain tile ([AI2]), and the diegetic 2D layer of forms, notices and
obituaries ([AI4]). No character generation, no prop generation, no
consistency problem, because there is nothing for the model to be
inconsistent about.

**Cost.** The atlas post-pass, the floor regeneration, a full rewrite of
the style block in `web/index.html`, and two fonts. No shader change and
no post-process, because the paper grain can be a translucent tiling PNG
in a `pointer-events: none` DOM layer over the canvas, which keeps the
one-draw-call claim intact. Call it two weeks of evenings, most of it
tuning line weight against real screenshots rather than writing code.

**Risks, stated plainly.** Line art thins out and goes grey at small
sizes, and the camera zooms, so the line weight that reads at zoom 1 will
disappear at zoom 0.5. Line weight has to be a parameter tuned against
captures at both ends of the zoom range, and if it cannot be made to work
at the low end the option fails there rather than somewhere convenient.
The second risk is that this commits the game to a light interface, and
the HUD is currently dark; supporting both means maintaining two full
themes, so realistically dark mode goes away.

**What it commits you to.** Documents as the game's whole visual
vocabulary. That is a narrow lane, and it happens to be the same lane as
the writing, so news, forms, performance reviews and death certificates
all have a place to live.

---

## [DL-riso] Civic Riso

**Everything is printed by a department with one working press and four
inks.**

Saturated spot colours, visible halftone, deliberate misregistration. The
register is the mid-century public-information pamphlet: a cheerful poster
explaining something terrible in a friendly voice. Where [DL-triplicate]
is precise and cold, this is loud and warm and slightly wrong, and it is
the strongest of the five at making the borrowed assets stop looking
borrowed.

**The world.** Quantise every atlas sprite to a fixed four-ink palette in
the offline pass. Not a recolour: an ink-coverage reduction, where each
source pixel becomes one of four values and the smooth shading is gone.
Then a fullscreen post-pass adds paper grain, a one-pixel per-channel
offset so the inks do not quite line up, and a soft vignette. The
misregistration is what actually sells riso to the eye and it is three
lines of WGSL - sample the atlas result three times at three offsets and
take one channel from each.

**One catch that decides the implementation.** Do not bake the halftone
dither into the atlas. Sprites are drawn one texel to one screen pixel at
zoom 1, but the camera zooms, so a dither pattern baked into a sprite
scales with the sprite and smears into visible blotches at anything but
1.0. The dither has to live in the screen-space post-pass, locked to the
display grid, where zoom cannot touch it. That single decision is the
difference between this option looking printed and looking broken, and it
is the sort of thing that is cheap to get right now and miserable to
retrofit across a styled atlas.

**The interface.** Poster. Archivo Black for headings in tight all-caps
tracking, Jost for body, both OFL. Panels are solid ink blocks with
knockout text in the paper colour. Heavy horizontal rules, no rounded
corners, no borders thinner than 2px. Need meters become segmented ink
blocks rather than continuous fills, because a segmented bar is what a
press can actually print. Buttons are solid rectangles that invert on
press.

**The palette.** Four swatches: a paper cream, an ink black, a riso blue,
and one fluorescent pink. [T12] becomes a four-colour approval, and [K1]'s
mechanical snap is trivially enforceable because there are only four legal
values in the whole atlas.

**Where AI helps.** The grain and paper tiles ([AI2]), and the diegetic 2D
layer ([AI4]), which is where this direction pays best - riso is a poster
medium, so in-world posters, pamphlets and notices are the native content
type and a model generating them has an unusually easy target.

**Cost.** The atlas post-pass, the storage-buffer change, per-instance
tint if one mesh should serve several ink assignments, the post-process
pass with its documentation consequence, and a CSS rewrite. Two weeks,
and more of it is code than [DL-triplicate] needs.

**Risks.** Four saturated inks across a life sim's very large amount of
simultaneous UI is fatiguing over a long session, and life sims are played
in long sessions. The mitigation is discipline about where the fluorescent
is allowed: state changes and alerts only, never a surface. The second
risk is that riso is fashionable in indie games right now, so it buys
distinctiveness against The Sims and much less against itch.io.

---

## [DL-casefile] Case File

**You are not a god. You are a caseworker, and this is the monitoring
software.**

The game does not have a UI; the game **is** an application, running in a
department, observing a household. The canvas is a monitoring feed. The
panels are the application's docked tools. Every command you issue is a
request filed against a case. The player's total inability to make a sim
do anything directly stops being a genre convention and becomes the joke.

**The world.** Geometry unchanged, grade changed. One post-process pass:
scanlines, a soft phosphor bloom, a slow bright scan sweep, a faint
interlace flicker. Keep colour rather than going monochrome green, which
is more readable and less of a costume. The house is still the Kenney
house and the conceit is that you are seeing it through equipment, which
is why this option needs no atlas work at all.

**Do not add barrel distortion.** It is the obvious CRT move and it would
break pointer picking, because `input.ts` maps a screen point to a world
tile with a linear inverse and a distorted canvas is not linear. Fixing
that means inverting the distortion on every pointer event, which is real
work to make the game slightly harder to click. Scanlines and bloom have
no coordinate effect and get most of the read.

**The interface.** The whole page becomes the application. A title bar
carrying a case number and a department name, a menu strip, docked panels
with 1px bevels instead of rounded cards, IBM Plex Mono throughout with
IBM Plex Sans for prose, both OFL. Need meters are numeric readouts with
ASCII bars. The action menu becomes a command field with an autocomplete
list, which is faster than the current menu for a keyboard player and
keeps the existing menu as the pointer path. Errors are modal dialogs.
Help becomes a manual page.

**The reason I rank this highest for value per hour.** It does real work
on [T22], the one open alpha criterion. Deadpan bureaucratic register is
both the joke and a constraint on what to write, and it gives every string
in `docs/player-visible-strings.md` a place to hide: object names become
catalogue entries, moodlets become flags, relationships become
associations, death becomes a case closure. Voice is the hardest thing on
the board and this option hands the writer a form to fill in. It also does
not need Tim to approve a palette, a style bible, or a purchase before
anything can start.

**Cost.** One post-process pass, one CSS rewrite, two fonts, no atlas
work, no image processing, no AI. Four days of evenings. The
one-draw-call documentation consequence applies and is the only thing that
is not free.

**Risks.** It is a worn look. Terminals and scanlines are common enough
that this buys tone identity rather than visual novelty, and anyone who
screenshots the lot sees a normal isometric house behind a filter. The
accessibility profile also needs care: scanlines over a moving camera with
small text is a genuine legibility problem, so the grade must be
switchable and off by default under `prefers-reduced-motion`. Keeping all
text in DOM outside the shader, which the architecture already does, is
what makes that survivable.

---

## [DL-broadcast] Channel 9

**The household is a story a news channel is covering, badly, forever.**

The chrome is broadcast graphics. A chyron under the selected sim carries
their name and current indignity. A ticker crawls the bottom of the screen
with headlines from a world where The Onion is simply how things work. Life
events get a breaking-news banner. The clock is a timecode, the speed
controls are a transport bar, and a LIVE bug pulses in the corner of a
canvas that is otherwise untouched.

**Why this is the cheapest option by a wide margin.** It is DOM, CSS and
text. Zero renderer change, zero atlas change, zero shader change, so the
one-draw-call claim and every number in `docs/gpu-verification.md` survive
completely intact. The camera-ID watermark and timecode are DOM elements
over the canvas, not burned into the frame.

**It turns [AI5] into the interface.** `docs/TECH_STACK.md` already calls
LLM-generated absurdist institutional headlines the single largest content
multiplier available for tone. This option gives that content a permanent,
always-visible surface instead of a flavour-text slot. Generate several
thousand headlines offline, commit them as content TOML, ship them in the
pack: no runtime model call, no API key, no per-player cost, no privacy
question, and the whole thing stays deterministic and testable, which the
content pipeline in [D9] already knows how to validate.

**The interface.** Barlow Condensed for chyrons and the ticker, because
broadcast typography is condensed for a reason and it buys line length back
on a phone, with Inter for panels. Both OFL. Panels slide in on a wipe
rather than a fade. The palette is a news-graphics palette: one deep
channel colour, one urgent red used only for banners, white text with a
hard drop shadow.

**Cost.** Three days for the chrome, and then a real content commitment
for the corpus. The chrome is not the expensive part.

**Risks, and the first one is serious.** This buys enormous personality
and zero visual differentiation. The lot still looks like a Kenney house,
so on a store page or a screenshot it reads as a stock-asset game, which is
precisely the cost `docs/TECH_STACK.md` says it is accepting. It combines
well as a second layer over [DL-triplicate] or [DL-riso] and it is the
weakest of the five as a complete answer on its own.

The second risk is the corpus. A ticker that starts repeating in the second
session is worse than no ticker, and the joke has to survive hours, not
minutes. That means a large corpus, non-repeating selection with a seeded
shuffle, and headlines that stay funny when read at a glance in peripheral
vision. Third: a permanently crawling ticker is a motion and attention cost
that some players will hate, so it needs both the reduced-motion switch and
its own toggle.

---

## [DL-gouache] Gouache Diorama

**A warm hand-painted picture book that keeps saying quietly upsetting
things.**

Soft gouache washes, visible brush texture, warm light, the whole lot
staged like a diorama under a shallow depth of field. The sweetness is the
setup and the writing is the punchline, which is a sharper version of dark
comedy than a dark palette would be. It is also the only option here that
produces art that exists nowhere else.

**The world.** [G1] executed for real, rather than as a note. Render the
CC0 low-poly meshes from the fixed isometric angle along with a depth pass,
run a depth-conditioned image model over each render with a fixed prompt,
seed and LoRA, and pack the painted results into the atlas. Perspective,
scale and lighting come from the 3D scene, so the model is only ever asked
to paint, never to understand isometric projection - which is the specific
thing AI image generation is worst at and the reason prompting for
isometric props fails.

**[K3] is not optional here.** A LoRA fine-tuned on 20 to 30 approved
assets is what makes forty chairs look like siblings rather than forty
chairs. Without it this option fails on exactly the case [AI-X4] fences
off: a catalogue grid, where inconsistency screams. Nothing else on this
list depends on a fine-tune working.

**[K2] stops being theory.** Prompt templates, model identity and hash,
sampler, seed policy and LoRA weights all have to be committed, because the
atlas becomes unregenerable the moment any of them is lost. `ASSETS.md`
already carries the discipline for borrowed art; this needs the same for
generated art, and the ledger has to be written before the first asset, not
after the fortieth.

**Cost, and it is the honest reason to rank this last.** A GPU, owned or
rented by the hour. A day to build the render rig. Several days of prompt
and LoRA iteration before the first usable asset. A human approval gate on
every asset forever ([K6]), which is the step that gets skipped at 2am and
is the step that holds the whole thing together. And a permanent per-object
cost from then on: every new object needs a generation run and a look,
where every other option on this list makes new objects free.

**The blocking dependencies.** [T10], choose an AI image tool, and [T13],
approve the style bible, both have to resolve first, and both are Tim's.
Practically the affordable route is open-weight models run locally rather
than a per-image service, but licence terms on the current generation of
open-weight models change often enough that they need checking at the
moment of the decision rather than trusting a claim in a document written
in August 2026.

**Risks.** This is the option most likely to stall, and stalling on art is
[R4] and [R6] arriving together. Characters stay fenced off under
[AI-X1], so sims still come from Quaternius or a commission, and there is
a real chance that painted props next to an unpainted character look worse
than either would alone. Purely AI-generated work is also not copyrightable
in the US, which matters only if ownership ever needs enforcing but should
be a decision rather than a discovery.

**In my opinion:** this is the right destination if the game finds players
and the painting becomes worth the hours, and the wrong place to spend the
first month. It is the only option that cannot be undone cheaply, because
once the catalogue is painted, every future object has to be painted to
match.

---

## What I would do

Split the decision, because the codebase already splits it.

**Pick an interface fiction now.** [DL-casefile] or [DL-broadcast] are
each under a week, need no purchase, no account, no palette approval and no
image processing, and either can be deleted if it is wrong. Between them I
would take [DL-casefile], on one argument: it does real work on [T22],
which is the only thing standing between this project and a finished alpha,
and it does that work by constraining the writing rather than by demanding
more of it.

**Defer the world treatment** until the cross-platform atlas post-pass in
[DL-prereqs] exists, because every world option needs it and none of them
can be evaluated without seeing a real screenshot. Build the pass, run
[DL-triplicate] and [DL-riso] through it on the existing 48 sprites, and
look at both. That is a day of work that turns a taste argument into two
pictures, and this project has already learned the hard way ([L14], [A-5])
that visual questions answered without a composited frame get answered
wrong.

**Of the two world options, my preference is [DL-triplicate]**, for the
reason under its sims paragraph rather than for how it looks. Every other
direction on this list eventually has to solve characters, and [O6] says
characters are the hard part and the one line item worth paying for. A
drafting figure is a legitimate finished style, not a placeholder, so that
direction is the only one where the hardest and most expensive remaining
art problem simply does not arise.

[DL-gouache] is a destination, not a starting point, and I would not open
[T10] on its account yet.
