# Player guide proposal

Approved with the owner's correction: Changelog is a separate site destination and must not appear among guide topics. Implementation source now lives in docs/player/; the original mock-up is retained as planning history.

Create one Player guide for Natural Causes, organized around what a player wants to do or understand. Keep requirements and exceptions in the main text. Put optional numbers beside the claim they explain. Generate the website and the game's short Help text from the same authored source.

This is an approval draft for [issue #313](https://github.com/thisnameissoclever/terrilives/issues/313). The HTML mock-up illustrates navigation and representative articles; it is not the finished guide or a complete gameplay inventory. No game behavior, public page, or publishing workflow changes in this proposal.

## Recommended structure

| Section | Pages and questions answered |
| --- | --- |
| Start here | Select a person; read their needs; give and cancel orders; pause; find Help; save and load. Explain that explicit orders can prevent self-care. |
| UI elements | A complete reference to the visible interface, with desktop and mobile screenshots for every control, panel and relevant state. Explain how to open each panel, what its details mean, and how to perform the tasks it exposes. |
| Needs | An overview and one page for Hunger, Energy, Hygiene, Bladder, Social, Fun and Comfort. Each explains which activities raise or lower the need meter, what can prevent an activity from helping, and why the meter can keep falling during a helpful activity. |
| Activities | A searchable, filterable reference to every available activity, with recognizable object types and actual action labels. Include activities with no direct need benefit so players can tell omission from intentional behavior. |
| Relationships | How each person's feelings work; actions that improve or harm feelings; company versus friendship; conversations and topics; shared activities; privacy; mess, chores and fights; how feelings change over time. |
| Mood and personality | Mood, temporary conditions, life satisfaction, traits, skills, hobbies and preferences. Explain what changes needs, what changes action choices, and what changes neither. |
| Home and controls | Furniture and access, meals and cleaning, room privacy, building and buying, work, time, settings, saves and recovery. Link detailed references rather than repeat them. |
| The world | Calendar, time, weather and seasons. Explain current seasonal changes with actual screenshots of falling leaves, leaves on the ground, snowfall and the clock. Separate coming weather preferences and longer-term weather variation from implemented behavior. |
| Changelog | Existing dated updates, with their current addresses, anchors and history preserved. |

The guide home starts with common tasks, including adding a housemate and finding a person's details, followed by these sections. The full glossary is a supporting page linked from unfamiliar terms and search results, rather than a prerequisite for reading. Use player words such as "feelings" in prose; explain the game's technical word "affinity" only in optional numerical details if needed.

The first publication must complete the needs, activities and relationship references. Other sections must contain useful current instructions at launch, using existing verified Help material where possible. Do not publish empty categories or pretend that a link to an engineering specification is a player article. Larger tutorials can follow separately.

## Page outlines

### UI elements: find every control and panel

Maintain a UI inventory against the current rendered game and its controls. Each entry needs a stable heading anchor, purpose, exact access path, desktop and mobile screenshots, visible labels, the meaning of displayed details, and instructions for its available actions. Include collapsed, expanded, disabled and confirmation states where they change what the player can do. Use a full-screen location image plus a readable panel close-up where needed; number callouts and explain them in nearby text. Screenshots supplement written steps and alt text rather than replace them.

Explain responsive behavior explicitly. The desktop dock can show needs; the compact phone layout puts them in Sim details. Expanding the phone dock does not move them back. Name the visible control and location, not an accessibility-region name that a sighted player cannot see. Acceptance must follow each access path separately on desktop and mobile rather than assuming one is a smaller copy of the other.

Cover the clock and season/weather line; Funds and save status; pause and speed; camera movement and zoom; household selection and the collapsed dock; needs, mood and life satisfaction; Sim details, People, Traits, Skills, Likes and dislikes, Career and Queue; Chores; object and person action menus; Options and its settings; Save, Load and New game; New housemate and Edit; Help; and every Build tool, catalogue, placement control, room review and confirmation dialog. Audit the source and running interface before calling this inventory complete, including keyboard-only controls and narrow-screen overflow.

The **Options > New housemate** subsection must show where Options sits on desktop and mobile, show the open menu with New housemate identified, and link to the character-creation instructions. Keep it distinct from Edit, which changes the selected person. Explain any disabled state using verified current rules.

References elsewhere must link directly to the relevant subsection: "Open [Options](./ui-elements/options/#options), then choose [New housemate](./ui-elements/options/#new-housemate)" is the intended published pattern. Every UI entry links back to tasks that use it, such as adding a person, checking a relationship or saving a household.

### The world: weather and seasons

Explain the current four-season cycle and where to read the season and weather in the clock. Show autumn leaves falling and resting on the ground, winter snowfall and a mild-weather comparison. Include desktop and mobile captures with captions that name the visible effect. Do not use earlier rejected brown-grass or snow-covered-looking lawn examples. Snow currently falls without accumulating; leaves disappear after a while. Reduced motion suppresses weather particles while retaining the weather text. Current seasons and weather do not change needs or mood.

Use this proposed player-facing note under **Weather > Coming soon**: "Sims will have preferences for warmer or cooler weather. Weather they enjoy will slightly improve their mood; weather they dislike will slightly lower it. More variation from month to month and year to year is also planned. These features are not available yet, and no release date has been announced."

Keep monthly variation explicitly future-facing: the current calendar has no months. Link weather preferences to Mood and personality, and link the clock reference to this page. Existing weather review captures may illustrate this proposal with their provenance recorded. Capture the accepted game revision afresh for publication; controlled weather captures must not imply a guaranteed event on a particular day.

### Hobbies: progression and future creations

Place the hobby explanation under **Mood and personality > Hobbies**, with links to each implemented activity. Add a clearly marked future section for gardening, knitting, painting and other creative hobbies. Explain personal satisfaction from progressing in hobbies, future home creations such as paintings, flowers and throw blankets, possible sales, and gardening's possible food-cost savings. Do not promise exact unlock levels, prices, crop yields, recipes or release dates. The authoritative requested scope is recorded in [the creative-hobbies roadmap](../../GAME-SYSTEMS.md#s-creative-hobbies-creative-hobbies-progression-and-things-made-at-home).

### Need page: Social

1. **What this means:** Social measures a person's need for company. It is separate from their opinion of a particular housemate.
2. **What to do:** chat, share a television or radio, eat together, or take part in eligible shared reading, exercise or aquarium watching. Link each activity's requirements.
3. **What must be true:** actual overlapping participation; the same device or dining table where required; separate suitable objects, proximity and preferences for other shared activities.
4. **Why it is not improving:** merely standing nearby, waiting, preparing food, eating standing, or using separate televisions does not supply the relevant shared benefit. Normal need loss continues during activities.
5. **What changes the benefit:** personal refill rates, feelings and family; additional people do not multiply the benefit indefinitely.
6. **Related questions:** "Does company make people friends?" and "Why did a conversation hurt their relationship?"

### Activity page: Wash hands

1. **How to start:** choose a person; open a sink's actions; choose Wash hands. Provide both mouse and touch instructions in the controls guide.
2. **Helps / costs:** Hygiene improves a little, only up to partial cleanliness. No direct Comfort effect; ordinary need loss continues.
3. **Requirements and what you should see:** reachable sink, available use position and an uninterrupted period of washing. Explain how to distinguish walking, waiting and washing using verified current game feedback. Do not invent a diagnostic indicator; when the game exposes no direct confirmation, give a practical observation instead.
4. **Limits:** repeated hand washing cannot replace a shower or bath, or clear the body-odor consequence. Put this beside the benefit, not inside optional details.
5. **Numbers:** show the Hygiene ceiling, rate and reference duration for each sink model, including normal loss and personal modifiers. Show exact object type first, model second when models differ.
6. **Next action:** a link to bathing and the Hygiene page.

Every activity uses the same fields: what starts it, requirements, what the player should see, direct need gains and costs, timing, interruptions, personal or object differences, relationship effects, and cases with no effect. Show "No direct need effect" where appropriate. A total paid after completion must not look like a rate paid while using an object.

### Relationship page: What changes feelings

1. Start with direction: one person liking another does not make the feeling mutual. In-game, select a person, open Sim details, then People to see that person's feelings.
2. Group examples into improving feelings, harming feelings, and changes over time. Every entry names whose opinion changes and toward whom.
3. Put conditions and counterexamples beside each result. For example, finishing somebody else's prepared meal can improve the eater's opinion of the cook; standing eating still grants appreciation but does not supply seated-meal Social.
4. Include completed chats and disliked topics, passive contact, shared activities, opposed preferences, privacy incidents, poorly timed conversations, dishes and blocked seats, completed or missed chores, nuisance from disliked activities, fights, and movement toward neutral over time.
5. Explain that need relief, temporary mood, feelings, family ties and life satisfaction are separate outcomes. Avoid promising friendship whenever Social rises.
6. Provide optional exact values with direction, timing, modifiers and limits. Pair rates with game-time units; never describe an internal tick without explaining it.

### Supporting page: Why a benefit did not happen

Offer a short sequence: check the activity actually started, check its required object or company, check the limit, then check timing and interruptions. Each check must name the visible game feedback or a practical observation available to the player. Link to the matching activity instead of maintaining a second list of exceptions. Include blocked access and missing or occupied furniture. Keep explicit player-order priority and death consequences visible in Start here and the control reference.

## Navigation and interaction

1. Add **Player guide** beside the Changelog site's existing Play and theme controls. Keep `/terrilives/` as the game, `/terrilives/changelog/` as its history, and publish the guide at `/terrilives/guide/`. Link back to both from every guide page.
2. Add **Player guide (opens in a new tab)** in Options next to Help and Changelog, and **Read the full player guide** in the existing Help dialog. Preserve the short Help dialog for quick control instructions. The game already pauses for Help; do not claim that an Options external link pauses it. The proposed link label adds "Pause first if you want the household to wait." Do not silently change simulation pause behavior as part of documentation work.
3. Use the changelog's shared header, responsive navigation and native accordion treatment for the guide index. Give longer chapters their own pages with local contents and clear links back to the guide. Keep search on every page and keep section navigation available on phones. The approval mock-up puts representative chapters in one file for review; it does not require loading the complete finished guide as one long page.
4. Search matches titles, questions, activity labels, object types and authored synonyms such as "lonely", "smelly" and "angry". Results show the matching answer excerpt and destination. Empty results offer the full section list and Clear search. Activities also support need and outcome filters, including harms and no direct benefit.
5. Use real pages with stable addresses and heading links. Browser Back restores the prior page and search. No-JavaScript reading and navigation remain available; a visible topic index replaces interactive search when scripting is unavailable.
   Give every topic and useful subsection an explicit stable anchor. Link UI names to their UI elements entries and mechanics to their fuller explanations at the point of mention. Include local contents and copyable section links. Cross-page links must open a collapsed destination, scroll its heading into view and move keyboard focus appropriately. Preserve aliases when headings change. Validate every page-and-fragment link in the build. Avoid repeating a link on every occurrence within the same short paragraph.
6. Use an explicit **Numbers and limits** disclosure. On desktop, a short nonessential numeric preview may also appear on hover or focus; click, tap, Enter and Space open the same information persistently. Never hide a requirement, safety consequence, or exception behind hover. Escape dismisses any floating preview; it stays available while hovered and does not cover its trigger. The disclosure itself needs no floating preview to work.
7. Reuse the actual changelog visual system: header layout, flower branding, typography, spacing, surfaces, borders, accordions and the sun/moon light-dark toggle. Do not substitute a text-only theme button or invent a separate card style. Preserve its dark default and saved theme preference. Use visible keyboard focus, semantic headings, text labels for benefits and costs, readable contrast, 44-pixel controls, and layouts that reflow at 320 CSS pixels and 200% zoom. Do not rely on color to explain a relationship outcome.

## One authored source

Recommended location after approval:

```text
docs/player/
  navigation.json
  start-here.md
  ui-elements/*.md
  images/ui-elements/{desktop,mobile}/*
  the-world/{calendar,weather-and-seasons}.md
  images/the-world/*
  needs/overview.md
  needs/{hunger,energy,hygiene,bladder,social,fun,comfort}.md
  activities/*.md
  relationships/*.md
  mood-and-personality/*.md
  home-and-controls/*.md
  glossary.md
  changelog/*.md
  effects.json
```

Markdown alone owns player explanations, condition wording, qualitative descriptions and marked quick-help excerpts. `navigation.json` owns section order and stable slugs. `effects.json` maps stable gameplay IDs to article anchors, exported numerical references and the source files requiring review. Its review metadata identifies the explanatory passage and its comparison basis; it does not copy the passage or its condition wording. Gameplay content and runtime logic remain authoritative for behavior.

For example, `activities/wash-hands.md` authors "Hand washing cannot replace bathing" and includes a numeric reference such as `{{number:handwashing.hygiene_ceiling}}` in its optional details. The mapping names that article, the hand-washing action IDs and the `handwashing.hygiene_ceiling` export, but contains neither the sentence nor the value 40. The exporter reads the existing tuning value, and the renderer inserts it with its unit. Generated need indexes link to this article and reuse explicitly marked summaries rather than authoring a second account. Tests compare output with the source value and separately test the runtime cap; they do not create a third maintained balance table.

Migrate `docs/changelog/` into `docs/player/changelog/` once, keeping filenames, content and existing public URLs and anchors. Update its generator, tests, path classifier, authoring guide and maintenance skill mirrors together. Move the player portions of the mixed glossary into the new source; retain internal terminology separately with links. Keep `NEEDS-INTERACTIONS.md` and `SIM-RELATIONSHIPS.md` as engineering contracts and evidence maps, removing duplicated player prose as it migrates. Fix conflicting status claims during that migration.

The existing in-game Help markup becomes a generated view of marked quick-help excerpts from the same Markdown. Keep dialog behavior, shortcuts and controls in their existing code. The complete online articles and brief in-game instructions can have different lengths without being separately authored. Generated HTML, search indexes and numeric snapshots are build products, not editable sources.

**Alternative considered:** leave changelog in its current folder and aggregate it through one publication manifest. This also avoids duplicate content and has a smaller migration. I recommend moving it because one physical authoring location is easier to explain to contributors, but relocation is an organizational choice, not a technical requirement. Approval of this proposal includes that path migration and its consumer updates; retaining the existing path is a viable revision. **Rejected:** publishing internal Markdown unchanged. It mixes formulas, engineering vocabulary and planned behavior with current player instructions.

## Completeness and numerical accuracy

Before calling the guide complete, make an internal coverage ledger. Enumerate ordinary actions, food chains, conversations, reading and book effects, secondary seats, contextual company, baseline need loss, personality modifiers, caps, failure and interruption paths, conditions, work and sleep. Record no-effect cases explicitly. Inventory every runtime source of relationship changes, including direct writes that may bypass diagnostics.

Use `RelationshipCause` as a starting checklist, not proof that every effect has been captured. At the inspected revision it names conversation, low/critical-need interruption, privacy entry/start, proximity, shared activity, incompatibility, decay, mess, fulfilled/neglected chores, nuisance, fights and shared meals. For each cause, inspect both direction and eligibility branches. Tie every ledger row to a public article and a source/test reference; do not expose file paths or test names in player pages.

Generate baseline numerical data through a small Rust exporter using the existing content compiler and dependencies. Use runtime helpers where they own calculations; give special-case formulas named verified exporters or fixtures rather than reimplementing them in browser JavaScript. The site renderer consumes the resulting JSON. No dependency installation or upgrade is proposed. If implementation reveals a parser or compiler requirement that cannot be met with existing dependencies, bring that specific choice back for approval.

To preserve lightweight documentation-only validation, commit a generated numerical snapshot under `docs/player/generated/` with its source fingerprints. It is machine-produced data, never a place to edit values. Any change to the snapshot, exporter, export configuration or its source inputs requires Rust exporter regeneration and byte-for-byte comparison. Test that editing only a snapshot value fails even when its recorded source fingerprints are unchanged. Only prose/navigation changes with an unchanged verified snapshot use Node-only validation. Pages continues to build the combined game and site. This separates prose checks from compiling the simulation without making the snapshot authoritative for gameplay.

Every optional number identifies its unit, whether it is a rate or a completed-action total, reference duration, relevant cap, and modifiers. State that positive rewards are baseline values before personal modifiers and ordinary need loss; they are not guaranteed final meter changes. Different furniture models stay distinct. Food, ordinary actions, conversations and friendship do not share one invented scale.

Use restrained qualitative language such as "a little" or "a substantial amount" only where reviewed examples justify it. Each strength description maps to the relevant exported effect and a recorded comparison basis. A changed value or condition invalidates that review until the description is checked. Prefer explaining the concrete result, such as "cannot replace bathing", over choosing a dramatic adjective. Magnitude thresholds and any exact wording remain editorial choices for approval, not new balance rules.

## Publishing and keeping it current

Extend the current static renderer and Vite integration. The same build emits the game, `/guide/` pages, and `/changelog/`; none of the guide pages requires the game renderer, WebGPU, an external account or a network service. Use escaped Markdown with a deliberately documented small syntax and explicit numeric references. Do not accept arbitrary executable Markdown.

Extend `.github/scripts/changes.py` so additions, edits, deletions and renames anywhere in the player source trigger site validation and publication. Preserve separate tested histories for game code and published content. General engineering Markdown must keep its existing no-deploy behavior. Extend the existing lightweight `changelog` validation job to validate both guide and changelog, retaining its job name initially so the workflow's success-history queries do not silently lose their reference point.

Keep the existing Pages sequence: successful main validation, checkout of the exact tested revision, combined artifact build, required-output checks and the stale-release guard. Include guide sources and generated-output inputs in the site's comparison. Verify docs-only merges trigger publication and an older build cannot overwrite newer guide edits. Keep the existing owner-authorized exact-revision manual publication route. A local build is not publication evidence.

Update `AGENTS.md`, the applicable skill mirrors, the pull-request template and an authoring guide with a same-change obligation: when behavior changes, update affected player pages and the effect mapping, or state a concrete reason why no player documentation changes. Continue the separate public changelog requirement. Require reviewers to compare behavior against the relevant article, including the absence of promised effects.

Automated checks should reject missing action/cause mappings, duplicate slugs, broken links, invalid numeric references, stale exported values and unsupported markup. Begin freshness enforcement with a conservative file-level review map covering content files and the simulation modules for delivery, company, interaction execution, relationships, domestic work, privacy, needs, personality, skills, conditions, death and saves. Changes anywhere in those files require an explicit documentation review record, even when numerical output is unchanged. New simulation source files require classification. Enumerated action and cause IDs independently catch additions and removals.

Use file fingerprints as review triggers, not a claim to understand source dependencies. The record identifies the changed files, affected articles and either the documentation changes or a specific no-change reason for review. A reviewer judges correctness; updating a fingerprint does not prove correct prose. Test removal of a mapping, a changed cap, and an eligibility-helper change with unchanged callers and numbers. Avoid building a partial dependency analyzer for the initial guide.

## Implementation sequence after approval

1. **Audit and author:** build the coverage ledger, reconcile stale internal claims, verify current labels and mechanics, and draft the complete activity and relationship references. Review representative prose before extending it across the guide.
2. **Unify sources:** establish the player directory, migrate changelog and player glossary material, mark quick-help excerpts, and connect the numerical exporter and effect mappings. Preserve old public links. Update every consumer of migrated paths.
3. **Build the reading experience:** implement the shared shell, static pages, local search, need/outcome filters, cross-links, optional numeric details and responsive navigation. Generate the in-game Help excerpts and add the guide entry links.
4. **Protect publication and maintenance:** extend classification, validation, Pages output checks, source-change review requirements and contributor instructions. Test docs-only publication routing and stale-artifact protection.
5. **Verify and deliver when authorized:** test the changed renderer, exporter, links, Help and workflow paths; run relevant type checks and builds. Inspect desktop and phone views in both themes, keyboard and touch interaction, zoom, no-script reading, empty search and Back navigation. Obtain fresh novice and visual reviews. Complete the changelog and approved delivery workflow before claiming publication.

## Acceptance exercises

| A new player asks | Required answer or action |
| --- | --- |
| "They are hungry. What do I do?" | Use only the guide to start an available food action in the game, recognize preparation versus eating, and observe the point when relief arrives. |
| "Why are they lonely beside the television?" | Use only the guide to arrange both people using the same device, distinguish walking from active participation, and observe Social during shared use. |
| "Why will washing hands not make them clean?" | See the partial-cleanliness limit and a link to bathing. |
| "Why did dinner not improve Social?" | Distinguish standing eating, shared seated company and appreciation toward the cook. |
| "Why does Alex dislike Sam when Sam likes Alex?" | Read the direction of each person's feelings and find which actions help or harm them. |
| "Does a fight help Social?" | See that fights refill no need and harm both participants' feelings when completed. |
| "Why is the meter falling during an activity?" | Find ongoing need loss, partial benefits, caps and interrupted/completion timing. |
| "How do I see the numbers on my phone?" | Open the same labeled disclosure available to mouse and keyboard users. |
| "I cannot find what I typed." | Clear search and browse complete topics; no dead end or blank page. |

## Evidence and boundaries

Planning inspection: October 19, 2026, source revision `a15d543d6f3077c9760e16b5b695514550c781e7`, equal to fetched `origin/main` at inspection. The checkout began clean and detached. Issue #313 had no comments when read.

Read `docs/NEEDS-INTERACTIONS.md`, `docs/SIM-RELATIONSHIPS.md`, `docs/changelog.md`, the player-string inventory, relevant glossary and lesson sections, fight and meal-appreciation specifications, current content/tuning, relationship causes, company scaling, Help markup, and publication integration. This is enough to propose the structure; it is not a complete runtime audit.

Observed drift to resolve during implementation: the relationship overview lacks the implemented Fight effect, and comments in `content/social.toml` say disliked company supplies no Social while current company scaling and the needs contract provide a positive benefit. The meal-appreciation specification also retains "For confirmation" language beside behavior now present in runtime and tuning. Do not use a specification's draft status as proof of what is live.

Approval requested for the navigation, central source and migration, disclosure design, page templates, coverage approach and implementation sequence. Example prose and layouts are proposed. Approval of this package does not claim that the full inventory is audited or authorize unrelated gameplay changes. The owner's October 19 revision requires the full UI screenshot reference, direct subsection links, weather coverage, future-feature notes and reuse of the changelog visual style. Review explanations belong outside the player-facing preview; the preview itself must contain meaningful proposed player copy, not filler.
