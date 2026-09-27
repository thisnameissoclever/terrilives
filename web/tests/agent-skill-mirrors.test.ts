import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);

/** Skill directories only: a stray README or .DS_Store is not a skill. */
function skills(root: string): string[] {
  return readdirSync(new URL(`${root}/skills/`, ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function skill(root: string, name: string): string {
  return readFileSync(new URL(`${root}/skills/${name}/SKILL.md`, ROOT), 'utf8');
}

/**
 * Codex reads skills from `.agents/skills/`, Claude Code from
 * `.claude/skills/`. The two copies are hand-maintained mirrors, and the
 * drift they hide is a fix made in one copy and not the other, or a blind
 * find-and-replace that renamed a real path: the first Codex copy pointed at
 * a nonexistent `.Codex/launch.json` for exactly that reason.
 */
/**
 * The skills tied to a tool, each with the wording its two copies differ by:
 * the Codex phrase and the Claude Code one. A skill absent from here names
 * neither tool, so its two copies must be identical byte for byte. Keeping
 * the pair per skill rather than one phrase for all of them lets a second
 * tool-tied skill word its difference differently.
 */
const TOOL_TIED: ReadonlyMap<string, readonly [string, string]> = new Map([
  ['cloud-run', ['Codex on the web', 'Claude Code on the web'] as const],
]);

/** Every way either tool is named, so an unlisted skill can be held to naming none. */
const TOOL_WORDS = ['Codex', 'Claude Code'];

describe('agent skill mirrors', () => {
  const codexSkills = skills('.agents');
  const claudeSkills = skills('.claude');

  it('mirrors at least one skill, so the checks below cannot pass empty', () => {
    expect(codexSkills.length).toBeGreaterThan(0);
  });

  it('gives every skill a copy for both tools', () => {
    // Checked from both sides: a skill added for one tool only, or a mirror
    // deleted while others remain, would otherwise pass unnoticed.
    expect(codexSkills).toEqual(claudeSkills);
  });

  for (const name of codexSkills) {
    const pair = TOOL_TIED.get(name);
    it(`keeps ${name} ${pair ? 'identical apart from the tool it names' : 'byte-identical'}`, () => {
      const codex = skill('.agents', name);
      if (pair) {
        // Catches the Claude Code text pasted over the Codex copy, which the
        // comparison below would let through.
        expect(codex).toContain(pair[0]);
        expect(codex.replaceAll(pair[0], pair[1])).toBe(skill('.claude', name));
      } else {
        // A skill that names a tool at all must be listed in TOOL_TIED with
        // the wording its copies differ by, or the two are compared as
        // though neither named one.
        for (const word of TOOL_WORDS) expect(codex).not.toContain(word);
        expect(codex).toBe(skill('.claude', name));
      }
    });
  }

  it('keeps runtime-specific wording in the cloud-run skill', () => {
    expect(skill('.agents', 'cloud-run')).toContain('Codex on the web');
    expect(skill('.claude', 'cloud-run')).toContain('Claude Code on the web');
  });

  it('lists only skills that exist', () => {
    for (const name of TOOL_TIED.keys()) expect(codexSkills).toContain(name);
  });
});
