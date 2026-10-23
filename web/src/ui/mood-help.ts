/** One reusable, viewport-bounded explanation owned by the condition list. */
export function createMoodHelp(doc: Document, list: HTMLElement): {
  refresh(): void; clear(): void;
} {
  let active: HTMLElement | null = null;
  let tooltip: HTMLElement | null = null;
  const tooltipId = `mood-number-help-${nextHelpId++}`;
  function clear(): void {
    active?.removeAttribute('aria-describedby');
    active = null;
    tooltip?.hidePopover();
  }
  function refresh(): void {
    if (!active) return;
    if (!list.contains(active) || list.hidden || !active.getClientRects().length) {
      clear();
      return;
    }
    if (!tooltip) {
      tooltip = doc.createElement('div');
      tooltip.id = tooltipId;
      tooltip.className = 'mood-number-help';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('popover', 'manual');
      doc.body.append(tooltip);
    }
    const text = active.getAttribute('data-help') ?? '';
    if (tooltip.textContent !== text) tooltip.textContent = text;
    active.setAttribute('aria-describedby', tooltipId);
    tooltip.showPopover();
    const anchor = active.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const width = doc.documentElement.clientWidth;
    const height = doc.documentElement.clientHeight;
    tooltip.style.left = `${Math.max(8, Math.min(anchor.right - box.width, width - box.width - 8))}px`;
    const above = anchor.top - box.height - 8;
    tooltip.style.top = `${Math.max(8, Math.min(above >= 8 ? above : anchor.bottom + 8, height - box.height - 8))}px`;
  }
  function show(event: Event): void {
    const target = event.target as HTMLElement;
    const number = target.closest<HTMLElement>('.moodlet-score');
    if (!number || !list.contains(number)) return;
    if (active !== number) clear();
    active = number;
    refresh();
  }
  list.addEventListener('pointerover', show);
  list.addEventListener('focusin', show);
  list.addEventListener('pointerout', clear);
  list.addEventListener('focusout', clear);
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !active) return;
    event.preventDefault();
    clear();
  }, { capture: true });
  doc.addEventListener('scroll', clear, true);
  doc.defaultView?.addEventListener('resize', clear);
  return { refresh, clear };
}
let nextHelpId = 0;
