import type { WindowModelId } from '../architecture/windows.js';
import { ARCHITECTURE } from '../render/architecture-data.js';
import { architectureSprite } from '../render/architecture.js';
import type { WindowTool } from './window-tool.js';
import type { WallTool } from './wall-tool.js';

/** Composite every ownership piece from the exported atlas, preserving source registration. */
export async function drawWindowThumbnails(samples: readonly { canvas: HTMLCanvasElement; model: WindowModelId }[]): Promise<void> {
  const response = await fetch(new URL(ARCHITECTURE.resources.color, new URL(import.meta.env.BASE_URL, location.href)));
  if (!response.ok) throw new Error(`Window samples returned ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    for (const { canvas, model } of samples) {
      const pieces = architectureSprite(model, 1, 'front', false);
      const left = Math.min(...pieces.map(piece => piece.logicalBounds[0]));
      const top = Math.min(...pieces.map(piece => piece.logicalBounds[1]));
      const right = Math.max(...pieces.map(piece => piece.logicalBounds[2]));
      const bottom = Math.max(...pieces.map(piece => piece.logicalBounds[3]));
      const scale = Math.min(canvas.width / (right - left), canvas.height / (bottom - top));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Window sample canvas is unavailable.');
      context.imageSmoothingEnabled = false;
      for (const piece of pieces) {
        const [x, y, endX, endY] = piece.logicalBounds;
        context.drawImage(bitmap, piece.x, piece.y, piece.w, piece.h,
          (canvas.width - (right - left) * scale) / 2 + (x - left) * scale,
          (canvas.height - (bottom - top) * scale) / 2 + (y - top) * scale,
          (endX - x) * scale, (endY - y) * scale);
      }
    }
  } finally { bitmap.close(); }
}

/** The existing Walls dock owns both literal wall actions and the window chooser. */
export class WindowToolControls {
  private readonly choices: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly wallActions: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fit: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly back: HTMLButtonElement;
  private readonly buttons: { button: HTMLButtonElement; model: WindowModelId }[] = [];
  private readonly keyboardHelp: HTMLElement;
  private readonly touchHelp: HTMLElement;

  constructor(private readonly document: Document, private readonly tool: WindowTool, walls: WallTool,
    thumbnails = drawWindowThumbnails) {
    const required = <T extends HTMLElement>(id: string): T => {
      const node = document.querySelector<T>(`#${id}`);
      if (!node) throw new Error(`Missing window control: ${id}`);
      return node;
    };
    this.choices = required('window-choices'); this.actions = required('window-actions');
    this.wallActions = required('wall-actions'); this.status = required('window-status');
    this.fit = required('window-fit'); this.remove = required('window-remove'); this.back = required('window-back');
    this.keyboardHelp = required('window-keyboard-help'); this.touchHelp = required('window-touch-help');
    const samples: { canvas: HTMLCanvasElement; model: WindowModelId }[] = [];
    const groups = required('window-models');
    for (const width of [...new Set(tool.catalogue.map(entry => entry.width))].sort()) {
      const group = document.createElement('fieldset'), legend = document.createElement('legend');
      legend.textContent = `${width}-unit windows`; group.append(legend);
      for (const model of tool.catalogue.filter(entry => entry.width === width)) {
        const button = document.createElement('button'), canvas = document.createElement('canvas');
        button.type = 'button'; button.className = 'hud-button window-model';
        button.setAttribute('data-window-model', String(model.id));
        canvas.width = 144; canvas.height = 120; canvas.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'), badge = document.createElement('span');
        label.textContent = model.label; badge.textContent = `${model.width}-unit`; badge.className = 'window-width';
        button.append(canvas, label, badge);
        button.addEventListener('click', () => tool.chooseModel(model.id));
        group.append(button); this.buttons.push({ button, model: model.id }); samples.push({ canvas, model: model.id });
      }
      groups.append(group);
    }
    void thumbnails(samples).catch(error => {
      for (const { canvas } of samples) canvas.hidden = true;
      for (const { button } of this.buttons) button.title = 'Window sample unavailable.';
      console.warn('Window samples failed', error);
    });
    this.fit.addEventListener('click', () => tool.apply());
    this.remove.addEventListener('click', () => tool.remove());
    this.back.addEventListener('click', () => { walls.selectWalls(); document.querySelector<HTMLElement>('#wall-window')?.focus(); });
    this.render();
  }
  setCompact(compact: boolean): void { this.keyboardHelp.hidden = compact; this.touchHelp.hidden = !compact; }
  render(): void {
    const restoreRemoveFocus = this.document.activeElement === this.remove && this.tool.owner === null && this.tool.active;
    this.choices.hidden = !this.tool.active; this.actions.hidden = !this.tool.active;
    this.wallActions.hidden = this.tool.active;
    this.choices.closest('.builder-tool')?.classList.toggle('window-editing', this.tool.active);
    this.status.textContent = this.tool.status;
    this.fit.textContent = this.tool.owner ? 'Replace window' : 'Fit window';
    this.fit.disabled = !this.tool.canApply(); this.remove.disabled = !this.tool.canRemove();
    this.remove.hidden = this.tool.owner === null; this.back.disabled = this.tool.pending !== null;
    for (const { button, model } of this.buttons) {
      button.disabled = this.tool.blocked || this.tool.pending !== null;
      button.setAttribute('aria-pressed', String(model === this.tool.chosen));
    }
    if (restoreRemoveFocus) this.fit.focus();
  }
}
