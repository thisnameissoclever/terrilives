---
name: natural-causes-writing-style
description: Write, rewrite, or review prose for Natural Causes in the terrilives project. Apply to game copy, object types and model names, flavor text, controls, documentation, comments, and project discussions. Keep meaning clear; use dry wit, cynicism, and silliness where they cannot obscure function.
---

# Natural Causes writing style

Natural Causes is a dark-comedy life sim about people getting through ordinary life. Write with a clear eye for its petty indignities, unreliable promises, and domestic absurdity. Let affection for the people survive the cynicism. A washing machine is still a washing machine, even if its manufacturer has opinions about eternity.

This skill applies only to this project, whose internal name is `terrilives`. Apply its clarity rules to every piece of prose, including a single label or sentence. Humor is optional. Comprehension is required.

## Meaning before personality

Write what you mean in plain, specific language. Prefer short wording when it preserves every important fact. Explain an unfamiliar term before or alongside its first use. Expanding an acronym is not enough if the expansion still tells the reader nothing.

Use one term for one meaning throughout a surface. Repeat it instead of rotating synonyms for variety. Keep established technical names, identifiers, and configuration keys exact; vocabulary restrictions target vague usage, not correct technical terms. Use the game's title in player-facing prose and the internal project name where technically necessary.

Never use existing game copy or object names as a style exemplar. They are material to review and potentially replace. Read existing content only to establish what an object or action actually does, what a reference identifies, and which facts a rewrite must preserve. Previous approval of one name does not establish the voice for every other object.

## Voice and comic judgment

Use conversational, observant prose with dry sardonic wit, a little cynicism, and occasional silliness. The narrator understands why someone bought the appliance and doubts the brochure. Humor should depend on this particular object or situation: laundry returning, a chair becoming a permanent residence, or an employer confusing attendance with enthusiasm.

1. Aim cynicism at sales promises, bureaucracy, domestic repetition, and the gap between ambition and an ordinary Tuesday. Let people have dignity; avoid sneering at the player or treating hardship as proof of stupidity.
2. Prefer a precise observation, restrained understatement, or small absurd detail. Give the reader room to notice the joke. Do not announce, explain, or congratulate it.
3. Let silly details be understandable on first reading. Random words, inverted nouns, obscure references, and elaborate euphemisms do not become funny merely by being unusual.
4. Leave some text entirely sincere. A joke in every sentence becomes another chore. Repeated feedback needs even more restraint because the player may read it hundreds of times.
5. Avoid stock joke frames such as things in trench coats, funny hats, "with extra steps," or "for maximum chaos." Write a joke that belongs to the subject, or omit it.
6. Use profanity sparingly when the context earns it. Swearing cannot supply missing meaning or stand in for a joke.

If a joke makes the reader pause to work out what something is, what happens next, or what a number means, move it into optional flavor text or remove it. A reader should never need the joke explained to operate the game.

## Product identity and purchase decisions

Object descriptions are product copy. Tell the player about this particular model's construction, character, relative quality, and useful distinctions. They appear in both the object menu and the store. A name or description that could be pasted onto every competing model is not doing enough work.

| Element | Purpose | Rule |
| --- | --- | --- |
| Category | Broad family and authored defaults | Usually hidden. Seating can contain Armchair, Sofa, Dining chair, Office chair, and Ottoman. Other supplies no accidental actions. |
| Type | Familiar physical kind | Primary visible identification. Kitchen sink and Bunk bed are types. Reading chair is a specialization of an Armchair model. |
| Model | Specific purchasable product | Secondary name, with its own appearance, price, actions, benefits, and trade-offs. Basic and Standard can convey quality; an isolated verb such as Soak does not identify a product well. |
| Description | Product character and reasons to choose it | Give specific, meaningful distinctions. Allow a restrained joke or observation when it belongs to the product. Do not force a punchline or substitute a generic action summary. |
| Room associations | Store organization | A model can belong to several rooms. Office is a room association. Associations never restrict placement or grant actions. |

Bunk bed remains a type because stacked sleeping places have distinct physical layout and access. It can have many models and share sleeping behavior with ordinary beds. Type names describe what the object physically is; a model identifies the product; a specialization explains what it does particularly well.

More expensive need not mean better at everything. A higher price needs an advantage, which can involve comfort, capacity, speed, convenience, or a clearly identified cosmetic premium. Preserve real trade-offs. Never infer every statistic from one quality rating.

Descriptions must not list temporary technical limitations, say that functionality is not implemented yet, or act as a development tracker. A description such as "The upper bunk is not usable yet" belongs in development documentation. Keep actual usable capacity, requirements, costs, and other material buying facts in plain functional details beside the flavor text. Neither prose nor numerical details may promise an unimplemented bonus.

The owner's examples Basic, Standard, Dingy, Soakster 9,001, and Lilu Dallas illustrate readable quality cues and optional silliness. They are not automatic approvals of final copy. The proposed Lilu Dallas shower illustrates a premium model with inherited and unique actions, not an existing product claim.

### Presentation

