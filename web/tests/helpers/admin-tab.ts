import { expect } from 'vitest';
import type { AdminTab, AdminTabContext, AdminMember, AdminApplyOptions } from '../../src/admin/admin-panel.js';
import { encodeAdminChange, type AdminApplyResult, type AdminChange, type AdminRefusalCode } from '../../src/admin/codec.js';
import { refusalText } from '../../src/admin/admin-words.js';
import { FakeNode, fakeDocument } from './fake-dom.js';

/**
 * A stand-in for the shell's side of one admin tab: it records every change
 * the tab sends, answers it (applied, or refused with a code), and then does
 * what the real shell does, in the same order: re-read every tab, then hand
 * the refusal sentence, or null, to the tab's `report`.
 */
export function tabHarness(members: AdminMember[]) {
  const { fake, doc } = fakeDocument();
  const sent: { change: AdminChange; label: string }[] = [];
  const state = {
    members,
    selected: members[0] as AdminMember | null,
    /** The next answer; null applies. */
    refuse: null as AdminRefusalCode | null,
    /** What the world does when a change applies, so the next refresh reads it. */
    onApply: (_change: AdminChange) => {},
    tab: null as AdminTab | null,
    depth: 0,
  };
  const context: AdminTabContext = {
    doc,
    members: () => state.members,
    selected: () => state.selected,
    apply(change: AdminChange, options: AdminApplyOptions): AdminApplyResult {
      // The panel hands the encoder exactly this, so a change it cannot encode is a bug here.
      expect(() => encodeAdminChange(change)).not.toThrow();
      sent.push({ change, label: options.label });
      let result: AdminApplyResult;
      if (state.refuse === null) {
        state.depth += 1;
        state.onApply(change);
        result = { applied: true, depth: state.depth };
      } else {
        result = { applied: false, edit: 0, refusal: state.refuse, depth: state.depth };
      }
      state.tab?.refresh();
      if (options.report) {
        if (result.applied) options.report(null);
        else options.report(refusalText(result.refusal, { name: state.selected?.name, ...options.words }));
      }
      return result;
    },
  };
  return { fake, doc, sent, state, context, attach(tab: AdminTab) { state.tab = tab; tab.refresh(); return tab; } };
}

/** Finds helpers over a tab's body. */
export function finders(body: HTMLElement) {
  const root = body as unknown as FakeNode;
  const labelled = (label: string): FakeNode => {
    const found = root.all().find(node => node.getAttribute('aria-label') === label);
    if (!found) throw new Error(`no control named "${label}"`);
    return found;
  };
  return {
    root,
    /** The slider or select named `label`. */
    control: labelled,
    /** The number box beside the slider named `label`. */
    box: (label: string): FakeNode => labelled(`${label} value`),
    has: (label: string): boolean => root.all().some(node => node.getAttribute('aria-label') === label),
    /** The button with this visible text. */
    button: (text: string): FakeNode => {
      const found = root.all().find(node => node.tagName === 'button' && node.textContent === text);
      if (!found) throw new Error(`no button "${text}"`);
      return found;
    },
    hasButton: (text: string): boolean => root.all().some(node => node.tagName === 'button' && node.textContent === text),
    /** A section by its heading. */
    section: (title: string): FakeNode => {
      const found = root.querySelectorAll('.admin-section').find(node => node.querySelector('.admin-section-title')?.textContent === title);
      if (!found) throw new Error(`no section "${title}"`);
      return found;
    },
    status: (title: string): string => {
      const section = root.querySelectorAll('.admin-section').find(node => node.querySelector('.admin-section-title')?.textContent === title);
      if (!section) throw new Error(`no section "${title}"`);
      return section.querySelector('.admin-status')!.textContent;
    },
    text: (): string => root.textContent,
  };
}

/** Types into a number box or select and finishes: what the player's Enter or leaving the field does. */
export function enter(node: FakeNode, value: string): void {
  node.value = value;
  node.dispatch('change');
}

/** Drags a slider: `input` events while moving, then `change` on release. */
export function release(slider: FakeNode, value: string): void {
  slider.value = value;
  slider.dispatch('input');
  slider.dispatch('change');
}
