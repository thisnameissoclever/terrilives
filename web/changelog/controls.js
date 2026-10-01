(() => {
  const root = document.documentElement;
  const themeButton = document.getElementById('theme-toggle');
  const themeKey = 'natural-causes-changelog-theme';
  let theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch { /* A blocked preference store does not prevent reading changes. */ }
  function reflectTheme() {
    root.dataset.theme = theme;
    themeButton.setAttribute('aria-label', `Use ${theme === 'dark' ? 'light' : 'dark'} theme`);
  }
  reflectTheme();
  themeButton.hidden = false;
  themeButton.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    reflectTheme();
    try { localStorage.setItem(themeKey, theme); } catch { /* The choice still applies to this page. */ }
  });
  document.querySelector('.view-controls').hidden = false;
  const details = [...document.querySelectorAll('.entry > details')];
  document.getElementById('expand-all').addEventListener('click', () => {
    for (const entry of details) entry.open = true;
  });
  document.getElementById('collapse-all').addEventListener('click', () => {
    for (const entry of details) entry.open = false;
  });
  function openLinkedEntry() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const entry = document.getElementById(id);
    if (!entry?.classList.contains('entry')) return;
    entry.querySelector('details').open = true;
    entry.scrollIntoView();
  }
  window.addEventListener('hashchange', openLinkedEntry);
  openLinkedEntry();
})();
