// Build mode's tool switch - [WT-shell] and [BM-shell]. Furniture, Walls and
// Buy each keep their own controller; this decides which one is showing and
// makes sure only one of them ever holds a preview.

/** A Build mode tool other than Furniture. */
export interface BuildTool {
  readonly active: boolean;
  enter(): void;
  exit(): void;
  handleKey(key: string): boolean;
}

export interface BuildToolHooks {
  /**
   * Drops any furniture preview so only one tool's preview is ever drawn, and
   * says whether it could: a move waiting on the drain cannot be dropped.
   */
  leaveFurniture(): boolean;
}

/**
 * Where a key in Build mode goes. While Walls or Buy is the tool, a key it does
 * not use goes nowhere, except Escape, which Build mode reads to leave: a
 * furniture key must not move furniture the player cannot see is selected.
 */
export function routeBuildKey(key: string, tools: readonly Pick<BuildTool, 'active' | 'handleKey'>[],
  furniture: { handleKey(key: string): boolean }): boolean {
  const tool = tools.find(candidate => candidate.active);
  if (!tool) return furniture.handleKey(key);
  return tool.handleKey(key) || (key === 'Escape' && furniture.handleKey(key));
}

export class BuildToolSwitch {
  private readonly buttons: readonly [HTMLElement, HTMLElement, HTMLElement];
  private readonly panels: readonly [HTMLElement, HTMLElement, HTMLElement];

  constructor(document: Document, private readonly walls: BuildTool,
    private readonly buy: BuildTool, hooks: BuildToolHooks) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing build tool switch: ${id}`);
      return element;
    };
    this.buttons = [required('build-tool-furniture'), required('build-tool-walls'),
      required('build-tool-buy')];
    this.panels = [required('furniture-tool'), required('wall-tool'), required('buy-tool')];
    const [furnitureButton, wallsButton, buyButton] = this.buttons;
    furnitureButton.addEventListener('click', () => {
      walls.exit();
      buy.exit();
    });
    wallsButton.addEventListener('click', () => {
      if (!hooks.leaveFurniture()) return;
      buy.exit();
      walls.enter();
    });
    buyButton.addEventListener('click', () => {
      if (!hooks.leaveFurniture()) return;
      walls.exit();
      buy.enter();
    });
    this.render();
  }

  render(): void {
    const chosen = this.walls.active ? 1 : this.buy.active ? 2 : 0;
    this.buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === chosen)));
    this.panels.forEach((panel, index) => { panel.hidden = index !== chosen; });
  }
}
