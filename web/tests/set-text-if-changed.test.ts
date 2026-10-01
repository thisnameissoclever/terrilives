import { describe, expect, it } from 'vitest';
import { setTextIfChanged } from '../src/ui/set-text-if-changed.js';
import { textWriteProbe } from './helpers/text-write-probe.js';

describe('setTextIfChanged', () => {
  it('skips equal text, writes changed and empty text, and repairs external changes', () => {
    const target = { textContent: 'Select a person' };
    const probe = textWriteProbe(target);
    setTextIfChanged(target, 'Select a person');
    expect(probe.writes).toBe(0);
    setTextIfChanged(target, 'Terri');
    expect(probe.writes).toBe(1);
    expect(target.textContent).toBe('Terri');
    target.textContent = 'External change';
    setTextIfChanged(target, 'Terri');
    expect(probe.writes).toBe(3);
    expect(target.textContent).toBe('Terri');
    setTextIfChanged(target, '');
    setTextIfChanged(target, '');
    expect(probe.writes).toBe(4);
    expect(target.textContent).toBe('');
  });
});
