import { expect, it } from 'vitest';
import { CareerAutonomyControls } from '../src/ui/career-autonomy-controls.js';

it('reflects the household change setting and sends the box as a command', () => {
  let change: boolean | null = true;
  const sent: boolean[] = [];
  const box = { checked: false, disabled: false };
  const controls = new CareerAutonomyControls(
    { careerChangeAutonomy: () => change, setCareerChangeAutonomy: value => { sent.push(value); return true; } },
    box,
  );
  controls.update();
  expect(box.checked).toBe(true);
  box.checked = false;
  expect(controls.change()).toBe(true);
  expect(sent).toEqual([false]);
  expect(change, 'a command, not a write').toBe(true);
  change = false;
  controls.update();
  expect(box.checked).toBe(false);
  change = null;
  box.checked = true;
  controls.update();
  expect(box.checked, 'an unreadable state leaves the box alone').toBe(true);
  controls.setDisabled(true);
  expect(box.disabled).toBe(true);
  controls.setDisabled(false);
  expect(box.disabled).toBe(false);
});
