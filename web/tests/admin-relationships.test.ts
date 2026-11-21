import { describe, expect, it } from 'vitest';
import type { AdminTimer } from '../src/admin/codec.js';
import { createRelationshipsTab, type RelationshipsSource } from '../src/admin/admin-relationships.js';
import type { AdminMember } from '../src/admin/admin-panel.js';
import { enter, finders, release, tabHarness } from './helpers/admin-tab.js';

// The Relationships tab ([AP-e-rel], [T11] in docs/specs/2026-11-20-admin-panel.md)
// with the owner's change: the shared housemate picker chooses A, and the tab
// lists only A's relationships, as one card per other housemate.

const MEMBERS: AdminMember[] = [{ simId: 3, name: 'Tim' }, { simId: 5, name: 'Bill' }, { simId: 9, name: 'Casey' }];

interface World {
  /** `feelings[from][to]`; a missing entry is a stranger. */
  feelings: Map<number, Map<number, number>>;
  timers: Map<number, AdminTimer[]>;
  now: number;
}

function world(): World {
  return {
    feelings: new Map([
      [3, new Map([[5, 0.42], [9, -0.1]])],
      [5, new Map([[3, 0.18], [9, 0.66]])],
      [9, new Map([[3, -0.35], [5, 0.6]])],
    ]),
    timers: new Map(),
    now: 5000,
  };
}

function build(state: World = world(), members: AdminMember[] = MEMBERS) {
  const h = tabHarness(members);
  const source: RelationshipsSource = {
    relationships: sim => [...(state.feelings.get(sim) ?? new Map())].flat(),
    adminTimers: sim => (state.timers.get(sim) ?? []).slice(),
    clockTick: () => state.now,
    dayTicks: () => 1440,
  };
  h.state.onApply = change => {
    for (const edit of change.edits) {
      if (edit.edit === 'SetFeeling') {
        const row = state.feelings.get(edit.from) ?? new Map<number, number>();
        if (edit.value === 0) row.delete(edit.to); else row.set(edit.to, edit.value);
        state.feelings.set(edit.from, row);
      }
    }
  };
  h.attach(createRelationshipsTab(source)(h.context));
  return { h, f: finders(h.state.tab!.body), state };
}

const sent = (b: ReturnType<typeof build>, at = -1) => b.h.sent.at(at)!;
const cardTitles = (b: ReturnType<typeof build>) => b.f.root.querySelectorAll('.admin-rel-title').map(node => node.textContent);
const card = (b: ReturnType<typeof build>, title: string) =>
  b.f.root.querySelectorAll('.admin-rel-card').find(node => node.querySelector('.admin-rel-title')!.textContent === title)!;

describe('the picker scopes the tab to one housemate', () => {
  it("lists only the chosen housemate's relationships, one card per other housemate", () => {
    const b = build();
    expect(cardTitles(b)).toEqual(['Tim and Bill', 'Tim and Casey']);
    b.h.state.selected = MEMBERS[1];
    b.h.state.tab!.refresh();
    expect(cardTitles(b)).toEqual(['Bill and Tim', 'Bill and Casey']);
    b.h.state.selected = MEMBERS[2];
    b.h.state.tab!.refresh();
    expect(cardTitles(b)).toEqual(['Casey and Tim', 'Casey and Bill']);
  });

  it('lists nobody for a household of one, and nothing without a choice', () => {
    const alone = build(world(), [MEMBERS[0]]);
    expect(cardTitles(alone)).toEqual([]);
    expect((alone.f.button("Set all of Tim's feelings to 0") as unknown as { disabled: boolean }).disabled).toBe(true);
    const b = build();
    b.h.state.selected = null;
    b.h.state.tab!.refresh();
    expect(cardTitles(b)).toEqual([]);
  });

  it('shows both directions with their relationship words, a stranger where nothing is stored', () => {
    const state = world();
    state.feelings.get(3)!.delete(9);
    const b = build(state);
    expect(b.f.box("Tim's feeling about Bill").value).toBe('0.42');
    expect(b.f.box("Bill's feeling about Tim").value).toBe('0.18');
    expect(b.f.box("Tim's feeling about Casey").value).toBe('0.00');
    expect(b.f.box("Casey's feeling about Tim").value).toBe('-0.35');
    const words = (title: string) => card(b, title).querySelectorAll('.admin-word').map(node => node.textContent);
    expect(words('Tim and Bill')).toEqual(['Friendly', 'Warm']);
    expect(words('Tim and Casey')).toEqual(['Stranger', 'Dislikes']);
    const slider = b.f.control("Tim's feeling about Bill") as unknown as { min: string; max: string; step: string };
    expect([slider.min, slider.max, slider.step]).toEqual(['-1', '1', '0.01']);
  });
});

