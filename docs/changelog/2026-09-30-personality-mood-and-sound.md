# Personality, mood and household sound

Housemates make more varied choices, keep their own sleep rhythms, and show more of their personality and habits in Sim details.

## Features & changes
- **Autonomous choices have more variety.** New games draw fresh randomness, activity choices and strolls vary, and Fun and Social remain appealing as needs improve. Each person has a saved Self-preservation instinct; New housemate offers Random or a manual value. Low values can lead someone to neglect critical needs. [PR #143](https://github.com/thisnameissoclever/terrilives/pull/143)
- **Personality and habits are visible.** Open Sim details, then Personality and habits, for each need's Drain and Refill factors, sleep rhythm, and recent activity repetition. [PR #168](https://github.com/thisnameissoclever/terrilives/pull/168)
- **Sustained mood affects life satisfaction.** Long periods of high or low mood accumulate an effect. Waiting for an occupied item lowers mood, with a stronger penalty when the relevant need is low. Death is enabled for new games and once for older saves; a subsequently saved off choice is respected. [PR #140](https://github.com/thisnameissoclever/terrilives/pull/140)
- **Grief lasts longer and fades gradually.** Depending on affinity, grief lasts from 10 to 60 game days. [PR #141](https://github.com/thisnameissoclever/terrilives/pull/141)
- **World controls and Sim information have separate places.** Build and Options sit at the upper left; Sim details, Overview, Queue, People and Household are in the bottom dock. Traits start collapsed, and the selected person's name is easier to distinguish. [PR #142](https://github.com/thisnameissoclever/terrilives/pull/142) and [PR #149](https://github.com/thisnameissoclever/terrilives/pull/149)

## Bug fixes
- **Early risers and night owls retain their sleep rhythms.** The chosen personality's sleep offset is applied correctly and preserved through saving and loading. Older saves retain their historical schedule. [PR #147](https://github.com/thisnameissoclever/terrilives/pull/147)
- **Conversation audio follows the people talking.** Ending or replacing a conversation releases its own sound; another active conversation keeps playing. Voices fade at normal conversation endings, and failed voice downloads can retry. [PR #152](https://github.com/thisnameissoclever/terrilives/pull/152), [PR #150](https://github.com/thisnameissoclever/terrilives/pull/150) and [PR #167](https://github.com/thisnameissoclever/terrilives/pull/167)
- **Build previews and queued actions behave more consistently.** Build controls, furniture previews and action queues received corrections in the control-layout update. [PR #142](https://github.com/thisnameissoclever/terrilives/pull/142)

## Art & sound
- **Voices have their own volume control.** Voices adjusts conversation volume within the overall Effects mix. Activity recordings can loop while the activity continues; showers and front-door movement have recorded sound. [PR #164](https://github.com/thisnameissoclever/terrilives/pull/164), [PR #165](https://github.com/thisnameissoclever/terrilives/pull/165), [PR #169](https://github.com/thisnameissoclever/terrilives/pull/169) and [PR #171](https://github.com/thisnameissoclever/terrilives/pull/171)

