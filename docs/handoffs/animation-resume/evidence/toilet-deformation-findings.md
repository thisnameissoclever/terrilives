# Indexed toilet clothing diagnostic, 2026-10-05

The retained rejected central pose remains unchanged. This diagnostic does
not accept the pose or authorize a clothing or fixture correction.

1. Each trouser mesh preserves its 168 original vertex indices immediately
   after the linear armature modifier and before subdivision.
2. Independent weighted bone transforms agree with Blender at every indexed
   vertex. Maximum error is `8.429369702178807e-08` metres on each leg.
3. Before subdivision, the left/right meshes already have 88/84 intersecting
   triangle pairs with the open seat ring. After subdivision, each has 128.
   Triangle-pair counts depend on mesh resolution; they are not penetration
   depths or directly comparable measures of severity.
4. The diagnosis therefore does not support blaming subdivision alone or an
   incorrect linear-transform calculation. The authored pose, rest geometry
   and weights still require a supported fit. Correct arithmetic does not
   establish anatomical correctness.
5. All recorded input hashes, the rejected pose and modifier settings remain
   unchanged. The diagnostic wrote no editable model or beauty images.
6. Six independent arithmetic tests showed the expected missing-helper red,
   then passed. The hidden two-thread source writer reached `complete` and
   no matching owned Blender process remained. Launcher exit zero was
   observed; the detached Blender process exit code was not observed.

Receipt: `assets/models/bathroom/actions/review/toilet/deformation-01/proof.json`.
Producer: `assets/models/bathroom/actions/toilet_deformation_probe.py`.

**Next steps**: Evaluate support and limb clearance together on actual surfaces.
Do not switch skinning modes or remove subdivision as a presumed repair.

## Bounded support follow-up

The support-only diagnostic in `review/toilet/support-search-01/proof.json`
tested central hip Y positions `-.12`, `-.16`, `-.20` and pelvic pitches
`-20`, `-10`, `0`, `10`, `20` degrees. It used every minimal sampled rectangle
meeting the unchanged finite support criteria and compatible height intervals.
All fifteen cases returned zero candidates. This is evidence about this
declared sampled range, not proof that every continuous pose is impossible.
No image or complete body pose was accepted. Input hashes remain unchanged;
both diagnostics retain independently hash-checked source snapshots.

## Actual curved contact and central candidate

The independent reviewer identified rectangle containment as a sufficient
construction rather than a necessary contact shape. Corner-ray cell unions
were diagnostic only. Root then partitioned the actual captured body/seat
triangle projections and bounded the affine gap over every partition.
Both mirrored candidate regions certify complete cell interiors: 79 cells at
Y=-.16/pitch 0 give `0.000710999999999916` m²; 109 cells at Y=-.20/pitch -10
give `0.000980999999999815` m². Gap, area and span limits remain unchanged.
Full-edge connectivity excludes corner-only groups. Arithmetic area equality
uses `1e-12` m²; positive-area pieces are never dropped from gap checks.

Nine pure geometry tests pass, including an interior peak with good corners,
missing surface coverage, duplicate surfaces, corner-only connectivity and a
tiny out-of-range surface. The last case first failed, then passed after
removing positive-area suppression. Earlier math source is retained with the
leg diagnostic; the hardening did not change the actual 79/109 certificates.

The sole-derived 16.4-degree leg plan still crosses the ring. The bounded
24-degree plan clears every body/fixture pair but initially crosses the hands
with the raised thighs. Whole-hand lift is now derived from measured clothing
clearance, with the arm lengths solved independently and a five-centimetre
gesture limit. The resulting prototype-08-curved-support passes full body,
hand, bone, sole, curved contact and saved-source replay gates. Root inspected
all four originals; independent review remains pending. Raised heels are a
visible limitation requiring that review, not a flat-footed contact claim.

There is still no accepted animation loop, atlas import, runtime change or
publication for toilet use. The old rectangle-only failure stays in the
receipt as a separately named diagnostic; it is not reported as a pass.
