# Gradual mood changes

Needs now change mood gradually as game time passes.

## Improved

- Each empty need lowers mood over time. Each need above 80% lifts it slowly. Open Sim details and choose Overview to see their combined effect under Mood from needs.
- Saves keep the accumulated effect. Older households start counting it when you resume playing.

## Fixed

- Closing or reloading the tab while the game was saving could leave an empty saved game that failed to load. The game now keeps a copy of the save before the latest one and loads it if the latest cannot be read. An empty save counts as no save, so the game no longer stops saving.
