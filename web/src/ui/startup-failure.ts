/**
 * The visible half of "surfaced rather than swallowed".
 *
 * `main()` catches every startup failure and used to report it with
 * `console.error` alone - which is surfacing it to developers and
 * swallowing it for players, who saw a dark void with one pause button
 * floating in it. That is exactly how the page looked from a phone on
 * the LAN, and the cause took a debugging session to name instead of
 * one on-screen sentence.
 *
 * The sentence matters most for the one failure a player can actually
 * hit today: WebGPU only exists in SECURE contexts. `localhost` counts;
 * a plain `http://192.168.x.x:5173` from another machine does not, so
 * the exact same build that runs on the dev box renders nothing across
 * the room. `describeStartupFailure` names that case specifically,
 * because "WebGPU is not available" is true but useless when the real
 * story is "this address is the problem, not your browser".
 *
 * Split from `main.ts` for the standing reason: the wiring file cannot
 * be tested in Node, and a message chooser is pure arithmetic on three
 * booleans that absolutely can be.
 */

/** What the environment looked like at the moment startup failed. */
export interface StartupEnvironment {
  /** `navigator.gpu` existed at all. */
  readonly webgpu: boolean;
  /** `window.isSecureContext` - https, localhost, or 127.0.0.1. */
  readonly secure: boolean;
}

/** The message, chosen; rendering it is `renderStartupFailure`'s job. */
export interface StartupFailureNotice {
  readonly title: string;
  /** The underlying error, verbatim - the developer-facing truth. */
  readonly detail: string;
  /** Player-facing explanation and what to actually do, in order. */
  readonly hints: readonly string[];
}

/**
 * Chooses what the failure card says. Pure, so the tests can pin every
 * branch without a browser.
 */
export function describeStartupFailure(
  error: unknown,
  env: StartupEnvironment,
): StartupFailureNotice {
  const detail = error instanceof Error ? error.message : String(error);

  if (!env.webgpu && !env.secure) {
    // The LAN case. The browser is fine; the address is the problem.
    return {
      title: 'This address cannot render the game',
      detail,
      hints: [
        'WebGPU only works on secure pages, and a plain http:// address ' +
          'over the network is not one - localhost is the sole exception.',
        'On the machine running the server, open its HTTPS localhost address ' +
          '(the default is https://localhost:5174).',
        'From another device, either serve over HTTPS, or add this exact ' +
          'address to chrome://flags/#unsafely-treat-insecure-origin-as-secure ' +
          'on that device and relaunch its browser.',
      ],
    };
  }

  if (!env.webgpu) {
    return {
      title: 'This browser cannot render the game',
      detail,
      hints: [
        'The game draws with WebGPU, which this browser does not offer.',
        'Recent Chrome or Edge works everywhere; Safari 18 and Firefox ' +
          'are getting there. Try one of those.',
      ],
    };
  }

  return {
    title: 'The game failed to start',
    detail,
    hints: [
      'WebGPU is present, so this is not the usual browser-support ' +
        'problem. The message above is the real error; the console has ' +
        'the full stack.',
    ],
  };
}

/**
 * Puts the notice on screen. Plain DOM and inline styles on purpose:
 * this runs precisely when everything else has failed, so it must not
 * depend on the renderer, the stylesheet pipeline, or anything that
 * could be the thing that broke.
 */
export function renderStartupFailure(
  notice: StartupFailureNotice,
  parent: HTMLElement,
): void {
  const card = document.createElement('div');
  card.dataset.role = 'startup-failure';
  card.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'padding:32px',
    'background:#14161a',
    'color:#e8e6e3',
    'font:16px/1.5 system-ui, sans-serif',
    'text-align:center',
    'z-index:1000',
  ].join(';');

  const title = document.createElement('h1');
  title.textContent = notice.title;
  title.style.cssText = 'font-size:22px;margin:0';

  const detail = document.createElement('p');
  detail.textContent = notice.detail;
  detail.style.cssText = 'margin:0;opacity:0.75;font-family:monospace';

  card.append(title, detail);
  for (const hint of notice.hints) {
    const line = document.createElement('p');
    line.textContent = hint;
    line.style.cssText = 'margin:0;max-width:52em';
    card.append(line);
  }
  parent.append(card);
}
