/** Keep browser text selection and callouts out of game action menus. */
export function preventMenuSelection(root: EventTarget): void {
  const prevent = (event: Event): void => event.preventDefault();
  root.addEventListener('selectstart', prevent);
  root.addEventListener('contextmenu', prevent);
}
