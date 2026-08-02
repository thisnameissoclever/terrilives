/**
 * The failure card's message chooser, every branch.
 *
 * The card exists because a startup failure used to be console-only -
 * "surfaced rather than swallowed" that swallowed it for players, who
 * saw a dark void with one pause button. The branch that earns the
 * tests is the LAN one: the same build that runs on localhost renders
 * nothing at http://<LAN-IP>:5173, because WebGPU requires a secure
 * context and a plain-http network address is not one. The card must
 * blame the ADDRESS in that case, not the browser, or it sends the
 * player off to install a Chrome they already have.
 */
import { describe, expect, it } from 'vitest';

import {
  describeStartupFailure,
  renderStartupFailure,
} from '../src/ui/startup-failure';

/**
 * The renderer only needs this narrow piece of the DOM. Keeping the fake here
 * tests the accessibility contract without buying a browser-sized dependency
 * merely to assert `setAttribute`, `append`, and `focus` calls.
 */
class FakeDocument {
  activeElement: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    return new FakeElement(this, tagName.toUpperCase());
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style = { cssText: '' };
  id = '';
  inert = false;
  tabIndex = 0;
  textContent: string | null = null;

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {}

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  close(): void {
    this.attributes.delete('open');
  }

  focus(): void {
    if (this.hasAttribute('inert')) return;
    this.ownerDocument.activeElement = this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

describe('describeStartupFailure', () => {
  const gpuMissing = new Error('WebGPU is not available in this browser.');

  it('blames the address, not the browser, on an insecure origin', () => {
    const notice = describeStartupFailure(gpuMissing, {
      webgpu: false,
      secure: false,
    });
    expect(notice.title).toBe('This address cannot render the game');
    // The hints must carry the two actionable moves: localhost on the
    // host machine, and the secure-context story for remote devices.
    const hints = notice.hints.join(' ');
    expect(hints).toContain('https://localhost:5174');
    expect(hints).toContain('secure');
    expect(notice.detail).toBe(gpuMissing.message);
  });

  it('blames the browser when WebGPU is missing on a SECURE page', () => {
    const notice = describeStartupFailure(gpuMissing, {
      webgpu: false,
      secure: true,
    });
    expect(notice.title).toBe('This browser cannot render the game');
    expect(notice.hints.join(' ')).toContain('Chrome');
  });

  it('passes an ordinary error through verbatim when WebGPU exists', () => {
    // A real bug must not hide behind browser-support advice: the
    // player-facing card carries the actual message.
    const notice = describeStartupFailure(new Error('atlas decode failed'), {
      webgpu: true,
      secure: true,
    });
    expect(notice.title).toBe('The game failed to start');
    expect(notice.detail).toBe('atlas decode failed');
  });

  it('stringifies a non-Error throw instead of printing undefined', () => {
    const notice = describeStartupFailure('bare string panic', {
      webgpu: true,
      secure: true,
    });
    expect(notice.detail).toBe('bare string panic');
  });
});

describe('renderStartupFailure', () => {
  it('focuses an announced modal and makes the dead game beneath it inert', () => {
    const document = new FakeDocument();
    const parent = document.createElement('body');
    const canvas = document.createElement('canvas');
    const controls = document.createElement('aside');
    const openDialog = document.createElement('dialog');
    openDialog.setAttribute('open', '');
    parent.append(canvas, controls, openDialog);

    renderStartupFailure(
      {
        title: 'The game failed to start',
        detail: 'atlas decode failed',
        hints: ['Reload the page once.'],
      },
      parent as unknown as HTMLElement,
    );

    expect(canvas.getAttribute('inert')).toBe('');
    expect(controls.getAttribute('inert')).toBe('');
    expect(openDialog.getAttribute('open')).toBeNull();
    expect(openDialog.getAttribute('inert')).toBe('');
    expect(parent.children).toHaveLength(4);

    const card = parent.children[3];
    expect(card.dataset.role).toBe('startup-failure');
    expect(card.getAttribute('role')).toBe('alertdialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    expect(card.getAttribute('aria-labelledby')).toBe(
      'startup-failure-title',
    );
    expect(card.getAttribute('aria-describedby')).toBe(
      'startup-failure-detail startup-failure-hints',
    );
    expect(card.tabIndex).toBe(-1);
    expect(card.getAttribute('inert')).toBeNull();
    expect(document.activeElement).toBe(card);

    const [title, detail, hints] = card.children;
    expect(title.id).toBe('startup-failure-title');
    expect(title.textContent).toBe('The game failed to start');
    expect(detail.id).toBe('startup-failure-detail');
    expect(detail.textContent).toBe('atlas decode failed');
    expect(hints.id).toBe('startup-failure-hints');
    expect(hints.children[0].textContent).toBe('Reload the page once.');
    expect(card.style.cssText).toContain('overflow:auto');
    expect(card.style.cssText).toContain(
      'justify-content:center;justify-content:safe center',
    );
    expect(detail.style.cssText).toContain('overflow-wrap:anywhere');
    expect(hints.style.cssText).toContain('min-width:0');
    expect(hints.children[0].style.cssText).toContain('overflow-wrap:anywhere');
  });
});
