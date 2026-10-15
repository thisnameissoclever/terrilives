import { AppearanceDraft, colorFields } from './appearance.js';

type ColorField = typeof colorFields[number];
export interface StoredProofDraft {
  draft: AppearanceDraft;
  sourceColors: readonly ColorField[];
  previousSourceColors: readonly ColorField[] | null;
}

function sourceFields(value: unknown): readonly ColorField[] {
  if (value === true) return [...colorFields];
  if (value === false || value === undefined) return [];
  if (!Array.isArray(value) || new Set(value).size !== value.length
    || !value.every(field => typeof field === 'string' && (colorFields as readonly string[]).includes(field))) {
    throw new Error('Invalid source-material regions');
  }
  return [...value] as ColorField[];
}

/** Only an absent key creates a new draft. Invalid saved bytes never consume a seed. */
export function loadProofDraft(text: string | null, nextSeed: () => number): StoredProofDraft {
  if (text === null) return { draft: new AppearanceDraft(nextSeed()), sourceColors: [], previousSourceColors: null };
  const draft = AppearanceDraft.restore(text), data = JSON.parse(text);
  return { draft, sourceColors: sourceFields(data.sourceMaterials),
    previousSourceColors: data.previousSourceMaterials == null ? null : sourceFields(data.previousSourceMaterials) };
}
