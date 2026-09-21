import { readdirSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);

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
  const mirrored = readdirSync(new URL('.agents/skills/', ROOT));

  it('mirrors at least one skill, so the checks below cannot pass empty', () => {
    expect(mirrored.length).toBeGreaterThan(0);
  });

  for (const name of mirrored) {
    it(`keeps ${name} identical apart from the tool it names`, () => {
      const codex = skill('.agents', name);
      expect(codex).toContain('Codex on the web');
      expect(codex.replaceAll('Codex on the web', 'Claude Code on the web')).toBe(
        skill('.claude', name),
      );
    });
  }
});
