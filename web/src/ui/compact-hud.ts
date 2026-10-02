/** Presentation only: the existing panels still own their simulation data. */
export const COMPACT_HUD_MEDIA_QUERY = '(max-width: 600px), (max-height: 480px)';
export type SimPanel = 'overview' | 'queue' | 'people' | 'traits';

export interface CompactHudState {
  panel: SimPanel | null;
  collapsed: boolean;
  compact: boolean;
  editing: boolean;
}

export class CompactHud {
  private state: CompactHudState = { panel: null, collapsed: false, compact: false, editing: false };
  private saved: CompactHudState | null = null;

  constructor(private readonly render: (state: Readonly<CompactHudState>) => void) {
    this.reflect();
  }

  show(panel: SimPanel): void {
    if (this.state.editing) return;
    this.state.panel = panel;
    this.reflect();
  }

  close(): boolean {
    if (this.state.panel === null) return false;
    this.state.panel = null;
    this.reflect();
    return true;
  }

  toggle(panel: SimPanel): boolean {
    if (this.state.editing) return false;
    this.state.panel = this.state.panel === panel ? null : panel;
    this.reflect();
    return this.state.panel !== null;
  }

  toggleCollapsed(): void {
    if (this.state.editing) return;
    this.state.collapsed = !this.state.collapsed;
    this.state.panel = null;
    this.reflect();
  }

  setCompact(compact: boolean): void {
    this.state.compact = compact;
    this.reflect();
  }

  beginEditing(): void {
    if (this.saved) return;
    this.saved = { ...this.state };
    this.state.editing = true;
    this.state.panel = null;
    this.reflect();
  }

  endEditing(): void {
    if (!this.saved) return;
    const compact = this.state.compact;
    this.state = { ...this.saved, compact, editing: false };
    this.saved = null;
    this.reflect();
  }

  private reflect(): void { this.render({ ...this.state }); }
}

/** Wire one set of controls; move the need meters instead of duplicating them. */
export function createCompactHud(document: Document, refreshQueue: () => void, beforeOpen: () => void = () => {}): CompactHud {
  const element = <T extends HTMLElement>(id: string): T => {
    const result = document.getElementById(id);
    if (!result) throw new Error(`missing #${id}`);
    return result as T;
  };
  const dock = element('sim-dock');
  const sheet = element('sim-sheet');
  const body = element('sim-dock-body');
  const needs = element('needs-panel');
  const needsHost = element('dock-needs');
  const overviewNeeds = element('overview-needs');
  const collapse = element<HTMLButtonElement>('sim-dock-collapse');
  const details = element<HTMLButtonElement>('sim-details');
  const close = element<HTMLButtonElement>('sim-sheet-close');
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-sim-panel]'));
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-open-sim-panel]'));
  let opener: HTMLElement = details;
  let previous: SimPanel | null = null;
  const hud = new CompactHud(state => {
    dock.hidden = state.editing;
    body.hidden = state.collapsed;
    dock.dataset.compact = String(state.compact);
    sheet.hidden = state.panel === null;
    const host = state.compact || state.collapsed ? overviewNeeds : needsHost;
    if (needs.parentElement !== host) host.append(needs);
    for (const panel of panels) panel.hidden = panel.dataset.simPanel !== state.panel;
    for (const button of buttons) {
      button.setAttribute('aria-expanded', String(button.dataset.openSimPanel === state.panel));
    }
    details.setAttribute('aria-expanded', String(state.panel !== null));
    collapse.textContent = state.collapsed ? 'Expand' : 'Collapse';
    collapse.setAttribute('aria-expanded', String(!state.collapsed));
    collapse.setAttribute('aria-label', state.collapsed ? 'Expand Sim dock' : 'Collapse Sim dock');
    if (state.panel === 'traits') element<HTMLDetailsElement>('traits-block').open = true;
    if (state.panel !== 'traits') element<HTMLDetailsElement>('traits-block').open = false;
    // Opening a formerly hidden queue changes its measured row capacity.
    if (state.panel === 'queue' && previous !== 'queue') refreshQueue();
    previous = state.panel;
  });
  for (const button of buttons) {
    button.addEventListener('click', () => {
      beforeOpen();
      const panel = button.dataset.openSimPanel as SimPanel;
      if (!sheet.contains(button)) {
        opener = button;
        if ((button === details && hud.close()) || !hud.toggle(panel)) {
          button.focus();
          return;
        }
      } else {
        hud.show(panel);
      }
      // The same tab is reachable by keyboard after entering the sheet.
      sheet.querySelector<HTMLButtonElement>(`[data-open-sim-panel="${button.dataset.openSimPanel}"]`)?.focus();
    });
  }
  const closeSheet = () => {
    if (hud.close()) (opener.getClientRects().length ? opener : details).focus();
  };
  close.addEventListener('click', closeSheet);
  collapse.addEventListener('click', () => hud.toggleCollapsed());
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    if (sheet.hidden || !element('options-panel').hidden || !element('object-menu').hidden) return;
    event.preventDefault();
    event.stopPropagation();
    closeSheet();
  }, { capture: true });
  return hud;
}

/** Household warnings must survive collapse even when another Sim is selected. */
export function householdWarningText(members: Iterable<Pick<HTMLElement, 'textContent' | 'getAttribute'>>): string {
  return Array.from(members).filter(member => member.getAttribute('data-death-warning') === 'true')
    .map(member => member.textContent).filter(Boolean).join(' / ');
}