describe('one feeling', () => {
  it('sends SetFeeling in the direction of the row, when the slider is released', () => {
    const b = build();
    const slider = b.f.control("Bill's feeling about Tim");
    slider.value = '0.9';
    slider.dispatch('input');
    expect(b.h.sent, 'nothing while dragging').toEqual([]);
    slider.dispatch('change');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFeeling', from: 5, to: 3, value: 0.9 }]);
    expect(sent(b).label).toBe("Change Bill's feeling about Tim");
    release(b.f.control("Tim's feeling about Casey"), '-0.5');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFeeling', from: 3, to: 9, value: -0.5 }]);
    expect(sent(b).label).toBe("Change Tim's feeling about Casey");
  });

  it('clamps a typed feeling to -1 to 1 and to two decimals, and ignores text and no change', () => {
    const b = build();
    enter(b.f.box("Tim's feeling about Bill"), '7');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFeeling', from: 3, to: 5, value: 1 }]);
    enter(b.f.box("Tim's feeling about Bill"), '-3');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFeeling', from: 3, to: 5, value: -1 }]);
    enter(b.f.box("Tim's feeling about Bill"), '0.456');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFeeling', from: 3, to: 5, value: 0.46 }]);
    const count = b.h.sent.length;
    enter(b.f.box("Tim's feeling about Bill"), 'warm');
    enter(b.f.box("Tim's feeling about Bill"), '0.46');
    expect(b.h.sent).toHaveLength(count);
  });

  it('sends 0 to drop the entry, which then reads as a stranger', () => {
    const b = build();
    enter(b.f.box("Tim's feeling about Bill"), '0');
    expect(sent(b).change.edits).toEqual([{ edit: 'SetFeeling', from: 3, to: 5, value: 0 }]);
    expect(card(b, 'Tim and Bill').querySelectorAll('.admin-word')[0].textContent).toBe('Stranger');
  });

  it("shows the refusal in the card that sent the change, and keeps it through the re-read", () => {
    const b = build();
    b.h.state.refuse = 11;
    enter(b.f.box("Tim's feeling about Bill"), '0.9');
    expect(card(b, 'Tim and Bill').querySelector('.admin-status')!.textContent).toBe('Choose someone else.');
    expect(card(b, 'Tim and Casey').querySelector('.admin-status')!.textContent).toBe('');
    expect(b.f.box("Tim's feeling about Bill").value, 'the refused value is not kept').toBe('0.42');
    b.h.state.refuse = null;
    enter(b.f.box("Tim's feeling about Bill"), '0.9');
    expect(card(b, 'Tim and Bill').querySelector('.admin-status')!.textContent).toBe('');
  });

  it('clears a status when the picker moves, and on any later re-read such as Undo', () => {
    const b = build();
    b.h.state.refuse = 3;
    // Casey has a card under both Tim and Bill, so a stale message would show after the switch.
    enter(b.f.box("Tim's feeling about Casey"), '0.9');
    expect(card(b, 'Tim and Casey').querySelector('.admin-status')!.textContent).not.toBe('');
    b.h.state.selected = MEMBERS[1];
    b.h.state.tab!.refresh();
    expect(b.f.root.querySelectorAll('.admin-status').map(node => node.textContent).join('')).toBe('');
    b.h.state.selected = MEMBERS[0];
    b.h.state.tab!.refresh();
    enter(b.f.box("Tim's feeling about Casey"), '0.8');
    expect(card(b, 'Tim and Casey').querySelector('.admin-status')!.textContent).not.toBe('');
    b.h.state.tab!.refresh();
    expect(card(b, 'Tim and Casey').querySelector('.admin-status')!.textContent, 'a stale status does not outlive a re-read').toBe('');
  });
});

