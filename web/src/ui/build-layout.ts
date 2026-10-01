/** On short screens, one grid allocates controls, visible game space and the build panel. */
export interface CompactBuildLayout {
  readonly enabled: boolean;
  readonly rows: boolean;
  setRows(rows: boolean): boolean;
  freeArea(): DOMRect | null;
}

export function createCompactBuildLayout(doc: Document, actions: HTMLElement, enabled: () => boolean): CompactBuildLayout {
  const shell = doc.getElementById('build-context-layout')!;
  const header = doc.getElementById('build-context-header')!;
  const free = doc.getElementById('build-free-space')!;
  const elements = [doc.getElementById('hud')!, doc.getElementById('build-camera')!,
    actions, doc.getElementById('builder-dock')!];
  const homes = elements.map(element => ({ element, parent: element.parentNode!, next: element.nextSibling }));
  let rows = false;
  return {
    get enabled() { return enabled(); },
    get rows() { return rows; },
    setRows(next) {
      if (rows === next) return false;
      const active = doc.activeElement;
      const focused = active instanceof HTMLElement && elements.some(element => element.contains(active)) ? active : null;
      rows = next;
      doc.body.dataset.buildRows = String(rows);
      shell.hidden = !rows;
      if (rows) {
        header.append(elements[0], elements[1]);
        shell.append(actions, elements[3]);
      } else {
        for (const home of homes) home.parent.insertBefore(home.element,
          home.next?.parentNode === home.parent ? home.next : null);
      }
      if (focused?.isConnected && focused.getClientRects().length > 0
        && !focused.matches(':disabled')) focused.focus({ preventScroll: true });
      return true;
    },
    freeArea: () => rows ? free.getBoundingClientRect() : null,
  };
}
