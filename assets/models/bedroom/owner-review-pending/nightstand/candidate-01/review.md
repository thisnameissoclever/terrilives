# Nightstand candidate 01: rejected

Rejection code: DETACHED_PARTS. No visual acceptance or runtime integration.

The pre-integration attachment test found a 0.0015-unit gap between each
drawer front and the case. Inspection of the part dimensions also found a
0.0015-unit gap between the book spine and its pages. These parts must contact
their supports even when a gap is too small to notice in the game sprite.

All four original renders, proof and saved model are retained. The changed
layout source is preserved here as `storage_layout.py`; the other hashed
sources remain unchanged. Candidate 02 moves fronts inward by 0.006 and
widens/repositions the book spine to create real overlap before beveling.

The binary contact test failed before correction. The saved-scene check must
also find interior contact witnesses after beveling. Overall correctness is
not scored from this mechanical rejection alone.
