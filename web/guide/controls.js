(() => {
  const root = document.documentElement;
  const button = document.getElementById('theme-toggle');
  let theme = 'dark';
  try { const saved = localStorage.getItem('natural-causes-changelog-theme'); if (saved === 'light' || saved === 'dark') theme = saved; } catch { /* Reading remains available without storage. */ }
  function reflect() {
    root.dataset.theme = theme;
    button.setAttribute('aria-label', `Use ${theme === 'dark' ? 'light' : 'dark'} theme`);
    button.setAttribute('aria-pressed', String(theme === 'light'));
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#11161d' : '#f2f5f8';
  }
  reflect(); button.hidden = false;
  button.addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; reflect(); try { localStorage.setItem('natural-causes-changelog-theme', theme); } catch { /* The current choice still works. */ } });
  function linkedSection() {
    let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id); if (!target) return;
    let parent = target.parentElement; while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    requestAnimationFrame(() => { target.scrollIntoView(); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); });
  }
  addEventListener('hashchange', linkedSection); linkedSection();
  const form = document.querySelector('.guide-search'), query = form.querySelector('input'), results = document.getElementById('search-results');
  let index;
  try { index = JSON.parse(document.getElementById('guide-search-data').textContent); } catch { /* A network index remains available if embedded data is missing. */ }
  async function search(event) {
    event?.preventDefault();
    const value = query.value.trim().toLowerCase(); results.replaceChildren(); results.hidden = !value;
    const address = new URL(location.href); value ? address.searchParams.set('q', query.value) : address.searchParams.delete('q'); history.replaceState(null, '', address);
    if (!value) return;
    try {
      if (!index) { const response = await fetch(form.dataset.prefix + 'search-index.json'); if (!response.ok) throw Error('Search unavailable'); index = await response.json(); }
      if (query.value.trim().toLowerCase() !== value) return;
      const words = value.split(/\s+/);
      const score = (row) => words.reduce((total, word) => total + (row.title.toLowerCase().includes(word) ? 10 : 0) + (row.page.toLowerCase().includes(word) ? 3 : 0), 0);
      const matched = index.filter((row) => words.every((word) => `${row.title} ${row.page} ${row.text ?? row.excerpt}`.toLowerCase().includes(word))).sort((a, b) => score(b) - score(a)).slice(0, 20);
      const heading = document.createElement('h2'); heading.textContent = matched.length ? 'Matching sections' : 'No matching section'; results.append(heading);
      if (!matched.length) { const p = document.createElement('p'); p.textContent = 'Try a control name, clear the search, or browse the guide topics above.'; results.append(p); }
      for (const row of matched) { const div = document.createElement('div'); div.className = 'search-result'; const a = document.createElement('a'); a.href = form.dataset.prefix + row.url; a.textContent = row.page + ': ' + row.title; const p = document.createElement('p'); p.textContent = row.excerpt; div.append(a, p); results.append(div); }
    } catch { results.textContent = 'Search could not load. Use the guide topics and page contents to browse.'; }
  }
  form.addEventListener('submit', search);
  form.addEventListener('reset', (event) => { event.preventDefault(); query.value = ''; search(); query.focus(); });
  query.value = new URL(location.href).searchParams.get('q') ?? ''; if (query.value) search();
  const filters = document.querySelector('.activity-filters');
  if (filters) {
    const rows = [...document.querySelectorAll('.activity-overview tbody tr')];
    function filterActivities() {
      const need = filters.elements.need.value, outcome = filters.elements.outcome.value;
      let count = 0;
      for (const row of rows) {
        const helps = row.dataset.helps.split(' ').filter(Boolean), costs = row.dataset.costs.split(' ').filter(Boolean);
        const includesNeed = !need || helps.includes(need) || costs.includes(need);
        const matchesOutcome = !outcome || (outcome === 'helps' && (need ? helps.includes(need) : helps.length > 0)) || (outcome === 'costs' && (need ? costs.includes(need) : costs.length > 0)) || (outcome === 'none' && helps.length === 0) || (outcome === 'feelings' && row.dataset.harmsFeelings === 'true');
        row.hidden = !(includesNeed && matchesOutcome);
        if (!row.hidden) count++;
      }
      filters.querySelector('[role="status"]').textContent = count ? `${count} matching ${count === 1 ? 'activity' : 'activities'}. Read each row for conditions and exceptions.` : 'No activities match. Change a filter or choose Show all activities.';
    }
    filters.hidden = false;
    filters.addEventListener('submit', event => event.preventDefault());
    filters.addEventListener('change', filterActivities);
    filters.addEventListener('reset', event => { event.preventDefault(); filters.elements.need.value = ''; filters.elements.outcome.value = ''; filterActivities(); });
    filterActivities();
  }
})();
