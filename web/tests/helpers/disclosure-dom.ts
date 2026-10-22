/** A structural document that preserves node identity and disclosure state. */
export class DisclosureElement {
  children: DisclosureElement[] = [];
  parentElement: DisclosureElement | null = null;
  className = ''; hidden = false; open = false; value = ''; id = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  events = new Map<string, (event: any) => void>();
  private text = '';
  constructor(readonly tagName: string, readonly ownerDocument: DisclosureDocument) {}
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(text: string) { this.replaceChildren(); this.text = text; }
  append(...children: DisclosureElement[]): void {
    for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
  }
  replaceChildren(...children: DisclosureElement[]): void {
    this.children.forEach(child => {child.parentElement = null;}); this.children = []; this.text = ''; this.append(...children);
  }
  insertBefore(child: DisclosureElement, before: DisclosureElement | null): void {
    child.remove(); child.parentElement = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
  }
  remove(): void { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(name: string, value: string): void {this.attributes.set(name, value);}
  getAttribute(name: string): string | null {return this.attributes.get(name) ?? null;}
  addEventListener(name: string, listener: (event: any) => void): void {this.events.set(name, listener);}
  fire(name: string): void {this.events.get(name)?.({target: this});}
  focus(): void {this.ownerDocument.activeElement = this;}
  all(): DisclosureElement[] {return [this, ...this.children.flatMap(child => child.all())];}
}
export class DisclosureDocument {
  activeElement: DisclosureElement | null = null;
  createElement(tag: string): DisclosureElement {return new DisclosureElement(tag, this);}
}
