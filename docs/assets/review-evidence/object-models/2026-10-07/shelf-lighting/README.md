# Shelf lighting review

The revised source artwork keeps the existing cabinet and book geometry, materials and light directions. It removes shadows cast by books onto the cabinet or other rows. The cabinet still casts shadows, and books in the same row can shadow one another. Actor lighting retains its separate shadows.

This change makes independently stored shelf rows composable. Previously, adding a shadow from an empty row could darken a book in another row, producing a colour that the complete source scene never rendered. The revised source uses separate light receivers and shadow blockers for the cabinet, each book row and the actor, with fixed world-space shadow resolution.

The two PNGs show the previous and revised fully stocked shelf from the same camera. The comparison receipt records independently rendered full and mixed inventories in all four directions. All 24 comparisons passed the unchanged maximum-error and 95th-percentile limits of 6 and 2; the largest measured channel error was below 0.00005. Actual renderer integration and owner visual approval are separate checks.
