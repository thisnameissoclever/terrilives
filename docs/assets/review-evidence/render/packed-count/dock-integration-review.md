# Scoped integration review

Ready to merge the combined branch at `29f12e993b6963ab532ff9a134d63b3085733ff7`. No Critical, Important or Minor integration findings.

## Scope

Reviewed the integration package `review-acf24307..29f12e99.diff`, concentrating on the production changes from separately shipped PR 189 and their interaction with the approved renderer work. Read the appended worker integration report and verification record. This is not another whole-branch review or a new acceptance review of PR 189. The earlier renderer verdict and constraints remain in force.

No source or Git state changed, no browser was controlled, and no passing suite was rerun. This report is the only write. The project writing skills were applied to preserve exact claims and evidence limits.

## Integration checks

1. The diff from `acf24307` to the combined head contains no changes to `frame.ts` or either batch-contract test file. The renderer implementation was not re-reviewed. Main's integration diff contains only the upstream activity-summary simplification and household-dialog focus restoration.
2. Comparing combined main.ts with shipped `70f56b6e` shows exactly the approved renderer import/packing/draw changes and floor-controls callback. `web/src/main.ts:630` retains the compact-layout notification, line 1336 retains initial state, line 1566 builds the batch, and lines 1593-1594 draw its array/count. Neither upstream main change touches those paths.
3. The dock markup retains the existing mood and satisfaction element IDs while moving them into the dock header. The summary now shows activity without duplicating the separately visible mood. Household creation retains its ID in Options, with focus restoration on close. None changes the builder's selected entity, preview, floor highlight or GPU count.
4. Dock CSS additions remain scoped to the dock and related controls. The existing Build-mode hiding at `web/src/ui/compact-hud.ts:85` remains intact; the new wellbeing header does not cover the builder dock while editing. The compact breakpoint is unchanged. Root's combined mobile screenshot independently viewed during this review shows the selected cyan floor marker, readable touch instructions and reachable floor controls.
5. Current main.ts SHA-256 matches the integration record: `fc3551b77dc8091c33bd29432853a87ae10aeb0186e3caf217acd251a383a45d`. The record identifies combined production bundle `index-CvnfsN4A.js` and its hash, rather than attributing the earlier browser result to the new build.

## Evidence assessment

The worker records the focused integration command with `--maxWorkers=1`, exit 0, five files and 76 tests passing. Typecheck, production build, documentation IDs and whitespace checks also exited 0. These are recorded results, not checks rerun by this reviewer. The earlier full-suite result is not relabeled as a new combined full-suite run.

Root's combined production record reports desktop and mobile dynamic uploads increasing from 45 to 46 rows, opaque draws from 394 to 395, and correct desktop/phone/desktop help transitions. Mobile movement used 48 dynamic rows, Cancel restored 45, and a fresh 3159-byte save remained identical before, during and after. The first Escape script exited Build through existing behavior; the corrected script checks only while Build is active. No production code was changed to satisfy that mistaken script. Root records closing the owned page and server.

## Findings

Critical: none. Important: none. Minor: none. No integration repair is required.

## Declined to judge

1. PR 189's complete standalone feature acceptance: already shipped and independently reviewed; this assignment covers its integration with the renderer slice.
2. Audio-memory holds on PR 184 and PR 178: unchanged and not tested by renderer integration.
3. Subjective door audio or physical-speaker acceptance: no listening session and no sound implementation changes in this integration.
4. Measured frame-time, allocation-profile or 120Hz performance: no timing or profiling evidence was produced here.
5. Full world/object visual acceptance and standing sleep poses: the combined builder evidence does not establish complete gameplay acceptance.
6. Physical mobile devices and every browser/GPU combination: viewport evidence remains Chromium evidence.
7. Remote CI, the full remote mutation sweep and deployed combined behavior: separate delivery evidence, not certified here.
8. Retaining a batch across a later build: still outside the explicit borrowed-storage contract; integration does not change the synchronous consumer.

## Assessment

**Ready to merge? Yes.** The upstream dock changes and approved renderer changes survive together without a conflicting state owner or altered draw path. The focused tests and combined production evidence address the specific integration risk. No unmet reasonable-user expectation was identified within this scope.

**Next steps**: Root can update PR 191 and complete the authorized delivery, reporting remote checks and deployment separately.
