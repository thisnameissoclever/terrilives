# Neutral seated animation sources

This workflow fits the approved shared Sim to the accepted dining chair, office
chair, long sofa, ottoman and reading chair. Armchair media use retains its
existing fitted Sit export. Preserve furniture geometry, camera registration,
standing Sim meshes, palette assignments and anatomical bone lengths.

## Authoring and export

1. Read `pose_profiles.py` for each immutable furniture input and measured pose.
2. Run `render_neutral_seats.py` through the approved background Blender launcher.
3. Retain the complete source receipt, contact checks, editable models and original renders.
4. Run `render_neutral_ink.py` to capture visible body-owned ink independently.
5. Run `export_neutral_seats.py` after the writer exits.
6. Validate the export through `seat_export_contract.py` and `offline_seating.py`.
7. Add the reviewed export to the append-only atlas and architecture extension catalogues.

Each export binds the exact dependency inventory and source receipts. The
loader replays original visible contributions and comparison evidence; it
does not accept a claimed score as proof. Support coordinates must be finite
and ordered. Counts must be nonnegative integers. Use distinct test images
and masks for body, furniture, shared ink and body-owned ink.

For a new source batch, run these commands from the worktree root. Use unique
output directories. Do not replace a reviewed receipt.

```powershell
$seatBlender = 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe'
$seatRoot = (Get-Location).Path
Start-Process -FilePath $seatBlender -WindowStyle Hidden -ArgumentList @('--background', '--threads', '2', '--python-exit-code', '1', '--python', "$seatRoot/assets/models/seating/render_neutral_seats.py", '--', "$seatRoot/assets/models/seating/review/batch-next")
```

Wait for the owned writer to exit. Require the source receipt's `state` to be
`complete`. Then run the ink producer with the source receipt and a new output
directory after the `--` separator. Wait for that writer to exit and verify
its complete receipt before exporting.

```powershell
Start-Process -FilePath $seatBlender -WindowStyle Hidden -ArgumentList @('--background', '--threads', '2', '--python-exit-code', '1', '--python', "$seatRoot/assets/models/seating/render_neutral_ink.py", '--', "$seatRoot/assets/models/seating/review/batch-next/proof.json", "$seatRoot/assets/models/seating/review/ink-next")
```

After the owned ink writer exits and its complete receipt passes validation,
run the exporter.

```powershell
python assets/models/seating/export_neutral_seats.py assets/models/seating/review/batch-next/proof.json assets/models/seating/review/ink-next/proof.json assets/models/seating/export/neutral-next --writer-exited
```

The exporter flag records the checked writer exit; it is not a way to bypass
an incomplete render. A failed export has no importable manifest. Retain its
diagnostics and start a new output directory after addressing the failure.

The production representation stores scene-linear, premultiplied visible
contributions. Fills already include shared-outline attenuation. Add furniture,
body and outline exactly once. Scene aliases share the furniture texture
registration but use separate action profiles and picking masks.

## Review boundaries

Source-art fidelity compares the stored contributions with independently
filtered original full-scene beauty. The graphics check independently renders
decoded layer bytes using the production opacity discard and background
composition, then compares complete frame readback. These gates answer
different questions. Their errors do not establish a combined error bound
against original beauty after opacity discard.

The numerical graphics check uses texel-aligned scale two. Fractional zoom
still needs visual and picking review; a successful smoke check is not a
numerical filtering guarantee. Submit the framebuffer copy before awaiting
mapping. Reject clipped reference canvases and non-finite measurements.

See the dated [media seating evidence](../../../docs/assets/review-evidence/seating/media-2026-10-05.md)
for accepted source pins, measured fit limits and runtime proof.