Show the type prominently and the model name secondarily. Click or tap the identity control, or activate it with Enter or Space, to reveal the description. Hover and focus alone do not reveal it. Keep keyboard focus visible and the control's accessible label descriptive. Actions below the identity block use literal verbs.

Use stable model IDs for program behavior. A shared type label cannot identify a unique model. Category inheritance, store filters, and room associations are different concerns; a change to store organization must not silently change gameplay.

### Drafting model copy

1. Inspect the model's art and resolved gameplay values before writing.
2. State its intended quality, strongest reason to buy it, and meaningful trade-off in the review table.
3. Draft a model name and a short product description that fit those facts. Avoid a mandatory sentence pattern or joke quota.
4. Compare the draft with other models of the same type. Remove vague claims that fail to distinguish the product.
5. Show type, model, description, and functional buying details together for the owner's review before publication.

## Match the surface

| Surface | Treatment |
| --- | --- |
| Object types, action labels, navigation, buttons, status labels | Literal, consistent, immediately recognizable. Use ordinary nouns and action verbs. |
| Errors, destructive confirmations, saving, loading, recovery instructions | State what happened, what is affected, and what the player can do. Omit jokes that distract from consequences or recovery. |
| Model names, optional object descriptions, shop flavor | Main home for wit, cynicism, and silliness. Keep factual buying information distinct and clear. |
| Authored narrative and character text | Allow personality appropriate to the speaker and situation while preserving understandable events and consequences. |
| Help and tutorials | Explain the action and result directly. Keep necessary instructions understandable without any comic aside. |
| Documentation, comments, reports, and project discussions | Use the same precise voice. An occasional dry observation can help; commands, constraints, evidence, and technical explanations must stand on their own. |

Apply writing quality everywhere. Vary the amount of humor with the job the text must do. Chat response-ending conventions belong to project discussions, not game labels or character dialogue.

## Prose discipline

1. Use active sentences and concrete nouns. Name the actor, action, and consequence instead of declaring that something is important, powerful, or improved.
2. Never author an em dash (U+2014) or en dash (U+2013). Use a comma, colon, semicolon, parentheses, period, or spaced ordinary hyphen. Preserve text explicitly requested unchanged and verbatim quotations; an explicit request for either character also takes precedence.
3. Avoid inflated vocabulary and stock phrases such as "delve," "tapestry," "pivotal," "leverage," "seamless," and "unlock potential." Preserve exact technical usage where the term is necessary and explained.
4. Remove canned praise, reflexive agreement, scripted empathy, tutorial introductions, fake suspense, and self-answered rhetorical questions. Begin with the useful point.
5. Avoid "It's not X, it's Y," "No X. Just Y," advertising fragments, and dramatic sentence fragments used to manufacture significance. State the actual observation.
6. Do not pad lists to three items, invent a spectrum between unrelated things, stack hedges, or add a concluding paraphrase to a short passage. Keep qualifications that change the meaning.
7. Give each paragraph one main idea, usually in one to four sentences. Let Markdown renderers wrap paragraphs rather than inserting hard line breaks. Use headings and tables only when they help navigation or comparison; number actual lists of options, findings, and steps.
8. Distinguish implemented behavior, proposed behavior, observed evidence, and opinion. A witty claim still needs to be true when it describes how the game works.

Fictional advertising may contain recognizable bluster when that is the specific joke. Keep it in optional flavor text and make the actual gameplay facts clear. This does not excuse generic promotional language in documentation or misleading product information in the shop.

## Drafting and review

Before writing, identify the surface and the reader's immediate task. For product copy, review the art, quality, trade-offs, and resolved gameplay values together. Supply type, model name, description, and buying details for review. Humor is optional; product identity is not.

Before delivering:

1. Can a new player identify the object or action without understanding a joke, opening a tooltip, or knowing the game's lore?
2. Is the type primary, the model name secondary, and the description optional to basic recognition? Can keyboard and touch users reach proposed detail text?
3. Are all functional claims supported by the actual behavior? Are needed costs, limits, and consequences visible at the decision point?
4. Does each joke belong to this object or situation? Would removing it make the text clearer? If so, remove or relocate it.
5. Are terms consistent and unfamiliar terms explained? Have the facts, identifiers, uncertainty, and approved meaning survived the rewrite?
6. Have prohibited dashes, filler, canned phrasing, repeated punchline structures, and unsupported claims been removed?
7. Is example or proposed copy clearly distinguished from approved copy and shipped behavior?

For rewrites, preserve unaffected facts and constraints. Do not use this skill as permission for unrelated copy changes, schema migrations, interface implementation, or publication. The owner reviews proposed model names and descriptions before publication. Approval of this guidance does not approve later replacement copy. See [the string inventory](../../../docs/player-visible-strings.md) and lesson L58 in [lessons learned](../../../docs/lessons-learned.md).

## Project integration

The repository's [AGENTS.md](../../../AGENTS.md) requires reading this skill for project prose. Use it alongside the available global `my-writing-style` and `unslop` skills. Their general cleanup rules remain useful; the project-specific humor and object hierarchy here supply the owner's requested direction. Retain applicable repository attribution, reply-ending, and workflow rules. This skill does not install global settings or hooks, and makes no claim of automated enforcement.
