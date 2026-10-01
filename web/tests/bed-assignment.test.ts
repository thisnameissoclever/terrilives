import { describe, expect, it } from 'vitest';
import type { BedAssignmentResult, BedPlace, BedPlaceStatus } from '../src/bridge.js';
import { BedAssignmentPanel, type BedAssignmentSource, type BedAssignmentState } from '../src/ui/bed-assignment.js';

const first: BedPlaceStatus = { bed: 10, ordinal: 0, label: 'Double bed at (4, 6), place 1',
  assignee: null, occupant: 8, assigneeName: null, occupantName: 'Bill' };
const second: BedPlaceStatus = { ...first, ordinal: 1, label: 'Double bed at (4, 6), place 2',
  assignee: 8, assigneeName: 'Bill', occupant: null, occupantName: null };
class Source implements BedAssignmentSource {
  selected: number | null = 7;
  rows: readonly BedPlaceStatus[] | null = [first, second];
  result: BedAssignmentResult | null = null;
  reads = 0;
  accepted = true;
  sent: { agent: number; place: BedPlace | null }[] = [];
  selectedIndex() { return this.selected; }
  bedPlacesOf() { this.reads++; return this.rows; }
  lastBedAssignmentResult() { return this.result; }
  setBedAssignment(agent: number, place: BedPlace | null) { this.sent.push({ agent, place }); return this.accepted; }
}
function fixture() {
  const source = new Source();
  const states: BedAssignmentState[] = [];
  let active = true;
  const panel = new BedAssignmentPanel(source, state => states.push(state), 100, () => active);
  panel.update(0);
  return { source, panel, state: () => states.at(-1)!, active: (value: boolean) => { active = value; } };
}

describe('bed assignment controller', () => {
  it('permits assigning an occupied unassigned place, waits for its result and blocks duplicates', () => {
    const { source, panel, state } = fixture();
    panel.choose(first); panel.assign(); panel.assign(); panel.clear();
    expect(source.sent).toEqual([{ agent: 7, place: { bed: 10, ordinal: 0 } }]);
    expect(state().pending).toBe(true);
    expect(state().status).toBe('Applying assignment…');
    panel.afterCommands();
    expect(state().pending).toBe(true);
    source.rows = [{ ...first, assignee: 7, assigneeName: 'Tim' }, second];
    source.result = { sequence: 1n, agent: 7, place: { bed: 10, ordinal: 0 }, reason: null };
    panel.afterCommands();
    expect(state()).toMatchObject({ pending: false, status: 'Sleeping place assigned.', places: source.rows });
    panel.clear();
    expect(source.sent.at(-1)).toEqual({ agent: 7, place: null });
    source.rows = [first, second];
    source.result = { sequence: 2n, agent: 7, place: null, reason: null };
    panel.afterCommands();
    expect(state().status).toBe('Assignment cleared.');
  });

  it('does not send another Sim’s assignment or clear an absent assignment', () => {
    const { source, panel, state } = fixture();
    panel.choose(second); panel.assign(); panel.clear();
    expect(source.sent).toEqual([]);
    expect(state().choice).toBeNull();
    panel.choose(first);
    source.rows = [{ ...first, assignee: 9, assigneeName: 'Casey' }, second];
    panel.assign();
    expect(source.sent).toEqual([]);
    expect(state().status).toContain('no longer available');
  });

  it('reports enqueue failure and drain refusal without claiming success', () => {
    const { source, panel, state } = fixture();
    source.accepted = false;
    panel.choose(first); panel.assign();
    expect(state()).toMatchObject({ pending: false, status: 'That assignment could not be sent.' });
    source.accepted = true;
    panel.assign();
    source.result = { sequence: 1n, agent: 7, place: first, reason: 'That bed is no longer here.' };
    source.rows = [];
    panel.afterCommands();
    expect(state()).toMatchObject({ pending: false, status: 'That bed is no longer here.', places: [], choice: null });
  });

  it('handles unrelated newer feedback and exact bigint sequences without waiting forever', () => {
    const { source, panel, state } = fixture();
    source.result = { sequence: 9007199254740992n, agent: 9, place: null, reason: null };
    panel.choose(first); panel.assign(); panel.afterCommands();
    expect(state().pending).toBe(true);
    source.result = { sequence: 9007199254740993n, agent: 8, place: second, reason: null };
    panel.afterCommands();
    expect(state()).toMatchObject({ pending: false, status: 'Another assignment was handled. Check the current assignment.' });
  });

  it('clears draft and pending state immediately on selection changes, including while closed', () => {
    const { source, panel, state, active } = fixture();
    panel.choose(first); panel.assign(); active(false);
    source.selected = 8;
    source.result = { sequence: 1n, agent: 7, place: first, reason: null };
    panel.afterCommands();
    expect(state()).toMatchObject({ agent: 8, pending: false, status: '', choice: null, places: null });
    const reads = source.reads;
    panel.update(200);
    expect(source.reads).toBe(reads);
    panel.update(201, true);
    expect(state().places).toEqual(source.rows);
    panel.choose(first);
    source.selected = null;
    panel.assign();
    expect(source.sent).toHaveLength(1);
    expect(state()).toMatchObject({ agent: null, choice: null, places: null });
  });

  it('refreshes a same-index loaded world and ignores feedback from the replaced world', () => {
    const { source, panel, state } = fixture();
    panel.choose(first); panel.assign();
    source.result = null;
    source.rows = [];
    panel.resetAfterLoad(); panel.update(1, true); panel.afterCommands();
    expect(state()).toMatchObject({ agent: 7, places: [], choice: null, pending: false, status: '' });
  });

  it('throttles open reads, skips closed reads and still settles a closed panel’s pending command', () => {
    const { source, panel, state, active } = fixture();
    expect(source.reads).toBe(1);
    panel.update(99); expect(source.reads).toBe(1);
    panel.update(100); expect(source.reads).toBe(2);
    panel.choose(first); panel.assign();
    active(false);
    const reads = source.reads;
    panel.update(300); expect(source.reads).toBe(reads);
    source.result = { sequence: 1n, agent: 7, place: first, reason: null };
    panel.afterCommands();
    expect(state().pending).toBe(false);
    expect(source.reads).toBe(reads + 1);
  });
});
