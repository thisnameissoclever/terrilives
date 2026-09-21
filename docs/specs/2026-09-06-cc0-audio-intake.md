# CC0 audio intake

Status: exact pack approval is pending. No third-party audio has been accepted,
copied into the game, or added to repository history.

## Decision

Terrilives should use a small, reviewed library of real recordings where a
procedural oscillator cannot communicate the material or action convincingly.
The initial candidates are four compact CC0 packs from OpenGameArt. They cover
common household interactions without adding a runtime audio dependency or
committing an entire unreviewed archive.

Approval to fetch these archives is not approval to ship every file. Each sound
still needs source inspection, listening review, editing, in-game mixing, and a
specific semantic event before it can enter the public repository.

## Exact approval set

| ID | Pack and author | Approximate size | Likely coverage | Source |
| --- | --- | ---: | --- | --- |
| `owlish-202-more-sfx` | 202 More Sound Effects, OwlishMedia | 14.9 MB | Cloth, drinking, doors, kitchen, paper, office | [Page](https://opengameart.org/content/202-more-sound-effects), [ZIP](https://opengameart.org/sites/default/files/MoreSounds.zip) |
| `rubberduck-100-sfx` | 100 CC0 SFX, rubberduck | 2.9 MB | Dishes, doors, microwave, pots, toilet, water | [Page](https://opengameart.org/content/100-cc0-sfx), [ZIP](https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip) |
| `rubberduck-100-sfx-2` | 100 CC0 SFX #2, rubberduck | 2.4 MB | Footsteps, doors, switches, water, room ambience | [Page](https://opengameart.org/content/100-cc0-sfx-2), [ZIP](https://opengameart.org/sites/default/files/sfx_100_v2.zip) |
| `rubberduck-30-sfx-loops` | 30 CC0 SFX Loops, rubberduck | 3.5 MB | Machines, rain, boiling water, pumps, ambience | [Page](https://opengameart.org/content/30-cc0-sfx-loops), [ZIP](https://opengameart.org/sites/default/files/sfx_loops.zip) |

The approximate combined download is 23.7 MB. Every candidate declares CC0
1.0 on its source page. The 142.4 MB OwlishMedia pack is deliberately deferred;
the compact packs should be searched and auditioned first.

## Guarded fetch tool

`scripts/fetch-cc0-audio.cjs` uses Node's built-in HTTPS-capable `fetch`. It
adds no dependency and performs no network request when listing candidates:

```powershell
node scripts/fetch-cc0-audio.cjs --list
```

A fetch requires all of the following:

1. The owner has approved the exact pack IDs in this document.
2. The invocation includes `--owner-approved-cc0-downloads`.
3. Every selected ID is present exactly once in the fixed manifest.
4. Every page and archive uses HTTPS on `opengameart.org`.
5. The output path does not exist, its parent exists, and its resolved location
   is outside the repository.
6. No fixed archive name or partial archive already exists.

After approval, the complete four-pack command is:

```powershell
node scripts/fetch-cc0-audio.cjs `
  --owner-approved-cc0-downloads `
  --download owlish-202-more-sfx `
  --download rubberduck-100-sfx `
  --download rubberduck-100-sfx-2 `
  --download rubberduck-30-sfx-loops
```

The default destination is a uniquely named operating-system temporary
directory. `--output <new-path>` may select another intake location outside the
repository; the path itself must not already exist. The tool revalidates the
final response host after redirects, caps each response at 32 MiB, checks its
content type and ZIP signature, and uses exclusive publication so it cannot
replace an existing file.

`intake-manifest.json` exists before the first request. It records the requested
pack IDs, progress, original metadata, final response URL, byte length,
retrieval time, and SHA-256 digest. If a later pack fails, the manifest changes
to `failed`, names that pack and error, and retains the provenance records for
earlier completed archives. Archives are intake material, not game assets, and
the tool never extracts or commits them.

## Selection workflow

After an approved fetch:

1. Confirm each archive digest and inspect its entries without extracting
   paths outside an intake directory.
2. Recheck the source page, author, and CC0 declaration. A listing in this
   document is not a substitute for intake-time provenance.
3. Search by action and material, then audition plausible files in isolation.
4. Reject clips with voices, music, room contamination, clipping, unexplained
   impacts, or a licence that cannot be established for that exact file.
5. Copy only selected clips into a named source-audio workspace. Preserve the
   unedited original beside any trimmed, filtered, or normalized derivative.
6. Record the exact pack, source page, archive hash, archive entry, edits, and
   accepted runtime path in `ASSETS.md` before committing audio.
7. Map the clip to a semantic game event and mix it against isolated, normal,
   and busiest legal playback states.
8. Require human listening before merging a replacement for an accepted cue.

## Architecture boundary

The current authored actions safely identify footsteps, conversation, sleep,
eating, reading, and exercise. They do not identify which appliance or fixture
caused a generic interaction. Refrigerator, stove, sink, toilet, shower,
aquarium, television, and door audio must wait for an authored semantic sound
action plus stable source-object identity. File availability is not permission
to infer object state from animation labels.

The likely first use of these packs is therefore replacement material for
already semantic personal cues, followed by kitchen and bathroom sounds after
the source-object contract exists. Nonverbal Sim voices remain a separate
recording problem; the compact packs are not expected to solve them.
