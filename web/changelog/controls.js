(() => {
  const root = document.documentElement;
  const themeButton = document.getElementById('theme-toggle');
  const themeKey = 'natural-causes-changelog-theme';
  let theme = 'dark';
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch { /* A blocked preference store does not prevent reading changes. */ }
  function reflectTheme() {
    root.dataset.theme = theme;
    themeButton.setAttribute('aria-label', `Use ${theme === 'dark' ? 'light' : 'dark'} theme`);
    themeButton.setAttribute('aria-pressed', String(theme === 'light'));
    document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#11161d' : '#f2f5f8');
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
  const expand = document.getElementById('expand-all');
  const collapse = document.getElementById('collapse-all');
  function reflectDisclosures() {
    const allOpen = details.every((entry) => entry.open);
    expand.hidden = allOpen;
    collapse.hidden = !allOpen;
  }
  expand.addEventListener('click', () => {
    for (const entry of details) entry.open = true;
    reflectDisclosures();
    collapse.focus();
  });
  collapse.addEventListener('click', () => {
    for (const entry of details) entry.open = false;
    reflectDisclosures();
    expand.focus();
  });
  for (const entry of details) entry.addEventListener('toggle', reflectDisclosures);
  reflectDisclosures();
  function openLinkedEntry() {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const entry = document.getElementById(id)?.closest('.entry');
    if (!entry) return;
    entry.querySelector('details').open = true;
    entry.scrollIntoView();
  }
  window.addEventListener('hashchange', openLinkedEntry);
  openLinkedEntry();
})();
