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
 * `.claude/skills/`. The two copies are hand-maintained mirrors, and the only
 * intended difference is which tool the description names. Anything else is
 * drift: a fix made in one copy and not the other, or a blind find-and-replace
 * that renamed a real path. The first Codex copy pointed at a nonexistent
 * `.Codex/launch.json` for exactly that reason.
 */
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
    it(`keeps ${name} identical apart from the tool it names`, () => {
      const codex = skill('.agents', name);
      expect(codex.replaceAll('Codex on the web', 'Claude Code on the web')).toBe(
        skill('.claude', name),
      );
    });
  }

  it('keeps runtime-specific wording in the cloud-run skill', () => {
    expect(skill('.agents', 'cloud-run')).toContain('Codex on the web');
    expect(skill('.claude', 'cloud-run')).toContain('Claude Code on the web');
  });
});
