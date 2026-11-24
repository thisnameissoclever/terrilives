/** Optional model identity beneath the object's primary type. */
export interface ObjectDetails {
  readonly modelName: string;
  readonly description: string;
}

/** Native disclosure keeps the model and type readable with mouse, keyboard, or touch. */
let identitySequence = 0;
export function createObjectIdentity(doc: Document, type: string, text: ObjectDetails,
  options: {descriptionHost?: HTMLElement; onToggle?(): void} = {}): {
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
  summary.append(title, model);
  const description = doc.createElement('p');
  description.className = 'object-description';
  description.textContent = text.description;
  details.append(summary);
  if (options.descriptionHost) {
    description.id = `object-description-${++identitySequence}`;
    summary.setAttribute('aria-controls', description.id);
    options.descriptionHost.append(description);
    options.descriptionHost.hidden = true;
  } else details.append(description);

  const toggle = (event: MouseEvent) => {
    event.preventDefault();
    details.open = !details.open;
    if (options.descriptionHost) options.descriptionHost.hidden = !details.open;
    options.onToggle?.();
  };
  // Enter and Space activate the native summary through the same click event.
  summary.addEventListener('click', toggle);
  return { element: details, dispose: () => summary.removeEventListener('click', toggle) };
}
