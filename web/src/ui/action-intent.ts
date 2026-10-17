export type ActionIntent = 'affirmative' | 'negative' | 'destructive' | 'neutral';

/** Keep presentation intent separate from labels and capability. */
export function setActionIntent(button: HTMLButtonElement, intent: ActionIntent): void {
  if (intent === 'neutral') button.removeAttribute('data-action-intent');
  else button.setAttribute('data-action-intent', intent);
}
