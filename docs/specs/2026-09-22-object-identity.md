# Object types, model names, and descriptions

Status: implemented and locally verified. On 2026-09-22, after seeing the copy and menu preview, the owner directed this slice to be committed, pushed, and merged. The PR and its checks record publication status.

The washing machine, armchair, and dining table now have a plain type, a secondary model name, and a description. This is the first application of the [project writing skill](../../.agents/skills/natural-causes-writing-style/SKILL.md), requested by the owner on 2026-09-22. Other objects retain their existing labels until their copy is reviewed.

| Type | Model name | Description |
| --- | --- | --- |
| Washing machine | Perpetual Cycle | Decorative washing machine; clothes washing is not available. A rare appliance that cannot eat your socks. |
| Armchair | Staying In | A chair for sitting. Leaving it remains a personal decision. |
| Dining table | Visiting Hours | A table for meals and whatever everyone promises to put away. |

## Presentation

The object menu shows the smaller model name above the bold type. The arrow beside the model name indicates a description. Hover or keyboard focus reveals it; activating the disclosure pins it open, and activating it again closes it. Escape still closes the menu and returns focus. Initial placement reserves space for the expanded description, so opening it does not move the hovered control. Hover expansion remains open while the pointer moves through the surrounding menu or Buy controls, so actions do not move underneath it. Leaving that surface dismisses an unpinned preview unless the disclosure still has focus. Very short screens can scroll the menu.

The Buy list identifies these objects as `Type: Model (price)`, sorted by type, model, then content order. The chosen item's identity block uses the same disclosure as the object menu. Prices, the Good for line, and controls stay outside the optional description. Changing the chosen item clears the previous description; periodic redraws preserve its open state. Existing affordability rules remain in force.

Keyboard targeting includes described decorative objects even when they offer no actions. The washing machine still has no washing interaction. Its menu offers only the existing cancel action; adding copy does not add simulation behavior.

## Content and compatibility

`content/objects.toml` keeps `name` as the model name and adds optional `presentation = { object_type, description }`. Both presentation fields are required when the table exists, and compilation rejects blank type, model, or description text. Without the table, primary identification continues to use `name` and no model disclosure appears.

The compiled object appends the optional presentation record. The compiled pack is rebuilt with the application; it is not the persisted save format. The save compatibility digest excludes presentation text, as it already excludes object display names. Object ids, definition order, interaction indices, prices, footprints, and save schema are unchanged.

The simulation's primary-name lookup resolves `object_type` when supplied. The browser boundary exposes model/description pairs through `object_details_of` for placed objects and `catalogue_details` in catalogue order. `SimBridge` keeps those details separate from the primary label, so builder feedback and accessible targeting also use the type. Tests cover blank-text rejection, pack serialization, catalogue/placed-object alignment, legacy labels, and save compatibility.

See [local verification](../assets/review-evidence/object-copy/README.md). This slice does not complete the whole-game voice pass in T22.
