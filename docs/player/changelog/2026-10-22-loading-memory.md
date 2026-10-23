# Lighter loading and download recovery

The game needs less memory for artwork and can recover from brief character download outages.

## Improved

- Loading uses less memory while keeping the same artwork and image quality.
- Loading can recover from a briefly unavailable character file without restarting the game.
- If loading fails, Startup report keeps the last loading step and error details. The report opens without starting the game.

## Fixed

- A failed character download cannot leave loading waiting indefinitely for its error response to close.
