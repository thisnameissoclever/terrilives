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

## Object identity: type, name, description

Author three distinct pieces of text for each object model. This is the required content direction for future copy work, not a claim that the current data format or interface already has these fields.

| Element | Purpose | Rule |
| --- | --- | --- |
| Type | Tell the player what the object is | Use an ordinary, recognizable noun such as **Washing machine**. Make it the primary identification wherever the player selects, buys, or acts on the object. |
| Name | Identify the particular model | A secondary model or product name may be witty, silly, or cynical. Keep it readable alongside the type. Never make the player decode it to recognize the object. |
| Description / flavor text | Explain the object and give it personality | Supply useful context where needed, then allow a short joke or observation. Preserve true capabilities and limits. Do not invent mechanics to support the joke. |

**Washing machine** is the type. **Perpetual Cycle** is a possible model name supplied by the owner, not a substitute for the type or final approved copy. Different models can share a type; their model names distinguish them.

Use ordinary word order. A model name should read like a plausible product name, even an absurd one. Category-first or inverted naming must not force the player to reconstruct a familiar household noun.

Keep facts that affect a decision visible where the decision is made. Price, requirements, capacity, effects, and limitations belong in clear text or labeled values when the game actually implements them. Optional flavor text must not be the only place a player can discover a cost or consequence. A joke about lost socks must not imply an implemented sock-loss mechanic.

### Presentation direction

In an object's right-click menu, make the **type** visually dominant. The smaller, subtler **model name** can sit above it. Subtler means secondary emphasis, not text too faint or small to read. A small arrow or disclosure indicator to the right of the name can reveal the description on hover. These are the owner's proposed presentation details; this skill records them without implementing the interface.

The description must also be reachable by keyboard focus or activation and by touch. Give the disclosure a clear accessible label; an arrow alone cannot explain its purpose to every player. Keep the type available in accessible identification as well as visually. Use the same distinction in the shop and future inspection surfaces. If space is limited, retain the type before the model name; omit optional flavor before obscuring function.

Action rows beneath the identity block use literal verbs. The name of an object and the action performed on it are separate concepts. Neither needs to carry the other's joke.

### Draft examples

These are newly written tone demonstrations, not approved replacements or claims about implemented gameplay. Verify actual capabilities before adapting any example for use.

| Type | Possible model name | Possible description / flavor text |
| --- | --- | --- |
| Washing machine | Perpetual Cycle | Washes clothes. The laundry will return; it has very few other plans. |
| Armchair | Staying In | An armchair for sitting and reading. Your evening plans fit comfortably between the armrests. |
| Dining table | Visiting Hours | A table for meals and company. Guests may interpret the chairs as encouragement. |

The functional sentence may be omitted when it only repeats an obvious type and adds no useful information. Keep it when a distinction matters. Usually one or two sentences are enough; do not force every description into the same setup-and-punchline pattern.

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

Before writing, identify the surface, the reader's immediate task, and the facts they need. Write that meaning plainly first. Add humor only where it survives the clarity check. For object copy, supply the type, model name, and description together so the hierarchy can be reviewed.

Before delivering:

1. Can a new player identify the object or action without understanding a joke, opening a tooltip, or knowing the game's lore?
2. Is the type primary, the model name secondary, and the description optional to basic recognition? Can keyboard and touch users reach proposed detail text?
3. Are all functional claims supported by the actual behavior? Are needed costs, limits, and consequences visible at the decision point?
4. Does each joke belong to this object or situation? Would removing it make the text clearer? If so, remove or relocate it.
5. Are terms consistent and unfamiliar terms explained? Have the facts, identifiers, uncertainty, and approved meaning survived the rewrite?
6. Have prohibited dashes, filler, canned phrasing, repeated punchline structures, and unsupported claims been removed?
7. Is example or proposed copy clearly distinguished from approved copy and shipped behavior?

For rewrites, preserve unaffected facts and constraints. Do not use this skill as permission for unrelated copy changes, schema migrations, interface implementation, or publication. Drafting the skill establishes writing direction; the broader voice pass and individual game replacements still follow the owner's review boundary in [the string inventory](../../../docs/player-visible-strings.md) and lesson L58 in [lessons learned](../../../docs/lessons-learned.md).

## Project integration

The repository's [AGENTS.md](../../../AGENTS.md) requires reading this skill for project prose. Use it alongside the available global `my-writing-style` and `unslop` skills. Their general cleanup rules remain useful; the project-specific humor and object hierarchy here supply the owner's requested direction. Retain applicable repository attribution, reply-ending, and workflow rules. This skill does not install global settings or hooks, and makes no claim of automated enforcement.
