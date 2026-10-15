import { expect, it, vi } from 'vitest';
import { AppearanceDraft } from '../src/render/character/appearance.js';
import { loadProofDraft } from '../src/render/character/draft-storage.js';

it('distinguishes missing storage from an empty or invalid saved record without rerolling', () => {
  const seed=vi.fn(()=>17);
  for(const text of ['', 'null', '{}', '{"draftVersion":99}'])expect(()=>loadProofDraft(text,seed)).toThrow();
  expect(seed).not.toHaveBeenCalled();
  expect(loadProofDraft(null,seed).draft.value.version).toBe(1);
  expect(seed).toHaveBeenCalledOnce();
});

it('restores exact appearance and material overrides without making a random draw', () => {
  const source=new AppearanceDraft(31),seed=vi.fn(()=>1);
  source.locks.add('height');
  const text=JSON.stringify({...JSON.parse(source.serialize()),sourceMaterials:['hair','shoes'],previousSourceMaterials:['skin']});
  const restored=loadProofDraft(text,seed);
  expect(restored.draft.serialize()).toBe(source.serialize());
  expect(restored.sourceColors).toEqual(['hair','shoes']);
  expect(restored.previousSourceColors).toEqual(['skin']);
  expect(seed).not.toHaveBeenCalled();
});
