# Shower presentation checks, 2026-10-05

The shower source art and atlas are not accepted or published. These results
cover only the native presentation metadata and projection changes.

1. `cargo test -p terri-data the_shipped_shower -j 2`: expected red because
   shipped shower metadata had no fitted visual.
2. `cargo test -p terri-data shower_visual_accepts -j 2`: expected red because
   the compiler rejected the unknown shower action. An earlier malformed test
   fixture did not compile; correcting that fixture established the proper red.
3. `cargo test -p terri-sim shower_projection -j 2`: expected red, action 0
   rather than 14. After implementation, all facing and exit checks passed.
4. `cargo test --workspace -j 2`: failed four stale shower expectations. The
   reviewed correction changes their expected pose to SHOWER. The fixture
   testing absent presentation metadata now clears visual and activity.
5. `cargo test --workspace -j 2 --quiet`: exit 0; 126 core, 283 data, one
   bathroom-layout integration, 934 simulation and 171 browser-boundary tests
   passed. Native save/load and sound tests remain included in those suites.
6. Independent native review found no runtime or save-contract blocker after
   identifying the stale fixture expectations. The compiler permits any
   declared socket; the shipped shower declares tray at the fixture origin.

Source motion, exported layers, original-beauty comparison, browser graphics,
picking, played lifecycle and publication remain unverified for this batch.

## Deferred source-dependent implementation

Primary inspection also rejected prototype 10's flat cloud as a sack. No
shower art or native presentation was published. The tested native changes
are retained in scoped stash `fa65db11465a2a1ef2e98bf9a43ef85f79fc4dc3`.
It contains only the owned shower content/data/simulation edits and new
projection test. Source diagnostics, output, lessons and unrelated untracked
files were excluded. Restore and reconcile that patch only after accepted
shower art exists; a bath release may have appended another compiled action.
