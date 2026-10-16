# Character creator runtime contract

The creator edits a private character draft. New drafts randomize supported values; existing people preload their exact stored values. Appearance edits leave personality unchanged. Global Randomize changes unlocked fields across the draft, including personality, using its own random generator instead of the household's generator.

## Editing and organization

Identity, Appearance, Personality, Needs & habits, Interests & skills, Household, and Review share one draft. Personality combines temperament and named traits. Conditions, advanced need rates, and skill details begin collapsed. Activity preferences starts expanded and can be collapsed. Appearance begins with collapsed Colors, Body, Style, Face, and Details groups. Disclosure state survives navigation. Each group has one heading.

Activity preferences use Eat & cook, Sleep, Wash & bathroom, Relax, Read, Watch TV, Listen to music, Exercise, Write letters, and Watch fish. Membership follows explicit action identifiers. The displayed arithmetic mean includes implicit weights of one; viewing it changes nothing. Editing a category sets its member routes atomically. Undo restores the exact previous sparse records and float values. Reset removes the category's explicit weights so every supported member uses the default 1.0x preference. Unsupported routes and the ineffective dish-cleanup activity weight remain preserved internally and have no misleading slider. Trait contributions appear beside the affected category.

Randomize affects unlocked fields. Section and field operations restrict that scope. Page membership is independent of command/save groups, so resetting Personality cannot reset needs or activity preferences. Locks protect absence and conditional values from randomization; explicit Reset ignores locks. Undo restores draft values and private random-generator state.

Reset section restores the current page's fixed defaults, and Reset character restores the whole character's defaults, in one undoable operation. The draft API also supports resetting a single field. Reset neither consumes nor rewinds the private random generator. Defaults are the name New housemate, Male gender and its neutral appearance, temperament values of 50, cleanliness of 50%, ordinary need rates of 100%, zero sleep offset, activity preferences of 1.0x, neutral surroundings, no selected traits or hobbies, unpracticed skills, and no household relationships. Field resets use the same defaults, including hidden freckle density. Condition-severity reset uses that condition's initial severity when selected. Reset appearance to preset separately restores the neutral appearance for the currently selected gender. Legacy pronouns, retired hobbies, and activity routes without creator controls remain unchanged. Clearing a saved household relationship sends an explicit null relationship. The initial snapshot remains the baseline for edit validation and patch comparison; Undo can restore the exact previous draft, and Cancel discards it.

Explicit personality preset application discloses its effect on need rates, activity preferences, sleep timing, and cleanliness.

The name pool contains 40 English/European names, 40 names common in the United States or Canada, and 20 less familiar pronounceable names. Each is tagged typically male, female, or either. Resolve equal-probability Gender first, then sample an unlocked matching name. Name-only randomization uses current gender. Manual gender changes preserve the current name. Pronouns have no creator control or summary; new drafts leave the legacy field empty and existing values survive unrelated edits.

New unlocked trait rolls choose one to four traits subject to locked selections and available slots. Manual deselection can leave none. At the limit, selected traits remain removable and unselected additions are disabled with an explanation. Review lists selected choices and formats percentages, multipliers, skill levels, and practice progress without exposing storage values.

## Appearance and previews

`CharacterAppearanceV1` retains stable asset identifiers and named parameters. Gender labels Male/Female map to the existing masculine/feminine stored values. Height covers 85%-115% of neutral anatomical height. Build, shoulders, hips, and torso proportions configure matching rest geometry and joints. No interaction shrinks the configured person or substitutes a neutral body.

Bald is a hairstyle selection over the existing saved hair state. Clothing colors sit below their corresponding selectors; Bottoms color covers trousers and shorts. Freckle density is visible only when Freckles is enabled, preserving its hidden value. A continuous head-surface mask covers cheeks, the nose bridge, and the forehead and follows face deformation.

Animation offers Standing, Walking, Reading, and Cleaning. Walking is selected when the creator opens and plays automatically unless reduced motion is requested. Pause/Play controls playback. Its private clock stops while hidden or closed; household simulation remains paused during editing. Only appearance changes rebuild appearance. Name changes update the heading, and unrelated edits leave the preview geometry intact. Retain the last valid model during updates, keep error space stable, and do not insert transient rendering messages that move controls.

## Rendering and ownership

The renderer configures the control mesh and rest joints, skins that mesh, evaluates subdivision, and reconstructs normals. Immutable geometry is shared per graphics device. Explicit authored outline ownership replaces name-derived shells around decorative details.

Configured body resources survive animation changes; clip-specific hands, props, and covers remain separate. The enlarged and game-size previews share pose and deformation work while keeping their own camera uniforms. Shader programs are shared by device, and live mesh resources are released with their last view. Source-part validation protects the independent vertex ownership required by contextual visibility.

Bike and sleeping support are required configuration artifacts prepared through one bounded background worker. Bike input uses authored phase zero; drawing samples the prepared whole cycle at the current simulation phase. Generic animation interpolation is unchanged. Sleeping support uses each authored static pose and prepares the draped cover contribution for each sleeping place. Drawing cannot run either support search.

Bike preparation depends on presentation, body proportions, bottoms, and footwear. Sleeping preparation also includes the head, hair, accessories, and garments that affect its configured surface. Independent keys prevent a change from rebuilding unrelated support; names, personality, needs, and uniform-only colors rebuild neither. Current household members, queued character outcomes, and the newest creator request own explicit leases. Superseded requests settle as cancelled, and unowned completed artifacts are released. Graphics recovery reuses these prepared artifacts while replacing graphics resources.

Each live bed fixture owns retained cover topology before it can be used. Occupancy combines prepared slot contributions and updates that cover without constructing a new surface or graphics buffer. Empty beds keep their published artwork; fixture removal releases their retained resources.

