# Clearer Build exits, guide illustrations and a Build mode that confirms again

Build controls are clearer, clipped Sim status can be opened in full, and the player guide places relevant screenshots alongside its explanations. Build mode no longer gets stuck when it cannot confirm wall, door and window changes, and it says what is in the way and how to leave.

## Improved
- Guide articles include cropped views of the controls, panels and seasonal effects they discuss.
- Choose Desktop or Phone to see the matching screenshots throughout an article.
- Enlarge screenshots within the guide, zoom in for details, then close the viewer to return to your place.
- The UI reference keeps instructions visible and gives each character creator page its own section.
- Confirm and Cancel at the bottom of Build now close Build. Confirm keeps your changes; Cancel discards them.
- Switching to Land asks you to confirm or discard other pending Build changes first.
- Hover over a clipped Sim status, focus it with the keyboard, or tap it to read the full text.
- Sim dock buttons take up less vertical space while keeping their widths and readable labels.
- Build controls omit repetitive selection and ready messages while keeping useful feedback.

## Fixed
- Keep building uses a normal button in the exit dialog, and Confirm appears directly below Discard changes.
- A doorway or opening that would leave furniture facing a closed-off space nobody can reach is now refused when you place it, with the reason, including a doorway made with **Build room**. Before, a house with a window could get stuck on "Build validation failed (detail 2)", and no change could be confirmed.
- When **Confirm** cannot apply the changes, Build stays open and says what is in the way and what to do, marked as an error. If you chose **Confirm changes** in the exit dialog, the dialog opens again with the reason, so **Discard changes** stays one click away.
- When Build mode cannot open, the game now says why instead of ignoring the **Build** button.
- A housemate waiting for someone to come over for a chat or an argument no longer gets up for a shared meal or a chore partway through. Before, this could stop Build mode from opening and make a save taken at that moment fail to load.
- A housemate walking past a window on the way to something just behind it no longer stops **Confirm** or Build mode from working, and no longer makes a save taken at that moment fail to load.
