import { describe, expect, it } from 'vitest';
import { createSection } from '../src/admin/admin-controls.js';
import { fakeDocument } from './helpers/fake-dom.js';

describe('a section status line', () => {
  it('scrolls a refusal into view, since a tall section such as Career ends below the fold', () => {
    const { doc } = fakeDocument();
    const section = createSection(doc, 'Career');
    const scrolled: unknown[] = [];
    (section.status as unknown as { scrollIntoView: (options: unknown) => void }).scrollIntoView = options => { scrolled.push(options); };
    section.report(null);
    expect(scrolled).toEqual([]);
    section.report('They are at work or on the way. Change the job when they are home.');
    expect(section.status.textContent).toBe('They are at work or on the way. Change the job when they are home.');
    expect(scrolled).toEqual([{ block: 'nearest' }]);
  });
});
