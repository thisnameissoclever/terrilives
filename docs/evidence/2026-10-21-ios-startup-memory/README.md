# Startup upload pacing

The owner supplied an iPhone Safari screenshot showing a repeated page failure
while opening Natural Causes. The device model, iOS version and crash phase
were unavailable. No affected iPhone was available for this investigation.

## Patch and proof boundary

The loader previously issued sprite page uploads without explicitly waiting
for earlier uploads to finish. The patch awaits graphics queue completion
after each sprite, grime and fixture companion upload. Bitmap closure and
partial texture cleanup retain their existing failure paths. Compressed
download prefetch remains four pages.

This establishes upload ordering. It does not establish physical driver memory
reclamation or repair of the reported Safari termination. The complete atlas
still allocates 880 MiB, and the phone-sized scene requests additional textures.
The large retained allocation remains a concern requiring a separate storage
design or device evidence.

## Chrome comparison

[comparison-01/report.json](comparison-01/report.json) records the source file
hashes, requested texture dimensions, upload counts, saved household and color,
depth and selection-identity attachment hashes. The browser viewport was
393 by 852 layout pixels with three device pixels per layout pixel. Reduced
motion was enabled and the simulation was paused for image comparison.
Saved household bytes are retained in base64 text, which preserves every byte
while keeping the report readable.

The verifier removes only the new completion waits from responses served to
its own baseline browser context. It never changes source served to another
task. The baseline issued 43 sprite and grime image copies before its next
explicit completion wait. The patched run issued at most one between waits.
These counts measure issued work between waits, rather than concurrent driver
allocations.

Both runs restored the same saved household through the normal prepared-load
boundary. Each run produced identical repeated attachment hashes. Color,
depth and selection identity were also identical across the two conditions.
Startup took 7,137 milliseconds in the baseline and 7,145 milliseconds with
the patch. This single local pair is evidence against a large local delay;
it does not characterize phone performance.

Run the comparison with `node scripts/verify-startup-upload-pacing.cjs` while
the isolated development server serves port 5174. Set `UPLOAD_RUN` to a new
label to preserve earlier evidence. Set `UPLOAD_VIEWPORT=desktop` for the
desktop case. The verifier requires Playwright and installed Chrome. Set
`PLAYWRIGHT_MODULE` to an installed Playwright module when it cannot be resolved
from the project or the bundled dependency runtime. The script closes its
browser in a finally block and records whether that cleanup ran.

## Visual inspection

The implementing assistant inspected `comparison-01/phone-2.png`. The game,
household, furniture and controls were visible. A fresh reviewer inspected
`comparison-01/phone-1.png` and `comparison-01/phone-2.png` before seeing the
condition mapping. The reviewer found no missing artwork, obstruction or
change in framing or quality. The reviewer rejected the owner's original
Safari screenshot as a failed loading outcome. The Chrome captures cannot
establish that the Safari failure has been repaired.

The desktop comparison in [desktop-01/report.json](desktop-01/report.json)
also produced identical repeated color, depth and selection output in both
conditions. Its viewport was 1440 by 900 layout pixels at device pixel ratio
one. The implementing assistant inspected `desktop-01/desktop-2.png`: the
house, furniture, people and controls were visible. The independent reviewer
inspected both desktop captures and found no missing artwork or change in
framing or quality. The bottom controls overlapped the outer lawn slightly
in both images and left the house unobstructed.

## Regression checks

`web/tests/atlas-upload-lifetime.test.ts` holds queue completion unresolved and
checks that the loader waits, keeps a bitmap open and avoids advancing to the
next page. Rejection checks exercise bitmap closure and partial texture cleanup.
Removing the completion waits makes the sprite, grime and companion cases fail.

The comparison preserves rendering resolution, sampler behavior, authored
assets, saves and gameplay controls. No player-guide article changes are needed
because no player procedure or gameplay rule changes. No public release note
claims an iPhone repair while original-device acceptance remains unavailable.
The compiled player reference is unchanged. Its source review record updates
only the three graphics files containing the new completion waits.
