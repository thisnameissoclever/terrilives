/** Keeps Options and Load available while a scene's materials are unavailable. */
export function createFloorSceneStatus(document: Document, stage: HTMLCanvasElement,
  retry: () => void): (blocked: boolean, error: string | null) => void {
  const panel = document.createElement('div');
  panel.id = 'floor-scene-status';
  panel.hidden = true;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('style', 'position:fixed;left:50%;top:45%;transform:translate(-50%,-50%);max-width:70vw;padding:16px;background:#23232b;color:#fff;border:1px solid #888;z-index:2');
  const text = document.createElement('p');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hud-button';
  button.textContent = 'Retry';
  button.addEventListener('click', retry);
  panel.append(text, button);
  document.body.append(panel);
  return (blocked, error) => {
    stage.style.visibility = blocked ? 'hidden' : '';
    panel.hidden = !blocked;
    text.textContent = error ? 'Floor materials could not load. Try again.' : 'Loading floor materials.';
    button.hidden = error === null;
  };
}
