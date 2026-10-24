# Startup report sharing

The player can copy saved startup details or open a draft to bugreport@stfuai.com. The subject uses the recorded game version, with an explicitly identified current-page fallback for older records. The draft body contains the same complete report as copying and downloading. This change does not identify or repair the original reported iPhone crash.

## Functional evidence

`verification.json` records the compiled browser checks: a deliberately injected persistent 503, a deliberately terminated task-owned renderer, and ordinary startup through advancing simulation time. Copying uses an isolated test clipboard. The decoded email link is compared with the copied report, including its exact recipient and versioned subject. The native mail application is never opened and no email is sent.

`guide-verification.json` records desktop and phone reading in both themes, image enlargement, zoom, Fit, Escape, focus return, search and reading with JavaScript disabled. The selected screenshots show the actual compiled interfaces. `source.json` identifies the inspected source and output hashes. These captures precede the final delivery commit; final clean-commit execution and independent review records are retained in ignored local verification storage and summarized in the pull request.

## Verification selection and limits

The complete change affects the early recorder, failure controls, generated report HTML, publication path routing, verification tooling and player documentation. Run documentation IDs, workflow/script contracts, site generation and reference checks, focused recorder/failure/version tests, TypeScript checking, JavaScript syntax checks, the production build and the compiled browser scenarios. The Rust simulation, WebAssembly source, dependency locks and artwork are unchanged; their unrelated test catalogs are excluded.

Physical iPhone execution and native mail-client delivery remain unobserved. The browser proof establishes that the generated link contains the full draft; a configured mail client controls whether it accepts that body. Copy and download remain available. Deliberate crash and HTTP injection establish report behavior, not the cause of the user's failure. No local verification manifest or plan/check/exception commands exist in this revision; use the existing local check runner for its relevant groups and retain the additional actual command results beside it.
