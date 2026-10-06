## Seated media and ottoman sitting

Housemates watching television or listening to the radio choose an available,
reachable seat inside a seven-tile forward viewing cone. Their interaction
remains owned by the device; the supporting seat is reserved separately.
Standing, facing the device, is the fallback when no suitable seat exists.

Neutral seated loops fit dining chairs, desk chairs, reading chairs, long
sofas and ottomans. Existing fitted armchair Sit art remains in use. Ordinary
ottoman sitting now selects its fitted body as well.

All previous 2,515 sprite records, decoded pixels and existing registration,
reading, dining and covered-bed metadata remain unchanged. New source and
graphics evidence are in `docs/assets/review-evidence/seating/media-2026-10-05.md`.

## Verification

1. Local native workspace, focused seating, web, typecheck, lint, formatting,
   fresh WebAssembly, production build, changelog and document checks passed.
2. Source/export checks passed. All 240 source scenes pass unchanged six/two
   comparison limits. All 240 full-frame, texel-aligned graphics cases differ
   by at most one colour level, with zero 95th-percentile error.
3. Staged-only atlas verification succeeded without ignored originals.
   Independent code, exporter and visual reviews accepted the batch.
4. Four native negative controls and eleven exporter controls detected their
   intended failures. These are not a full remote mutation sweep.
5. A task-owned played house showed Tim seated on the ottoman while Watching TV;
   save/load and visible picking regressions cover the production paths.

Remote checks are additional evidence and may still be pending at merge under
the owner's explicit local-verification delivery policy. Public deployment is
verified separately. Bath, shower, toilet and Lie down are subsequent work.

## Changelog checklist

- [x] Reviewed all player-facing changes in this delivery.
- [x] Extended `docs/changelog/2026-10-05-covered-bunks.md` for the delivery date.
- [x] Preserved the published filename and earlier same-day notes.
- [x] Ran changelog tests and build.
- [x] Kept developer evidence outside the public notes.
