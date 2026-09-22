// Build mode's tool switch - [WT-shell], [BM-shell] and [RT-shell]. Furniture,
// Walls, Room and Buy each keep their own controller; this decides which one
// is showing and makes sure only one of them ever holds a preview.

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
  /**
   * Gives the game view keyboard focus after a switch, as entering Build mode
   * does, so the new tool's keys work without a click on the lot first.
   */
  focusView(): void;
}

/** A tool beside Furniture: its button and panel ids, in switch order. */
export interface SwitchedTool {
  readonly tool: BuildTool;
  readonly button: string;
  readonly panel: string;
}

/**
 * Where a key in Build mode goes. While a tool other than Furniture is in use,
 * a key it does not use goes nowhere, except Escape, which Build mode reads to
 * leave: a furniture key must not move furniture the player cannot see is
 * selected.
 */
export function routeBuildKey(key: string, tools: readonly Pick<BuildTool, 'active' | 'handleKey'>[],
  furniture: { handleKey(key: string): boolean }): boolean {
  const tool = tools.find(candidate => candidate.active);
  if (!tool) return furniture.handleKey(key);
  return tool.handleKey(key) || (key === 'Escape' && furniture.handleKey(key));
}

export class BuildToolSwitch {
  private readonly buttons: readonly HTMLElement[];
  private readonly panels: readonly HTMLElement[];

  /** `tools` are the tools beside Furniture, in the order their buttons show. */
  constructor(document: Document, private readonly tools: readonly SwitchedTool[],
    hooks: BuildToolHooks) {
    const required = <T extends HTMLElement>(id: string): T => {
      const element = document.querySelector<T>(`#${id}`);
      if (!element) throw new Error(`Missing build tool switch: ${id}`);
      return element;
    };
    this.buttons = [required('build-tool-furniture'), ...tools.map(entry => required(entry.button))];
    this.panels = [required('furniture-tool'), ...tools.map(entry => required(entry.panel))];
    this.buttons[0].addEventListener('click', () => {
      for (const entry of tools) entry.tool.exit();
      hooks.focusView();
    });
    tools.forEach((entry, index) => {
      this.buttons[index + 1].addEventListener('click', () => {
        if (!hooks.leaveFurniture()) return;
        for (const other of tools) if (other !== entry) other.tool.exit();
        entry.tool.enter();
        hooks.focusView();
      });
    });
    this.render();
  }

  render(): void {
    const chosen = this.tools.findIndex(entry => entry.tool.active) + 1;
    this.buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(index === chosen)));
    this.panels.forEach((panel, index) => { panel.hidden = index !== chosen; });
  }
}
