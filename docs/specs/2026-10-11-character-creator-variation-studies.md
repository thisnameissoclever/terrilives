# Character appearance studies

These static concepts illustrate different appearance selections and proposed slider endpoints in the chosen cartoon style. They are not output from working sliders or proof of modeled geometry. The owner reviews them before implementation.

1. [Masculine study](../assets/character-creator-proposal/06-masculine-variation-study.png): M1 Rowan, M2 Kiran, M3 Arthur.
2. [Feminine study](../assets/character-creator-proposal/07-feminine-variation-study.png): F1 Mira, F2 Avery, F3 Amara.
3. [Revised personality screen](../assets/character-creator-proposal/08-personality-without-summary.png): Randomize label, retained field locks, and no behavioral text beneath the character.

## Shape targets

All numbers use the proposed relative 0-100 scale. Height runs shorter to taller; Build runs leaner to fuller; Shoulders and Hips run narrower to wider. Zero is the lower intended endpoint, not an absent body part. Exact dimensions and safe combinations require model, clothing, and animation tests.

| Character | Presentation | Height | Build | Shoulders | Hips | Face |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| M1 Rowan | Masculine | 50 | 50 | 50 | 50 | Oval |
| M2 Kiran | Masculine | 100 | 0 | 15 | 10 | Long |
| M3 Arthur | Masculine | 0 | 100 | 100 | 85 | Round |
| F1 Mira | Feminine | 50 | 50 | 40 | 60 | Oval |
| F2 Avery | Feminine | 100 | 0 | 100 | 0 | Angular |
| F3 Amara | Feminine | 0 | 100 | 15 | 100 | Round |

## Appearance selections

| Character | Skin | Hair | Facial hair | Glasses | Clothes |
| --- | --- | --- | --- | --- | --- |
| M1 Rowan | Warm medium | Brown front curl | None | Off | Teal shirt, navy trousers, brown shoes |
| M2 Kiran | Deep brown | Black short crop | None | Rectangular | Cream shirt, charcoal trousers, brown shoes |
| M3 Arthur | Fair | Bald | Short brown beard | Off | Rust shirt, navy trousers, brown shoes |
| F1 Mira | Warm medium | Brown side-part bob | None | Off | Teal shirt, navy trousers, brown shoes |
| F2 Avery | Cool fair | Dark brown pixie | None | Rectangular | Slate-blue shirt, charcoal trousers, brown shoes |
| F3 Amara | Deep brown | Silver short wave | None | Round | Ochre shirt, navy trousers, brown shoes |

These combinations are selected to make the differences easy to compare. They do not constrain random generation. Names, skin tones, hair, glasses, clothing, and personality remain independent of the presentation toggle. All figures represent adults; gray hair does not establish an implemented age system.

The boards show approximate silhouettes. Final appearance must come from actual saved shape parameters, with the same parameters used by the creator preview and the played character. The middle, lower, and upper settings must remain distinguishable without relying on their labels. Test individual controls with all other settings held constant after a model exists; these mixed-selection concepts cannot establish isolated slider effects.

## Interface decisions

The main button reads Randomize. Locked fields survive global and section randomization, and the field's own Random button is disabled while locked. Undo restores the entire prior draft. New characters start randomized; editing loads the exact existing character.

Keep the preview area free of selected personality commentary. The removed sleep/company text repeated explanations already next to the controls and had no defined rule for deciding which observations to display. Keep functional explanations at the control they explain.

## Review boundary

Approve or revise the silhouettes, range of variation, faces, and appearance selections. That approval sets an art target; it does not prove the rendering approach, authorize implementation by itself, or approve every future combination. The [creator proposal](2026-10-11-character-creator-proposal.md) defines the required appearance engineering and later verification.
