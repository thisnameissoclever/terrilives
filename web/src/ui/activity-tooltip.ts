/** Reveal the selected person's clipped activity without changing game state. */
export function createActivityTooltip(document: Document): void {
  const view = document.defaultView;
  if (!view) return;
  const trigger = document.getElementById('dock-activity');
  const dock = document.getElementById('sim-dock');
  const caption = document.getElementById('needs-caption');
  const roster = document.getElementById('household-roster-members');
  if (!trigger || !dock || !caption || !roster) throw new Error('missing selected-person activity controls');

  const popup = document.createElement('div');
  popup.id = 'dock-activity-tooltip';
  popup.setAttribute('role', 'tooltip');
  popup.hidden = true;
  document.body.append(popup);
  trigger.setAttribute('aria-controls', popup.id);
  trigger.setAttribute('aria-expanded', 'false');
  let pinned = false;
  let focused = false;
  let hovered = false;
  let text = trigger.textContent ?? '';
  let name = caption.textContent;
  let person = roster.querySelector('[aria-pressed="true"]');

  const clipped = () => !!text && trigger.getClientRects().length > 0
    && (trigger.scrollWidth > trigger.clientWidth || trigger.scrollHeight > trigger.clientHeight);

  const hide = () => {
    popup.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-describedby');
  };
  const dismiss = () => { pinned = false; hide(); };
  const position = () => {
    const viewport = view.visualViewport;
    const left = (viewport?.offsetLeft ?? 0) + 8;
    const top = (viewport?.offsetTop ?? 0) + 8;
    const width = Math.max(0, (viewport?.width ?? view.innerWidth) - 16);
    const height = Math.max(0, (viewport?.height ?? view.innerHeight) - 16);
    popup.style.maxWidth = `${Math.min(420, width)}px`;
    popup.style.maxHeight = `${height}px`;
    const anchor = trigger.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, maximum));
    popup.style.left = `${clamp(anchor.left, left, left + width - bounds.width)}px`;
    // Adjacent edges let a mouse enter the popup without crossing an empty gap.
    const above = anchor.top - bounds.height;
    const preferred = above < top && anchor.bottom + bounds.height <= top + height ? anchor.bottom : above;
    popup.style.top = `${clamp(preferred, top, top + height - bounds.height)}px`;
  };
  const refresh = () => {
    const nextText = trigger.textContent ?? '';
    const nextName = caption.textContent;
    const nextPerson = roster.querySelector('[aria-pressed="true"]');
    if (nextName !== name || nextPerson !== person) dismiss();
    text = nextText; name = nextName; person = nextPerson;
    const available = clipped();
    trigger.tabIndex = available ? 0 : -1;
    if (!available) dismiss();
    else if (!popup.hidden) {
      if (popup.textContent !== text) popup.textContent = text;
      position();
    }
  };
  const show = () => {
    refresh();
    if (!clipped()) return;
    popup.textContent = text;
    popup.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-describedby', popup.id);
    position();
  };
  trigger.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'mouse') return;
    hovered = true; show();
  });
  trigger.addEventListener('pointerleave', event => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (popup.contains(event.relatedTarget as Node | null)) return;
    hovered = false;
    if (!focused && !pinned) hide();
  });
  popup.addEventListener('pointerleave', event => {
    if (trigger.contains(event.relatedTarget as Node | null)) return;
    hovered = false;
    if (!focused && !pinned) hide();
  });
  trigger.addEventListener('focus', () => { focused = true; show(); });
  trigger.addEventListener('blur', () => { focused = false; pinned = false; if (!hovered) hide(); });
  trigger.addEventListener('pointerdown', event => event.stopPropagation());
  trigger.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (pinned) dismiss();
    else { show(); pinned = !popup.hidden; }
  });
  // Keep activation keys on the button; native Enter and Space still emit click.
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
  });
  popup.addEventListener('pointerdown', event => event.stopPropagation());
  popup.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('pointerdown', event => {
    if (!trigger.contains(event.target as Node) && !popup.contains(event.target as Node)) dismiss();
  }, { capture: true });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || popup.hidden || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }, { capture: true });
  const mutations = new view.MutationObserver(refresh);
  mutations.observe(trigger, { childList: true, characterData: true, subtree: true });
  mutations.observe(caption, { childList: true, characterData: true, subtree: true });
  mutations.observe(roster, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  mutations.observe(dock, { attributes: true, attributeFilter: ['hidden'] });
  new view.ResizeObserver(refresh).observe(trigger);
  view.addEventListener('resize', refresh);
  view.visualViewport?.addEventListener('resize', refresh);
  view.visualViewport?.addEventListener('scroll', refresh);
  refresh();
}