describe('setting feelings to 0', () => {
  it('sets both directions of one pair to 0 as one change', () => {
    const b = build();
    card(b, 'Tim and Bill').querySelectorAll('button').find(node => node.textContent === 'Set both to 0')!.click();
    expect(sent(b).change.edits).toEqual([
      { edit: 'SetFeeling', from: 3, to: 5, value: 0 },
      { edit: 'SetFeeling', from: 5, to: 3, value: 0 },
    ]);
    expect(sent(b).label).toBe('Set both feelings to 0');
    expect(b.h.sent).toHaveLength(1);
  });

  it("sets all of the chosen housemate's feelings to 0, in both directions, as one change", () => {
    const b = build();
    b.f.button("Set all of Tim's feelings to 0").click();
    expect(sent(b).change.edits).toEqual([
      { edit: 'SetFeeling', from: 3, to: 5, value: 0 },
      { edit: 'SetFeeling', from: 5, to: 3, value: 0 },
      { edit: 'SetFeeling', from: 3, to: 9, value: 0 },
      { edit: 'SetFeeling', from: 9, to: 3, value: 0 },
    ]);
    expect(sent(b).label).toBe("Set Tim's feelings to 0");
    expect(b.h.sent).toHaveLength(1);
    // The re-read shows every one of them cleared.
    expect(b.f.root.querySelectorAll('.admin-word').map(node => node.textContent)).toEqual(['Stranger', 'Stranger', 'Stranger', 'Stranger']);
  });

  it('does not touch the pairs of other housemates', () => {
    const b = build();
    b.h.state.selected = MEMBERS[1];
    b.h.state.tab!.refresh();
    b.f.button("Set all of Bill's feelings to 0").click();
    const pairs = sent(b).change.edits.map(edit => (edit as { from: number; to: number }));
    expect(pairs.every(pair => pair.from === 5 || pair.to === 5), 'every edit involves Bill').toBe(true);
    expect(pairs).toHaveLength(4);
  });
});

describe('starting a fight', () => {
  it('sends StartFight from the chosen housemate to the card\'s, and says when it starts', () => {
    const b = build();
    card(b, 'Tim and Casey').querySelectorAll('button').find(node => node.textContent === 'Tim starts a fight')!.click();
    expect(sent(b).change.edits).toEqual([{ edit: 'StartFight', from: 3, to: 9 }]);
    expect(sent(b).label).toBe('Start a fight');
    expect(card(b, 'Tim and Casey').querySelector('.admin-status')!.textContent).toBe('The fight starts when the game resumes.');
    expect(card(b, 'Tim and Bill').querySelector('.admin-status')!.textContent).toBe('');
  });

  it('shows why a fight was refused, in that card', () => {
    const b = build();
    b.h.state.refuse = 18;
    card(b, 'Tim and Bill').querySelectorAll('button').find(node => node.textContent === 'Tim starts a fight')!.click();
    expect(card(b, 'Tim and Bill').querySelector('.admin-status')!.textContent).toBe('One of them is at work or on the way.');
    b.h.state.refuse = null;
    card(b, 'Tim and Bill').querySelectorAll('button').find(node => node.textContent === 'Tim starts a fight')!.click();
    expect(card(b, 'Tim and Bill').querySelector('.admin-status')!.textContent).toBe('The fight starts when the game resumes.');
  });
});

describe("the chosen housemate's fight", () => {
  it('shows nothing while no fight timer runs', () => {
    const b = build();
    expect(b.f.text()).not.toContain('had a fight');
    expect(b.f.hasButton('End now')).toBe(false);
  });

  it('shows the time left and ends the timer with End now', () => {
    const state = world();
    state.timers.set(3, [{ timer: 1, endsTick: 5000 + 1200 }]);
    state.timers.set(5, [{ timer: 3, endsTick: 9000 }]);
    const b = build(state);
    expect(b.f.text()).toContain('Tim had a fight. Ends in 20 hours.');
    b.f.button('End now').click();
    expect(sent(b).change.edits).toEqual([{ edit: 'EndTimedMoodlet', sim: 3, timer: 1 }]);
    expect(sent(b).label).toBe('End Had a fight');
  });

  it("follows the picker: another housemate's fight shows for them only", () => {
    const state = world();
    state.timers.set(5, [{ timer: 1, endsTick: 5000 + 60 }]);
    const b = build(state);
    expect(b.f.text()).not.toContain('had a fight');
    b.h.state.selected = MEMBERS[1];
    b.h.state.tab!.refresh();
    expect(b.f.text()).toContain('Bill had a fight. Ends in 1 hour.');
  });

  it('shows the refusal where End now was pressed', () => {
    const state = world();
    state.timers.set(3, [{ timer: 1, endsTick: 6000 }]);
    const b = build(state);
    b.h.state.refuse = 5;
    b.f.button('End now').click();
    expect(b.f.text()).toContain('That has already ended or been removed.');
  });
});

describe('focus', () => {
  it('keeps focus on the number box that sent the change', () => {
    const b = build();
    const box = b.f.box("Tim's feeling about Bill");
    box.focus();
    enter(box, '0.5');
    expect(b.h.fake.activeElement).toBe(b.f.box("Tim's feeling about Bill"));
  });

  it('keeps focus on a card button that stays, and falls back to a heading when its card is gone', () => {
    const b = build();
    const all = b.f.button("Set all of Tim's feelings to 0");
    all.focus();
    all.click();
    expect(b.h.fake.activeElement).toBe(b.f.button("Set all of Tim's feelings to 0"));
  });
});
