# Sim hairstyle direction

On 2026-09-07, the owner selected concept 1, **small front curl**, as the
current Blender modeling target. They want all four concepts available as
hairstyle choices in a future Sim creator, but only concept 1 is in scope now.

## Retained concept directions

1. [Small front curl](../assets/sim-hairstyles/01-small-front-curl.png): current
   target. A broad rolled front, smaller side sweep and short tapered curl.
2. [Soft front wave](../assets/sim-hairstyles/02-soft-front-wave.png): future
   hairstyle option, not yet modeled.
3. [Short tousled crop](../assets/sim-hairstyles/03-short-tousled.png): future
   hairstyle option, not yet modeled.
4. [Lifted quiff](../assets/sim-hairstyles/04-lifted-quiff.png): future hairstyle
   option, not yet modeled.

These are generated illustrations, not finished 3D models. Their selection
establishes visual direction; it does not prove hidden geometry, four-facing
consistency, animation quality or in-game readability. The source prompts and
generation records are retained in
`.tmp/sim-blender-preview-20260906/owner-review-pending/sim-01/hair-concepts-01/`.

## Current modeling boundary

Approximate the selected silhouette and volume with broad sculptable shapes.
The owner explicitly permits a close match rather than an identical
reconstruction. Preserve the preferred original face and existing collar
correction unless separately directed. Keep the hair as a distinct named asset
so later styles can replace it without rebuilding the character body.

The first four-rotation model checkpoint was approved by the owner on
2026-09-09. Rigging and animation of this accepted Sim are now authorized.
A Sim-creator UI, hairstyle switching in the game, and implementation of other
hairstyles remain future work.

## Current proof status

The selected design remains unchanged. Attempts 10 through 13 have not reached
it: three swept-volume drafts failed, then one connected-cage trial following
fresh-context review also failed visual review. Mechanical closure improved;
the broad roll, outward side wave and small curl still did not read correctly.
The local modeling track is paused, not declared successful.

Evidence is retained under the Sim's `owner-review-pending/sim-01/rejected/`
folder in the preview workspace. The owner authorized a hair-only Tripo
experiment capped at USD 2, still within the original USD 10 total test ceiling,
on 2026-09-07 and resumed it on 2026-09-09. It is not a proven fix. Its records
are in `.tmp/sim-tripo-hair-20260909/`. The existing body and offline
Blender-to-sprite direction remain intact. No foreground desktop interaction
is authorized without asking first.

The hair-only image reference was prepared. Before any paid submission, the
2026-09-09 renderer preflight hit a Windows `Access is denied` error launching
the protected Blender executable. No task had been submitted and no credits
had been charged at that checkpoint. The owner subsequently authorized a direct
retry and the background Store launcher. The direct retry remained blocked;
the Store launcher executed a script that confirmed Blender 4.5.13 LTS with
`bpy.app.background` true. The launch blocker is resolved without permission
changes or foreground control.

The subsequent single Tripo `v3.1-20260211` task completed for USD 0.60. Its
original GLB, request, charge reconciliation, scripts and inspection images are
retained in the experiment directory. `fit-01` fits that hair to the retained
body and existing hair shader; all four actual model rotations were rendered.
Both visual reviewers approved showing it as an early direction checkpoint.
The owner then approved the result without requesting changes: "Perfection,
love it, ship it." The thicker opposite-side fringe, pronounced rear ridges and
curl's proximity to the far eyebrow were disclosed before approval. Retain this
approved appearance instead of reopening those design choices during rigging.

The one current owner-review set is
`.tmp/sim-blender-preview-20260906/owner-review-pending/sim-01/tripo-hair-01/`.
Its comparison and four-facing study are the accepted source checkpoint.
Earlier rejected drafts are not additional approval candidates.

## Authorized animation stage

1. Rig the accepted master at
   `.tmp/sim-tripo-hair-20260909/fit-01/sim-hair-candidate.blend` locally. Keep
   the approved neutral appearance, body proportions, face, hair and clothing.
   Use one reusable skeleton and named actions, not new models for each frame.
2. Prove the rig with actual limb motion in walking and a seated-reading stress
   pose. Inspect all four physical facings and the reduced-size output. A
   moved but undeformed body is not a walk cycle.
3. Continue with the existing game actions and deterministic 2D sprite export.
   The game remains a 2D atlas renderer. Animation and runtime acceptance still
   require their own evidence; static-model approval does not establish them.
4. The same accepted model may represent every Sim temporarily while testing.
   Keep old sprite records stable and permit later replacement through the
   appearance mapping rather than modifying unrelated legacy art.
5. Keep hair, shirt and pants as distinct assets/material regions suitable for
   independent recoloring. A recoloring UI and additional clothing styles are
   deferred, not removed from the requirements.
6. After this Sim's animation work, the owner plans to request ten new numbered
   hairstyle concepts and select four distinct styles and colors. These should
   make Sims easy to distinguish from the elevated game camera. Do not generate
   that concept batch until requested.

No additional paid generation is needed for this local rigging stage. The
existing USD 0.60 test charge remains the only paid call in this experiment.
Background Blender is authorized; foreground desktop control still requires
separate permission.

## Integration preflight

At the start of this stage, the canonical checkout was on `main`, 24 commits
behind the saved `origin/main` reference, with existing uncommitted changes to
`assets/sprites/gen/chars.py`. The baseline command
`python -B assets/sprites/gen/build.py --check` failed before implementation:
`decoded pixels changed outside the two intentional object replacements`.
Preserve those changes. Do not bless that failure by changing pixel goldens.
The owner explicitly delegated routine workspace management on 2026-09-09.
The implementation now runs in
`D:/VIBES/.worktrees/terrilives/rigged-sim-animation`, branch
`twcx/rigged-sim-animation`, based on fetched `origin/main` at `3cf9941`.
Its unmodified baseline passed: 360 sprites in a 512 by 3315 atlas. The
original checkout and its edits remain untouched. Do not reopen the workspace
permission question during this task.

The accepted master is now retained at
`assets/models/sims/sim-01/source/approved-neutral.blend`, with the original
hair GLB and approved concept alongside it. The master SHA-256 is
`a90fd5be6c2c60b89216d4881b9f4265a45fb662d913299daa12cc3b247d9ece`.
See [the animation implementation contract](2026-09-09-rigged-sim-animation.md)
for current export and acceptance boundaries.
