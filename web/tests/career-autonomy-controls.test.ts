import { expect, it } from 'vitest';
import { CareerAutonomyControls } from '../src/ui/career-autonomy-controls.js';

it('reflects the simulation settings and sends both boxes as one command', () => {
  let settings: { change: boolean; search: boolean } | null = { change: true, search: false };
  const sent: [boolean, boolean][] = [];
  const change = { checked: false, disabled: false };
  const search = { checked: true, disabled: false };
  const controls = new CareerAutonomyControls(
    { careerAutonomy: () => settings, setCareerAutonomy: (c, s) => { sent.push([c, s]); return true; } },
    change,
    search,
  );
  controls.update();
  expect([change.checked, search.checked]).toEqual([true, false]);
  search.checked = true;
  expect(controls.change()).toBe(true);
  expect(sent).toEqual([[true, true]]);
  expect(settings, 'a command, not a write').toEqual({ change: true, search: false });
  settings = { change: false, search: true };
  controls.update();
  expect([change.checked, search.checked]).toEqual([false, true]);
  settings = null;
  change.checked = true;
  controls.update();
  expect([change.checked, search.checked], 'an unreadable state leaves the boxes alone').toEqual([true, true]);
  controls.setDisabled(true);
  expect([change.disabled, search.disabled]).toEqual([true, true]);
  controls.setDisabled(false);
  expect([change.disabled, search.disabled]).toEqual([false, false]);
});
