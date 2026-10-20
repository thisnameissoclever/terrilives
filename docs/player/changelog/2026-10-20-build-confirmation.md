# Build mode confirms walls, doors and windows again

Build mode no longer gets stuck when it cannot confirm wall, door and window changes. When something is in the way, it now says what and how to leave.

## Fixed

- A doorway or opening that would leave furniture facing a closed-off space nobody can reach is now refused when you place it, with the reason. Before, a house with a window could get stuck on "Build validation failed (detail 2)", and no change could be confirmed.
- When **Confirm** cannot apply the changes, Build mode says what is in the way and what to do, marked as an error. If you chose **Confirm changes** while leaving, the Leave Build mode? dialog opens again with the reason, so **Discard changes** stays one click away.
- When Build mode cannot open, the game now says why instead of ignoring the **Build** button.
- A housemate waiting for someone to come over for a chat or an argument no longer gets up for a shared meal partway through. Before, this could stop Build mode from opening and make a save taken at that moment fail to load.
- A housemate walking past a window on the way to something just behind it no longer stops **Confirm** or Build mode from working, and no longer makes a save taken at that moment fail to load.
