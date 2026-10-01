/** Preserve text nodes when the live DOM already contains the requested text. */
export function setTextIfChanged(target: { textContent: string | null }, text: string): void {
  if (target.textContent !== text) target.textContent = text;
}
