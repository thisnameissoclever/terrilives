/** Add the scrollbar's actual width so the sidebar keeps its usable content width. */
export function observeHudScrollbar(root: HTMLElement): () => void {
  const dock = root.ownerDocument.querySelector<HTMLElement>('#sim-dock');
  const update = () => {
    const style = root.ownerDocument.documentElement.style;
    if (dock) {
      const bounds = dock.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        const top = `${Math.max(0, Math.floor(bounds.top))}px`;
        if (style.getPropertyValue('--sim-dock-top') !== top) style.setProperty('--sim-dock-top', top);
      } else if (style.getPropertyValue('--sim-dock-top')) {
        style.removeProperty('--sim-dock-top');
      }
    }
    const summary = root.querySelector<HTMLElement>('#household-summary');
    if (summary) {
      const bottom = `${Math.ceil(summary.getBoundingClientRect().bottom + 8)}px`;
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
  if (dock) observer.observe(dock);
  const onResize = () => update();
  window.addEventListener('resize', onResize);
  update();
  return () => { observer.disconnect(); window.removeEventListener('resize', onResize); };
}
