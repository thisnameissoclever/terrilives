import { expect, it } from 'vitest';
import { socialMenuEntries } from '../src/ui/object-menu.js';

it('offers Fight as the second row over a person, sending interaction 1', () => {
  const menu = socialMenuEntries('Casey', ['Chat', 'Fight'], 8);
  expect(menu.title).toBe('Casey');
  expect(menu.entries.slice(0, 2)).toEqual([
    { label: 'Chat', action: { kind: 'talk', target: 8, interaction: 0 } },
    { label: 'Fight', action: { kind: 'talk', target: 8, interaction: 1 } },
  ]);
  expect(menu.entries[2]?.label).toBe('Nothing');
});
