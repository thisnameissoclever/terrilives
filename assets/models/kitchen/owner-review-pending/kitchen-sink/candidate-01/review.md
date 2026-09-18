# Kitchen sink candidate 01

Accepted for static integration by primary and adversarial review on
2026-09-17 under the owner's delegated review policy. Subjective correctness:
90/100. This does not claim personal owner approval.

All four originals and the review board were inspected against the accepted
stove and refrigerator. The sink shares the counter cabinet and Z=0.86 worktop.
The worktop has a physical opening, with a recessed steel basin, attached
faucet, lever and drain. Saved-model ray tests verify the opening and Z=0.63
basin floor; the actual faucet tip drains into the bowl. Contact checks verify
the faucet start inside its mounting flange and the cabinet handle mounts.

The initial four deliberately broken copies in memory were rejected: capped
opening, flattened basin, displaced faucet and detached handle. Adversarial
review then found that bounding-box overlap could miss a floating drain.
scene-probes-drain-red.json retains that failed regression check. The checker
now traces the actual support surface for the drain and both faucet bases.
scene-probes-contact-green.json records all seven intended corruptions caught,
the clean model passing afterward and its original hash unchanged. The retained
contact-error result records a checker tuple-access bug fixed before that pass.

Minor retained limitations: the drain projects close to the front rim in all
four views, and the bowl shading has broad planar transitions. Independent review
found neither a blocking geometry or style defect. No water, dishwashing or
hand-contact animation is claimed. Runtime placement, picking and existing
wash-up behavior need separate evidence. Preserve the originals and proof.
