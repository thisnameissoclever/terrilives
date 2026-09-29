import { expect, it } from 'vitest';
import { DeathControls } from '../src/ui/death-controls.js';

it('reflects simulation state and sends the checkbox choice as a command', () => {
  let enabled = false;
  const sent: boolean[] = [];
  const input = { checked: true };
  const source = { deathEnabled: () => enabled, setDeathEnabled: (value: boolean) => { sent.push(value); return true; } };
  const controls = new DeathControls(source, input);
  controls.update();
  expect(input.checked).toBe(false);
  input.checked = true;
  controls.change();
  expect(sent).toEqual([true]);
  expect(enabled).toBe(false);
  enabled = true;
  controls.update();
  expect(input.checked).toBe(true);
  enabled = false;
  controls.update();
  expect(input.checked).toBe(false);
});
