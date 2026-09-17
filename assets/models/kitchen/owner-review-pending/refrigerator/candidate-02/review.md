# Refrigerator candidate 02

Status: ready for owner appearance review. Not owner approved or integrated.
Reviewed 2026-09-17 by the primary reviewer and a fresh independent reviewer.

## Source and method

1. Tool: Blender 4.5.14 LTS, hidden background rendering. No paid generation.
2. Model: one editable refrigerator with four actual rotations. Materials,
   camera and lights derive from the accepted Sim scene; the original scene
   on disk is unchanged. The grey case, brass handles and upper freezer retain
   the current refrigerator's identity.
3. Prompt: not applicable. These are deterministic authored-model renders,
   not image-model generations. `proof.json` identifies exact source hashes,
   settings, orientation angles, model hash and the four output hashes.
4. Original outputs: `closed-SE.png`, `closed-SW.png`, `closed-NW.png`,
   `closed-NE.png`, each 768x960 RGBA. `four-facing-review.png` is only a
   labelled layout and resampling of those originals, without retouching.

## Review

Both reviewers inspected all four originals and the smaller review samples.
Subjective visual correctness: 90/100. This is an appearance rating, not a
probability, test-coverage percentage or approval of unseen motion.

1. The upper freezer now reads as shut. Candidate 01's dark top gap is fixed.
2. Rear vents are individually legible at the proposed 2x texture size.
3. Door thickness, handle side, rear panel and proportions remain consistent
   through all four facings. No visible impossible joints, floating attachments
   or torn outlines were found.
4. Minor remaining polish: the lowest rear vent is close to the service panel's
   lower border. It does not block an appearance decision.
5. Palette, line weight and shading fit the accepted furniture and Sims.

Closed views do not prove animated hinge clearance, collision-free opening,
Sim hand contact, runtime placement or played scale. Hinge transforms were
checked at 0, 45 and 90 degrees, but no finished door animation is claimed.

## Permitted next action

Present this complete four-view set for owner approval. Keep candidate 01
and its rejection reasons. Do not replace runtime sprites until approval,
registration and played validation. Other objects may proceed independently.
