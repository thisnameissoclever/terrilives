/** Add the scrollbar's actual width so the sidebar keeps its usable content width. */
export function observeHudScrollbar(root: HTMLElement): () => void {
  const update = () => {
    const summary = root.querySelector<HTMLElement>('#household-summary');
    if (summary) {
      const bottom = `${Math.ceil(summary.getBoundingClientRect().bottom + 8)}px`;
      const style = root.ownerDocument.documentElement.style;
      if (style.getPropertyValue('--hud-summary-bottom') !== bottom) {
        style.setProperty('--hud-summary-bottom', bottom);
      }
    }
    const width = Math.max(0, root.offsetWidth - root.clientWidth);
    const value = `${width}px`;
    if (root.style.getPropertyValue('--hud-scrollbar-width') !== value) {
      root.style.setProperty('--hud-scrollbar-width', value);
    }
  };
  const observer = new ResizeObserver(update);
  observer.observe(root);
  for (const child of root.children) observer.observe(child);
  const onResize = () => update();
  window.addEventListener('resize', onResize);
  update();
  return () => { observer.disconnect(); window.removeEventListener('resize', onResize); };
}
