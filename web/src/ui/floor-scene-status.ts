import { setActionIntent } from './action-intent.js';
import type { OperationFeedback } from './operation-feedback.js';
import { sceneFeedbackPosition, type SceneLayout, type SceneRect } from './scene-feedback-layout.js';

export interface FloorSceneStatus {
  (blocked: boolean, error: string | null): void;
  /** Optional preview recovery never hides or pauses an otherwise valid world. */
  preview(feedback: OperationFeedback | null, layout?: SceneLayout): SceneRect | null;
}
/** Keeps Options and Load available while a scene's materials are unavailable. */
export function createFloorSceneStatus(document: Document, stage: HTMLCanvasElement,
  retry: () => void): FloorSceneStatus {
  const panel = document.createElement('div');
  panel.id = 'floor-scene-status';
  panel.hidden = true;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('style', 'position:fixed;box-sizing:border-box;left:50%;top:45%;transform:translate(-50%,-50%);max-width:70vw;padding:16px;background:#23232b;color:#fff;border:1px solid #888;z-index:2');
  const text = document.createElement('p');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-button';
  button.textContent = 'Retry';
  setActionIntent(button, 'affirmative');
  button.addEventListener('click', retry);
  panel.append(text, button);
  document.body.append(panel);
  let blocked = false, error: string | null = null, preview: OperationFeedback | null = null;
  let dirty = true, layoutKey = '', bounds: SceneRect | null = null;
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { dirty = true; }).observe(panel);
  const render = (): void => {
    stage.style.visibility = blocked ? 'hidden' : '';
    panel.hidden = !blocked && !preview;
    panel.dataset.pending = String(blocked ? error === null : preview?.state === 'pending');
    text.textContent = blocked ? error ? 'Floor materials could not load. Try again.' : 'Loading floor materials.'
      : preview?.message ?? '';
    button.hidden = blocked ? error === null : preview?.recovery !== 'retry';
    if (blocked) {
      panel.style.left = '50%'; panel.style.top = '45%'; panel.style.transform = 'translate(-50%,-50%)';
      panel.style.maxWidth = '70vw';
    }
  };
  const update = ((nextBlocked: boolean, nextError: string | null) => {
    blocked = nextBlocked; error = nextError; dirty = true; render();
  }) as FloorSceneStatus;
  update.preview = (next, layout) => {
    if (JSON.stringify(next) !== JSON.stringify(preview)) { preview = next; dirty = true; render(); }
    if (!preview || blocked) { bounds = null; return null; }
    if (!layout) return null;
    const key = JSON.stringify(layout);
    if (key !== layoutKey) { layoutKey = key; dirty = true; }
    if (!dirty) return bounds;
    dirty = false;
    panel.hidden = false;
    panel.style.maxWidth = `${Math.max(0, Math.min(420, layout.viewport.right - layout.viewport.left - 16))}px`;
    const size = panel.getBoundingClientRect();
    const point = sceneFeedbackPosition(size.width, size.height, layout, null);
    panel.hidden = point === null;
    bounds = point ? { left: point.x, top: point.y, right: point.x + size.width, bottom: point.y + size.height } : null;
    if (point) { panel.style.left = `${point.x}px`; panel.style.top = `${point.y}px`; panel.style.transform = 'none'; }
    return bounds;
  };
  return update;
}
