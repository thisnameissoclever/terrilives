import { expect, it } from 'vitest';
import type { ModelFacts } from '../src/books/codec.js';
import { modelFactsLabel } from '../src/ui/buy-tool-controls.js';
const names = ['hunger', 'energy', 'hygiene', 'bladder', 'social', 'fun', 'comfort'];
const model: ModelFacts = { definition: 0, id: 'chair', typeLabel: 'Armchair', modelName: 'Example', description: '', typeId: 'armchair', categoryId: 'seating', categoryLabel: 'Seating', rooms: [], width: 1, depth: 1, shelfCapacity: 0, shelfAccessPoints: 0, sessionTicks: 60, actions: [], roles: [] };
it('separates required cooking hardware from optional seated dining and counter fallback', () => {
  const text = modelFactsLabel({ ...model, actions: [{ id: 'cook_dinner', label: 'Cook dinner', durationTicks: 330, capacity: 1, reading: false, benefits: [[0, 70]], satisfactionPoints: 0.003, readingBenefits: [], requirements: ['cold_storage', 'hob', 'prep_surface'], workKind: 'recipe', optionalRequirements: ['dining_seat', 'meal_table'] }] }, names);
  expect(text).toContain('Requires: Fridge, Stove, Preparation counter.');
  expect(text).toContain('Optional seating: Reachable dining chairs, Dining table.');
  expect(text).toContain('Without seating, eat beside a preparation counter.');
  expect(text).not.toContain('Requires: Dining table');
});
it('keeps small satisfaction gains visible without listing zero gains or developer units', () => {
  const text = modelFactsLabel({ ...model, actions: [{ id: 'sit', label: 'Sit', durationTicks: 41, capacity: 1, reading: false, benefits: [[6, 29], [5, 0]], satisfactionPoints: 0.000003, readingBenefits: [], requirements: [], workKind: 'ordinary', optionalRequirements: [] }] }, names);
  expect(text).toContain('1 user at once; about 41 minutes');
  expect(text).toContain('Comfort +29');
  expect(text).toContain('life satisfaction +0.000003 points');
  expect(text).not.toContain('Fun');
  expect(text).not.toContain('base work');
});
it('separates shelf homes, collection contacts and readers elsewhere', () => {
  const text = modelFactsLabel({ ...model, shelfCapacity: 24, shelfAccessPoints: 1, actions: [{ id: 'read', label: 'Read a book', durationTicks: 60, capacity: null, reading: true, benefits: [[5, 30]], satisfactionPoints: 0.003, readingBenefits: [30, 0, 0.003, 1], requirements: ['Available shelved book'], workKind: 'ordinary', optionalRequirements: [] }] }, names);
  expect(text).toContain('24 copies, including borrowed copies');
  expect(text).toContain('Collect or return: 1 person at once');
  expect(text).toContain('Readers use separate copies elsewhere');
  expect(text).toContain('Standard reading speed');
  expect(text).toContain('life satisfaction +0.003 points per reading hour');
  expect(text).not.toContain('Comfort');
});
