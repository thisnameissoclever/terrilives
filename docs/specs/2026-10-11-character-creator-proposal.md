# Character creator proposal

October 14 update: the [runtime contract](2026-10-12-character-creator-runtime.md#editing-and-organization) supersedes this proposal's original-snapshot Reset behavior. Reset now restores fixed defaults; Undo preserves the previous draft exactly.

Character creator design contract. The layout and local implementation are owner-authorized. Publication and final artwork approval remain separate.

Implementation: [accepted appearance proof](../evidence/2026-10-12-character-appearance/accepted-followthrough/report.md), [local implementation plan](../superpowers/plans/2026-10-12-full-character-creator.md), and [runtime contract](2026-10-12-character-creator-runtime.md). The creator and gameplay use the same configured mesh renderer.

Build a creator that explains how a person will behave, lets the player shape their appearance, and preserves that person when edited later. Use the existing dark interface and approved cartoon character style. Keep appearance independent of personality, competence, and relationships.

The interface and controls below are implementable with the game's existing HTML, CSS, and TypeScript interface. Most behavior controls expose existing simulation values through new editing commands. Appearance customization includes building the mechanism that applies the controls to the character, saves those choices, and renders them throughout play. Continuous body proportions use configured control meshes, matching rest joints and the source animation skeleton. Published furniture colors remain preserved while sprites and configured geometry share physical depth and sample coverage.

## Mockups

The owner selected the sidebar layout with a larger appearance preview. The combined mockup shows a proposed feminine character with a distinct face, body silhouette, and hairstyle. This is static concept art grounded in the existing interface and approved cartoon style, not a browser capture or a rendered, rigged model. Slider numbers in the image illustrate controls; they are not measurements of generated geometry.

1. [Combined appearance screen](../assets/character-creator-proposal/04-combined-appearance-feminine.png): feminine character concept, large preview, appearance controls, and global, section, and field randomization.
2. [Combined personality screen](../assets/character-creator-proposal/08-personality-without-summary.png): the same character and layout with independent randomized personality metrics, optional preset application, and the main button labeled Randomize. The preview contains no behavioral summary.

Physical slider numbers use a relative 0-100 scale mapped to approved model dimensions. A value of 42 for Height is not 42 centimeters. The final minimum and maximum dimensions must be set from model and animation tests. Thumbnail facings and slider positions in these generated images are illustrative; production controls and previews must derive exactly from the saved values.

The written definitions in this proposal govern controls and randomization. The [character-variation studies](2026-10-11-character-creator-variation-studies.md) show labeled middle settings and extremes for owner review. The appearance screen uses the same Randomize label as the updated personality screen; its earlier image is a layout reference.

Keep the character preview focused on appearance. Do not insert selected personality observations beneath it. Explain each setting beside its control and explain conflicting selections at the relevant decision. There is no approved rule for choosing a few traits to summarize below the portrait.

## Recommended flow

Use the section-navigation approach, with the large appearance preview available in Appearance. A new draft already has a random name and valid randomized values, so the player can visit sections immediately. Put a single Review and move in action at the end.

1. **Identity:** editable name, random name, and lock.
2. **Appearance:** Gender (Male/Female), body, face, hair, clothing, colors, and accessories. All groups start collapsed; Colors comes first. Show four facings, an enlarged model, and an actual game-size sample.
3. **Personality:** temperament and selected traits, with conditions in a collapsed group.
4. **Needs & habits:** sleep timing, broad activity preferences, and advanced need rates. Applying an optional preset explicitly discloses its cross-page effects.
5. **Interests & skills:** distinguish reactions to nearby objects from enjoyable activities, and explain practice and skill levels.
6. **Household:** valid relationships with existing housemates.
7. **Review:** readable summaries with units, selected names, and skill progress, followed by Move in or Apply changes.

Keep a draft across section changes. Support Undo, Reset section, per-control locks, and Randomize unlocked choices. These are proposed editor features. Reset in create mode restores the initial randomized draft; Reset in edit mode restores the loaded person. It does not reroll either.

## Randomization

Every new-character draft starts with randomized values throughout, including name, male/female gender, appearance, numeric personality metrics, selected traits, editable condition severities, environmental preferences, hobbies, starting skills, and valid household ties. Opening an existing character preloads that person's exact saved values. Opening, navigating, or repainting either mode must never reroll a draft implicitly.

1. **Global:** the button labeled Randomize rerolls every unlocked editable field. The first opening has no locks and randomizes everything. One Undo restores the entire prior draft, including fields in other sections.
2. **Section:** each section has Randomize followed by its name. It affects only unlocked fields in that section.
3. **Field:** every editable slider, selector, toggle, name, and multi-selection group has its own Random button and lock. Use accessible names such as Randomize height and Lock height. A locked field stays unchanged during field, section, and global randomization; disable its Random button until unlocked.
4. **Discrete choices:** use equal chances for supported values, including 50/50 male/female gender. Resolve gender first, then select an unlocked name uniformly from its matching and shared-name categories, independently of skin tone. Optional off/none states participate where valid.
5. **Numbers:** sample uniformly over each approved control's legal range or explicit steps. Do not concentrate values around average or quietly suppress extremes. The final physical domains need animation proof; randomization cannot conceal unsupported combinations.
6. **Traits:** randomize the count from one through the available four-slot limit, then select that many distinct traits uniformly. With locked selections, preserve them and randomize only the remaining slots. An all-locked empty set remains empty; manual deselection may remove every trait. Explain opposing effects instead of silently banning valid combinations. Individual trait checkboxes can reroll subject to the same slot limit.
7. **Dependent choices:** construct valid combinations explicitly. Household ties must satisfy existing relationship rules. Hair and accessory choices must correspond to actual assets. Show any unsupported combination and its reason; do not quietly change a locked choice to make another control work.
8. **Editing:** no randomness occurs until the player explicitly presses a Randomize control. Preserve loaded skill progress, condition severity, personality values, appearance, and relationships even when they do not match a current preset. A confirmed, deliberate edit to one of those fields is the only exception.
9. **Repeatability:** use a separate draft random generator and keep its seed and reroll state with the draft. Experimenting or cancelling must not consume the live simulation's random draws. Commit the resolved choices together so save/load and replay reproduce the accepted person.

The selected trait set and environmental feelings are independent random values. For example, someone can enjoy choosing television yet dislike another person's television use nearby. Do not replace randomized preferences with trait-based defaults behind the player's back. Explain that combination beside the affected selections.

Random means a valid draw, not a guarantee that every click produces a different value. Do not clamp unseen random values to a middle setting or reroll them until they seem agreeable.

The proposed name pool contains 40 English/European selections, 40 selections familiar in the United States or Canada, and 20 less familiar, pronounceable selections. These are editorial selection groups with substantial cultural overlap, not exclusive origins or character identities. Names remain editable. Gender tags guide generated suggestions only; manual gender changes preserve the current name. The [name list](2026-10-11-character-creator-names.md) supplies the draft pool.

On a phone, use one column, a compact preview that expands on demand, a section selector, and a persistent Back/Continue bar. Give every slider a keyboard-operable numeric input or named steps. Name color swatches and show selection with more than color. Pause the game and restore focus when the creator closes, as the existing form does.

## Personality metrics and mechanical effects

All bounds marked proposed need balance review. A tendency changes the chance of a choice; it does not guarantee that choice or override urgent needs and direct player orders.

| Control | Proposed presentation | Connection to existing mechanics |
| --- | --- | --- |
| Archetype | The correspondent, The settled, The flitting, Custom | Existing archetypes supply need multipliers, object/action preferences, sleep timing, and cleanliness. Editing one value marks the draft Custom. |
| Shyness | Integer 1-100; less shy to more shy | Controls privacy boundaries, avoidance of occupied bathrooms, and reactions to unwanted interruptions. Keep it distinct from social need and willingness to socialize. |
| Cleanliness | 0-100% | Controls tolerance for mess, the strength of annoyance, and willingness to clean. See the shared cleanliness response contract. |
| Self-preservation | Integer 0-100; Random or manual | Creation already supports this. It influences survival-risk adjustments to autonomous choices. Editing it is a proposed extension. |
| Sleep timing | Hours earlier/later than the ordinary rhythm; proposed -3 to +3 hours in 30-minute steps | Existing chronotype offset shifts the sleep rhythm. It is not a hard bedtime or a guarantee of uninterrupted sleep. |
| Need for company | Social drain, proposed 50-150%; 100% ordinary | Higher values make social need fall faster. Existing mechanism, new direct editor. |
| Need for stimulation | Fun drain, proposed 50-150% | Higher values make boredom develop faster. No new curiosity or intelligence claim. |
| Comfort sensitivity | Comfort drain, proposed 50-150% | Higher values make discomfort develop faster. It does not imply body size or physical fitness. |
| Advanced needs | Separate drain and recovery controls for Hunger, Energy, Hygiene, Bladder, Social, Fun, Comfort | Exposes the existing seven drain and seven refill multipliers. Label 100% as ordinary and explain whether a higher number increases consumption or recovery. |
| Activity preferences | Broad categories with a displayed average weight | Existing personality dispositions weight particular object/action choices. A category-level editor must enumerate all matching routes consistently. Zero weight prevents autonomous selection through this factor; it must not disable a player order. |

Do not add intelligence, empathy, aggression, creativity, ambition, or a five-factor psychology chart merely to make the screen look detailed. Those would need new rules and observable consequences. They can become later design work once there is an agreed mechanic for each.

## Traits, proclivities, and learned abilities

Use the shipped trait library as the initial catalog. A trait occupies one slot; a numeric personality setting does not.

| Group | Existing choices | What the creator should explain |
| --- | --- | --- |
| Activity preferences | Bookworm, Keen cyclist, Avoids exercise, Fish watcher, Chatterbox, Private person, Television devotee, Hates television, Avoids the couch | These alter the weight of tagged activities during autonomous choice. Show the effective combination with personality preferences. |
| Capability traits | Can't cook, Out of shape, Slow reader | These enable the existing attempt/failure behavior. Practice belongs to Cooking, Fitness, or Reading and survives removing a capability trait. |
| Conditions | Low spirits, Isolated, Cooped up | Describe the authored satisfaction effect and helpful activity respectfully. Randomize starting severity over a validated editable range; this requires a new creation command field. Do not invent medical diagnoses or claim guaranteed recovery. |

Show opposing selections before confirmation. For example, Keen cyclist and Avoids exercise currently contribute multiplicative effects; the editor must explain their combined result or offer to replace one, rather than quietly discard a selection. It must not invent a universal rule that opposite labels cancel exactly.

Environmental likes and dislikes use the existing values from -1 to +1. Offer Hates, Dislikes, Indifferent, Likes, Loves, with an optional exact slider. Preserve exact loaded values until explicitly edited. Plants and aquariums can affect mood through their presence. Television and radio can bother someone while another person uses them in the same room and affect that person's opinion of the user. Liking a television is not itself the same as choosing to watch television.

The initial editable environmental catalog is **Plants, Aquarium, Television, Radio**. Color preferences, food preferences, generalized noise sensitivity, and new object categories are extensions, not existing functionality.

The creator must supply its resolved environmental values explicitly instead of having the current trait-based initialization replace them. Changing a trait later must not silently overwrite an individually chosen affinity. Existing saves can already contain a trait and affinity that disagree; present both honestly.

Hobby selection can expose existing activity tags that award life satisfaction. Proposed starting-skill controls cover Cooking, Fitness, and Reading, each on the existing ten-level ladder. They require a new validated creation path and a decision about permitted starting levels. Do not advertise career bonuses or unlocks: the inspected skills system currently uses mastery for capability failures. Leave career choice and job eligibility to their own design.

## Physical controls

Keep the masculine/feminine toggle prominent and literal. Treat it as a choice of authored appearance starting points. It must not set personality, pronouns, voice, skills, attraction, or clothing availability. After manual changes, retain those overrides; offer an explicit Reset to preset action instead of silently replacing them.

The following is the intended full control inventory. A control may ship only when its saved value produces a visible, validated result in the game. Proposed art choices are not assertions that those assets already exist.

| Area | Sliders, selectors, and toggles | Feasible delivery boundary |
| --- | --- | --- |
| Presentation | Masculine / Feminine preset toggle | New authored presets and saved appearance data; all subsequent choices remain available. |
| Skin | Inclusive tone swatches; optional undertone selector | Requires material-region recoloring or authored variants across all poses. Existing shirt palettes do not prove arbitrary skin recoloring works. |
| Body | Height, build/fullness, shoulder width, hip width, torso proportions | Build actual shape parameters and prove their allowed combinations. Stepped ranges are acceptable only when the steps correspond to the named physical change. Do not silently map unrelated sliders to a few whole-body presets. |

Torso proportions move the hip rest position by up to 0.05 model units in either direction before height adjustment. The control retains its full 0-100 range and uses the same rest shape in every activity; interactions must not shorten the configured body.
| Face silhouette | Face shape selector; cheek fullness, jaw width, chin length sliders | Build reusable face shapes and parameter changes. Broad changes must remain legible at game size. The rendering path must carry those changes into play. |
| Facial features | Eye shape/size, brow shape/thickness, nose shape/width, mouth shape/fullness, ear size | Bounded authored variants, checked at normal zoom. Avoid tiny-detail controls that only work in an enlarged portrait. |
| Hair | Style selector, color swatches, bald toggle | Preserve the approved front-curl asset. Soft wave, tousled crop, and quiff have retained concept references but need finished models and animation exports. |
| Facial hair | None / stubble / moustache / beard, color selector | New assets, available independently of the Gender control. |
| Surface details | Freckles on/off and density; scars or markings selector | New authored material details, only if readable at the intended scale. No behavioral effects. |
| Clothes | Top, bottoms, shoes selectors; independent color swatches; sleeves where an authored variant exists | Bounded garment catalog. Verify collars, joints, seated folds, covered beds, and bathroom poses. |
| Accessories | Glasses on/off and style; earrings selector | New attached assets with correct layering in all supported facings and animations. |

Appearance has no automatic relationship to Fitness, cleanliness, appetite, ability, or condition traits. Adult-looking characters remain the initial scope because a working age/life-stage system has not been established by this review.

## Rendering and save requirements

The original character renderer displays prebuilt images exported from modeled scenes. Texture pages expand storage organization; they do not provide runtime three-dimensional character deformation. Existing furniture interaction scenes also select character shirt variants. Adding every hair, body, garment, and color combination as complete images would multiply the asset count and download cost.

Use one appearance representation across standing, walking and occupied furniture. Configure the control mesh, clothing and rest joints from the same saved parameters in the preview and game. Material colors and reusable parts must obey the actual depth, lighting, outline and occlusion rules.

Keep the accepted source models and production atlas unchanged. Store new authoring and runtime assets separately. Measure asset size, texture allocation and scene correctness as the catalog changes. Height and build need contact checks for chairs, beds, toilets, bathing, cooking, reading and carried objects. Review all four supported facings; arbitrary rotation needs its own visual review.

The selected renderer evaluates parameterized meshes at runtime, preserving source-order skinning and subdivision. Dated evidence records its tested ranges and performance. Generated concept images never stand in for the mechanism that translates slider values into characters.

Verify that each physical control changes its intended geometry or material, survives reload, and works during gameplay. Test endpoints and meaningful combinations across supported animation families. A failing range requires repair or an explicit owner decision; do not ship a decorative control or silently reduce its meaning.

Add saved appearance identifiers and custom personality edits through validated simulation commands. Validate the complete request before changing anything. Preserve names, traits, skills, relationships, needs, career, location, and history except for fields the player explicitly changes. Preserve custom personality values on name-only or appearance-only edits. Handle old saves explicitly, retaining their existing appearance assignment and behavior.

Removing a condition retains the existing severity-removal behavior and preserves skills. Keep these implementation details out of player-facing copy. Cosmetic fields should not affect autonomous random draws. Behavior-bearing fields must participate in deterministic replay and saved-state validation.

## Review and delivery boundaries

1. Keep the selected sidebar layout, large preview, narrow-screen controls and review page tied to the same draft.
2. Use actual rendered characters for artwork review. Preserve accepted contact overlap while checking new shapes and interactions in all four facings.
3. Verify exact editing, independent randomization, atomic commands and historical save migration before delivery.
4. Keep measured performance and finite coverage in dated evidence. Expand the asset catalog only with corresponding fit and rendering checks.
5. Obtain owner artwork approval separately from technical verification and publication authorization.

Local implementation is authorized. Dependency changes, paid asset generation, publication and merge require separate authorization.

## Source map

1. Creation and editing: [creator session](../../web/src/ui/character-creator/session.ts), [creation contract](2026-09-22-create-a-sim.md), [editing contract](2026-09-30-edit-sims.md), [tuning](../../content/tuning.toml).
2. Personality: [runtime components](../../crates/terri-core/src/components.rs), [shyness](../../crates/terri-core/src/shyness.rs), [archetypes](../../content/personalities.toml), [privacy and social behavior](2026-09-30-need-social-privacy.md).
3. Traits and skills: [trait definitions](../../content/traits.toml), [trait effects](../../crates/terri-sim/src/systems/trait_effects.rs), [skill definitions](../../content/skills.toml), [skills contract](2026-10-05-skills.md).
4. Environmental preferences: [affinity implementation](../../crates/terri-sim/src/affinity.rs), [affinity contract](2026-10-06-object-affinities.md).
5. Appearance: [approved hairstyle and model direction](2026-09-07-sim-hairstyle-direction.md), [texture pages](../atlas-pages.md), [interaction scene selection](../../web/src/render/interaction-sprites.ts), [art-review lessons](../lessons-learned.md).
6. Visual references: [existing interface capture](../assets/review-evidence/sim-details-layout/desktop-personality.png), [approved character comparison](../../assets/models/sims/sim-01/source/approved-comparison.png). These are repository references, not fresh captures made during this proposal.