The creator keeps its last valid preview during preparation and leaves editing and cancellation available. A new appearance invalidates an older pending draw immediately, including an A-B-A edit sequence. Preparation never submits a character command automatically. The current configuration must be ready when the player applies the draft.

The optional narrow-screen preview does not gate Move in or Apply changes. Required appearance preparation runs while the preview is hidden; only drawing and its animation clock stop. Submission waits for the latest preparation, and obsolete completions or errors cannot change the current draft's readiness.

Sprites and dynamic meshes share a scene with twice the display framebuffer dimensions. Color, coverage, physical depth, and categorical identity stay associated at each sample until visibility is resolved. Only color is reduced for presentation. The scene uses linear premultiplied color; registered sprite color and depth use the same source sample. Picking selects a visible physical sample and never averages identifiers. Framebuffer allocation respects the graphics device's texture limits.

Fixtures keep their published color artwork and registered depth. Occupancy replaces only explicitly authored moving-component states. Shelf depth follows its current stock. Configured bed covers have fixture identity and the fixture's colorway, while occupants retain separate identities. Carried and placed props retain their own registered surfaces; bitmap-only ingredient art is explicitly represented as a hand-anchored billboard. Original character and production atlas files remain preserved.

The selection marker is a blue ellipse drawn directly into the shared scene. Its translucent fill and smooth border are sampled at scene resolution. The marker projects the person's posed feet onto the floor; raised ankles, shower trays, and mattresses cannot lift it above that floor. Physical scene depth hides the marker behind people, furniture, and walls. The marker changes color only and never replaces physical depth or picking identity.

Seated contact jointly fits a connected pelvis underside patch, grounded feet, and calf clearance against actual furniture triangles. The raised front of a garment can overhang the cushion; complete garment containment is not a support requirement. Dining retains table reach by fitting the rigid hand and spoon around their unchanged food contact. Sofa stable seat identifiers map to the corresponding authored cushions in every facing. These fits are prepared in the background before a configuration can be drawn; changing animation phase cannot start a geometry search.

Kitchen fixtures next to walls use a shared physical registration derived from their authored bounds and the wall's thickness. The same translation applies to artwork, registered depth, contents, grime, and interacting characters. Native placement and save coordinates remain unchanged. A renderer depth bias must never substitute for physical clearance.

Showering uses the shared configurable rig, with a washing cycle and a nominal duration of 90 game minutes before existing duration variation. Two translucent steam regions follow the posed chest and pelvis. Steam uses physical depth testing, changes color only, and leaves selection and picking attached to the person. Pausing freezes its animation without consuming simulation randomness.

Activity bubbles use the posed head-and-hair envelope and their actual visible-bottom registration, with a four-logical-pixel gap. Head-envelope reuse compares the exact values of every matrix used by head positions, normals, and visibility. Arm or leg changes alone do not invalidate it; configured surfaces, head transforms, visibility, and selected parts invalidate the relevant cached result. Mutable pose arrays are compared against a copied snapshot. Markers and picking remain attached to the person. Gameplay motion consumes simulation time and distance; the independent preview clock does not advance gameplay. Graphics recovery preserves the household and draft.

## Simulation meaning and storage

Cleanliness controls tolerance for mess, the strength of annoyance, and cleaning decisions through the [shared response](2026-10-13-cleanliness.md). Shyness controls privacy boundaries, avoidance of occupied bathrooms, and reactions to unwanted interruptions. Skills gain practice from completed attempts, including failures; higher levels reduce trait-related mishaps. They do not currently increase activity speed or universally increase need fulfillment.

Native validation completes before changing a person. Edits send only changed storage groups and preserve unedited needs, skills, activity, career, location, and history. Cancellation sends no creation/edit command. Save schema 10 combines the frozen schema-8 world with social state, appearance, compatibility fields, and creator-command ordering. Frozen loaders preserve both published social schema-9 saves and earlier local creator schema-9 saves. Complete decoding and authoritative validation must identify exactly one schema-9 layout before adoption. Original older bytes are retained in version-specific recovery backups, including schema 9. Invalid loads preserve the running household and stored bytes. Behavior-bearing edits participate in simulation-state checks; appearance has a separate checksum.

Startup prepares the admitted household before reporting readiness. Loading inspects an isolated native candidate and its queued-command outcomes, prepares their required contact artifacts, then adopts the untouched original bytes. Stage identity and readiness are checked before native adoption in the same synchronous section. A cancelled, superseded, refused, or failed load frees its candidate without changing live bytes or random state. Queued-outcome leases remain until the actual live command drain transfers ownership to the resulting people.

Browser stress probes use the same admission boundary:

1. `await __terriStress.characters.loadBytes(bytes)` stages and admits a saved household.
2. `await __terriStress.characters.create(request, draft)` and `await __terriStress.characters.edit(request, simId, patch)` prepare before queueing their unchanged native commands. Callers still own command draining and result checks.
3. `await __terriStress.characters.prepareCurrent()` explicitly prepares a current inspection roster. `characters.readiness()` reports owner and worker state.
4. Raw `loadBytes`, `createCharacter`, and `editCharacter` calls on the stress `sim` facade throw before mutation. The application bridge and native API remain unchanged. Bypassing that facade with an unprepared appearance is an admission error, never a request to omit the actor or run a synchronous fitting fallback.

Release-build performance probes use `characters.createDraft(seed)` for private draft generation and `characters.createPreview(large, small, animation)` for the shared preview renderer and its authored sample count. These factories are available only through the explicit stress interface. They allow the built game to supply its own code without importing development source URLs. Creating a draft or preview does not submit a character command.

Dated evidence records measured hardware, actual game and creator captures, test receipts, and independent review. A resized desktop viewport does not establish phone performance. Local implementation does not authorize publication or release.
