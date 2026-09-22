/** Optional model identity beneath the object's primary type. */
export interface ObjectDetails {
  readonly modelName: string;
  readonly description: string;
}

/** Native disclosure keeps the model and type readable with mouse, keyboard, or touch. */
export function createObjectIdentity(doc: Document, type: string, text: ObjectDetails, boundary: HTMLElement): {
  element: HTMLElement;
  dispose: () => void;
} {
  const details = doc.createElement('details');
  details.className = 'object-identity';
  const summary = doc.createElement('summary');
  summary.setAttribute('aria-label', `${type}: ${text.modelName}. Object description`);
  const model = doc.createElement('span');
  model.className = 'object-model';
  model.textContent = text.modelName;
  const arrow = doc.createElement('span');
  arrow.className = 'object-description-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '›';
  model.append(arrow);
  const title = doc.createElement('strong');
  title.className = 'object-type';
  title.textContent = type;
  summary.append(model, title);
  const description = doc.createElement('p');
  description.className = 'object-description';
  description.textContent = text.description;
  details.append(summary, description);

  let pinned = false;
  let hovering = false;
  summary.addEventListener('click', (event) => {
    event.preventDefault();
    pinned = !pinned;
    details.open = pinned;
  });
  details.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'touch') return;
    hovering = true;
    details.open = true;
  });
  const leave = () => {
    hovering = false;
    if (!pinned && !details.contains(doc.activeElement)) details.open = false;
  };
  // Keep actions stationary while the pointer moves from the description
  // into the surrounding menu or Buy controls.
  boundary.addEventListener('pointerleave', leave);
  details.addEventListener('focusin', () => { details.open = true; });
  details.addEventListener('focusout', (event) => {
    if (!pinned && !hovering && !details.contains(event.relatedTarget as Node | null)) details.open = false;
  });
  return { element: details, dispose: () => boundary.removeEventListener('pointerleave', leave) };
}
