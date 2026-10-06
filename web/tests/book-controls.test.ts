import { expect, it } from 'vitest';
import { BookResults } from '../src/books/results.js';
import { BookTool } from '../src/ui/book-tool.js';
import { BookToolControls } from '../src/ui/book-tool-controls.js';
class Element {
  ownerDocument!: Document; className = ''; hidden = false; open = false; disabled = false; value = ''; textContent = '';
  children: Element[] = []; listeners = new Map<string, (event: any) => void>(); attributes = new Map<string, string>();
  append(...nodes: Element[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Element[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  addEventListener(name: string, callback: (event: any) => void) { this.listeners.set(name, callback); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  fire(name: string) { this.listeners.get(name)?.({ preventDefault() {} }); }
}
it('renders native controls with escaped descriptions, copy identity and protected borrower homes', () => {
  const elements = new Map<string, Element>();
  const doc = { createElement: () => Object.assign(new Element(), { ownerDocument: doc }),
    querySelector: (id: string) => { if (!elements.has(id)) elements.set(id, Object.assign(new Element(), { ownerDocument: doc })); return elements.get(id); } } as unknown as Document;
  let selected: number | null = 7;
  const source = { bookCatalogue: () => [{ id: 'one', title: '<One>', genre: 'science_fiction', price: 10, description: '<script>bad</script>', readingMinutes: 180 }],
    bookState: () => ({ shelves: [{ entity: 4, capacity: 2, visible: [2, null], reserved: [2, 3] }], copies: [
      { id: 2, titleId: 'one', location: { kind: 'shelf' as const, home: { shelf: 4n, slot: 0 } }, home: { shelf: 4n, slot: 0 }, borrowerSimId: null },
      { id: 3, titleId: 'one', location: { kind: 'carried' as const, simId: 100 }, home: { shelf: 4n, slot: 1 }, borrowerSimId: 100 }] }),
    bookInterest: (person: number) => person === 7 ? 0.5 : 1.5, readingProgress: () => null, selectedIndex: () => selected,
    simName: () => 'Reader', simIdOf: (entity: number) => entity === 7 ? 100 : null, ids: () => Uint32Array.of(4, 7),
    objectName: () => 'Bookcase', objectDetails: () => ({ modelName: 'Model', description: 'Shelf.' }), funds: () => 100,
    buyBook: () => true, transferBook: () => true, pendingBookCommands: () => 0, takeBookResults: () => [] };
  const coordinator = new BookResults(source), tool = new BookTool(source, coordinator, () => {});
  tool.enter(); tool.choose('one'); const view = new BookToolControls(doc, tool);
  const description = elements.get('#book-description')!.children[0];
  expect(description.open).toBe(false); expect(description.children[1].textContent).toBe('<script>bad</script>');
  description.children[0].fire('mouseover'); expect(description.open).toBe(false);
  description.children[0].fire('click'); expect(description.open).toBe(true);
  expect(elements.get('#book-facts')!.textContent).toContain('usually 3 sessions');
  expect(elements.get('#book-facts')!.textContent).toContain('Science fiction');
  expect(elements.get('#book-facts')!.textContent).toContain("Reader's current interest: 50%");
  selected = 8; view.render(); expect(elements.get('#book-facts')!.textContent).toContain('150%');
  const rows = elements.get('#book-owned')!.children;
  expect(rows).toHaveLength(2); expect(rows[0].children[0].textContent).toContain('copy 3'); expect(rows[1].children[0].textContent).toContain('copy 4');
  expect(rows[1].children[2].disabled).toBe(true);
  expect(elements.get('#book-destination')!.children[1].textContent).toContain('1 shelved, 2/2 reserved');
  tool.buy(); view.render(); expect(elements.get('#book-buy')!.disabled).toBe(true); expect(elements.get('#book-title')!.disabled).toBe(true);
});
