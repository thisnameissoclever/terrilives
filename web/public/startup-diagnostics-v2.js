/* This recorder runs before the game module and has no game or graphics dependency. */
(function (window, document) {
  'use strict';
  const KEY = 'terrilives.startup-report.v1';
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  let storage;
  try { storage = window.localStorage; } catch {}
  function read() {
    try {
      const raw = storage?.getItem(KEY);
      if (!raw || raw.length > 32768) return [];
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.attempts)) return [];
      return saved.attempts.filter(row => row && typeof row === 'object'
        && ['loading', 'ready', 'failed'].includes(row.state)).slice(-3);
    } catch { return []; }
  }
  function path(value) {
    try { return new URL(value, window.location.href).pathname.slice(0, 512); }
    catch { return ''; }
  }
  function httpFailure(value) {
    if (!value || typeof value !== 'object') return undefined;
    const allowed = ['server', 'content-type', 'retry-after', 'age', 'via', 'x-cache',
      'x-served-by', 'x-github-request-id', 'x-fastly-request-id'];
    return {path: path(value.path), status: Number(value.status),
      headers: Object.fromEntries(allowed.flatMap(name => {
        const found = text(value.headers?.[name], 160); return found ? [[name, found]] : [];
      })), body: text(value.body, 1024), bodyIncomplete: value.bodyIncomplete === true};
  }
  function gameVersion(value) {
    return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(value) ? value : '';
  }
  function shareReport(report, notice) {
    const last=report.attempts[report.attempts.length-1];
    const recorded=gameVersion(last?.gameVersion);
    const current=gameVersion(document.querySelector('meta[name="natural-causes-version"]')?.content);
    return {...report,reportContext:{gameVersion:recorded||current||'unknown',versionSource:recorded?'recorded attempt':'report page',
      reportedAt:new Date().toISOString(),browser:text(window.navigator.userAgent,512),
      ...(notice?{visibleFailure:{title:text(notice.title,160),detail:text(notice.detail,4096)}}:{})}};
  }
  function bindSharing(report) {
    const payload=JSON.stringify(report,null,2),copy=document.getElementById('startup-report-copy');
    const email=document.getElementById('startup-report-email'),status=document.getElementById('startup-report-share-status');
    const manual=document.getElementById('startup-report-manual');
    if(email){
      const subject='[Bug report] Natural Causes v'+report.reportContext.gameVersion;
      email.href='mailto:bugreport@stfuai.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(payload.replace(/\r?\n/g,'\r\n'));
    }
    if(copy&&!copy.dataset.startupShareBound){
      copy.dataset.startupShareBound='true';copy.disabled=false;
      copy.addEventListener('click',async()=>{
        try{
          await window.navigator.clipboard.writeText(payload);
          if(manual)manual.hidden=true;
          if(status)status.textContent='Copied. Send these details to Tim.';
        }catch{
          if(status)status.textContent='Copy was blocked by your browser. Select and copy the details below.';
          if(manual){manual.value=payload;manual.hidden=false;manual.focus();manual.select();}
        }
      });
    }
  }
  function renderReport() {
    const report = shareReport({version: 1, attempts: read()}), output = document.getElementById('startup-report-data');
    const summary = document.getElementById('startup-report-summary');
    const last = report.attempts[report.attempts.length - 1];
    if (output) output.textContent = JSON.stringify(report, null, 2);
    if (summary) summary.textContent = !last ? 'No startup report was saved in this browser.'
      : last.state === 'loading' ? 'The last recorded load is unfinished. Its last step appears below. This can also mean the page was closed during loading.'
      : last.state === 'failed' ? 'The last recorded attempt reported an error. Its details appear below.'
      : 'The last recorded attempt completed its first graphics frame.';
    bindSharing(report);
    const button = document.getElementById('startup-report-download');
    if (button) {
      button.disabled = !last;
      button.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type: 'application/json'}));
        const link = document.createElement('a');
        link.href = url; link.download = 'natural-causes-startup-report.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    }
  }
  if (document.documentElement.hasAttribute('data-startup-report')) {
    renderReport(); return;
  }
  const attempts = read(), step = document.getElementById('startup-loading-step');
  const current = {startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), state: 'loading',
    phase: text(step?.textContent, 160), build: path(document.querySelector('script[type="module"][src]')?.src),
    gameVersion:gameVersion(document.querySelector('meta[name="natural-causes-version"]')?.content)||'unknown',
    environment: {userAgent: text(window.navigator.userAgent, 512), width: window.innerWidth,
      height: window.innerHeight, pixelRatio: window.devicePixelRatio, secure: window.isSecureContext,
      webgpu: !!window.navigator.gpu}};
  attempts.push(current);
  function save() {
    current.updatedAt = new Date().toISOString();
    while (attempts.length > 3) attempts.shift();
    let raw = JSON.stringify({version: 1, attempts});
    while (raw.length > 32768 && attempts.length > 1) {
      attempts.shift(); raw = JSON.stringify({version: 1, attempts});
    }
    try { storage?.setItem(KEY, raw); } catch {}
  }
  save();
  const observer = step && typeof MutationObserver === 'function' ? new MutationObserver(() => {
    if (current.state !== 'loading') return;
    const phase = text(step.textContent, 160);
    if (phase !== current.phase) { current.phase = phase; save(); }
  }) : null;
  observer?.observe(step, {childList: true, characterData: true, subtree: true});
  function failed(error) {
    if (current.state !== 'loading') return;
    current.state = 'failed';
    current.error = {name: text(error?.name, 160), message: text(error?.message ?? String(error), 4096),
      stack: text(error?.stack, 2048), workerStack:text(error?.workerStack,4096)||undefined,
      workerErrorName:text(error?.workerErrorName,160)||undefined,workerKind:text(error?.workerKind,64)||undefined,
      assetFailure: httpFailure(error?.assetFailure)};
    observer?.disconnect(); save();
  }
  window.addEventListener('terrilives:startup-failure', event => failed(event.detail));
  window.addEventListener('terrilives:startup-report-controls',event=>bindSharing(shareReport({version:1,attempts},event.detail)));
  window.addEventListener('error', event => failed(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => failed(event.reason));
  window.addEventListener('terrilives:startup-ready', () => {
    if (current.state !== 'loading') return;
    current.state = 'ready'; observer?.disconnect(); save();
  });
})(window, document);
