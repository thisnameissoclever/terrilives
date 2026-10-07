# Object types, model names, and descriptions

Object types identify a familiar physical kind. Model names distinguish specific products; descriptions convey their character, quality, and useful differences. Functional buying details carry actual capacity, costs, and effects. The content source is `content/objects.toml`; the [approved object-model contract](../superpowers/plans/2026-10-05-object-models-books-seating.md) defines the category/type/model system and replacement copy work. Publication follows the owner review requirement in [the string inventory](../player-visible-strings.md).

## Presentation

The object menu shows the smaller model name above the bold type. Click or tap the name, or activate it with Enter or Space, to toggle the description. Hover and keyboard focus alone do not open it. The description remains open while using the surrounding menu and starts closed when the menu is reopened or another object is chosen. Escape closes the menu and returns focus. Initial placement reserves space for the expanded description so it stays inside the viewport. Very short screens can scroll the menu.

The Buy list identifies objects as `Type: Model (price)`, sorted by type, model, then content order. The chosen item's identity block uses the same disclosure as the object menu. Prices, the Good for line, and controls stay outside the optional description. Changing the chosen item clears the previous description; periodic redraws preserve its open state. Existing affordability rules remain in force.

Keyboard targeting includes described decorative objects even when they offer no actions. The washing machine still has no washing interaction. Its menu offers only the existing cancel action; adding copy does not add simulation behavior.

## Content and compatibility

`content/objects.toml` keeps `name` as the model name and adds optional `presentation = { object_type, description }`. Both presentation fields are required when the table exists, and compilation rejects blank type, model, or description text. Without the table, primary identification continues to use `name` and no model disclosure appears.

The compiled object appends the optional presentation record. The compiled pack is rebuilt with the application; it is not the persisted save format. The save compatibility digest excludes presentation text, as it already excludes object display names. Object ids, definition order, interaction indices, prices, footprints, and save schema are unchanged.

The simulation's primary-name lookup resolves `object_type` when supplied. The browser boundary exposes model/description pairs through `object_details_of` for placed objects and `catalogue_details` in catalogue order. `SimBridge` keeps those details separate from the primary label, so builder feedback and accessible targeting also use the type. Tests cover blank-text rejection, pack serialization, catalogue/placed-object alignment, legacy labels, and save compatibility.

The whole-game voice pass in T22 also covers other authored text and remains a separate review.
