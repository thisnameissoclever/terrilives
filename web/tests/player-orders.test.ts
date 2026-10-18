import { describe, expect, it, vi } from 'vitest';
import { OrderDiagnostics, formatOrderHistory } from '../src/ui/player-orders.js';
import { WorkOrderConfirmation, formatWorkConflict } from '../src/ui/work-order-confirmation.js';

const event = (sequence: string, phase = 'failed', actor = 7) => ({ sequence, tick: '20', actor, counterpart: 9, orderId: '9007199254740993', action: 'Chat', phase, reason: phase === 'failed' ? 'Target removed' : null, blockingState: null });
describe('order diagnostics', () => {
  it('clears old-world history and bubbles before entity indices can be reused after Load', () => {
    const diagnostics = new OrderDiagnostics({textContent:'',setAttribute:vi.fn()},vi.fn());
    const source = {orderEventsSince:()=>({events:[event('11')],nextCursor:'11',expired:false}),simName:()=> 'Old housemate'};
    diagnostics.update(10,source);
    diagnostics.resetAfterLoad('11');
    expect(diagnostics.history(7)).toBe('No order events for this person.');
    expect(diagnostics.failedActors(11).size).toBe(0);
    const next={orderEventsSince:vi.fn(()=>({events:[event('12','accepted')],nextCursor:'12',expired:false})),simName:()=> 'New housemate'};
    diagnostics.update(20,next);
    expect(next.orderEventsSince).toHaveBeenCalledWith('11');
    expect(diagnostics.history(7)).not.toContain('failed');
  });
  it('consumes each event once and expires frustration after three wall-clock seconds', () => {
    const warn = vi.fn(), status = {textContent: '', setAttribute: vi.fn()};
    const diagnostics = new OrderDiagnostics(status, warn);
    const source = { orderEventsSince: vi.fn(() => ({events: [event('1'), event('2', 'waiting'), event('3', 'completed'), event('4', 'canceled')], nextCursor: '4', expired: false})), simName: () => 'Terri' };
    diagnostics.update(100, source); diagnostics.update(200, source);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('Terri: Chat failed. Target removed');
    expect(diagnostics.failedActors(3099)).toEqual(new Set([7]));
    expect(diagnostics.failedActors(3100)).toEqual(new Set());
    expect(source.orderEventsSince).toHaveBeenLastCalledWith('4');
  });
  it('filters history by either participant and reports expired records', () => {
    const text = formatOrderHistory([event('1'), event('2', 'waiting', 8), event('3', 'started', 3)], 7, true);
    expect(text).toContain('Earlier events have expired'); expect(text).toContain('#9007199254740993');
    expect(text).toContain('Target removed'); expect(text).not.toContain('waiting');
    expect(formatOrderHistory([event('1')], 9, false)).toContain('Chat');
  });
  it('announces rejected work approval once without displaying frustration', () => {
    const warn=vi.fn(),status={textContent:'',setAttribute:vi.fn()},diagnostics=new OrderDiagnostics(status,warn);
    const rejected={...event('1','rejected'),reason:'Work circumstances changed. Give the order again.'};
    const source={orderEventsSince:()=>({events:[rejected],nextCursor:'1',expired:false}),simName:()=> 'Terri'};
    diagnostics.update(0,source); diagnostics.update(1,source);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('Terri: Chat was not added. Work circumstances changed. Give the order again.');
    expect(diagnostics.failedActors(1).size).toBe(0);
  });
});
describe('work order confirmation', () => {
  const conflict = {token:'19', people:[{entity:7,name:'Terri',phase:'at_work',remainingMinutes:90,totalMinutes:480},{entity:9,name:'Casey',phase:'due',remainingMinutes:480,totalMinutes:480}]};
  it('shows every person, remaining/total hours and consequences', () => {
    const text = formatWorkConflict(conflict);
    expect(text).toContain('Terri'); expect(text).toContain('Casey'); expect(text).toContain('1.5 of 8');
    expect(text).toContain('Pay'); expect(text).toContain('performance');
  });
  it('cancel never submits and proceed uses the displayed token only once, restoring pause and focus', () => {
    const pause = {suspend:vi.fn(),resume:vi.fn()}, show = vi.fn(), close = vi.fn(), focus = vi.fn(), submit = vi.fn(() => true);
    const confirmation = new WorkOrderConfirmation({workConflictsOf:()=>conflict},pause,{show,close,returnFocus:focus});
    expect(confirmation.request([7,9],submit)).toBe(true); expect(submit).not.toHaveBeenCalled();
    expect(pause.suspend).toHaveBeenCalledWith('work-order');
    confirmation.cancel(); expect(submit).not.toHaveBeenCalled(); expect(pause.resume).toHaveBeenCalledWith('work-order'); expect(focus).toHaveBeenCalledTimes(1);
    confirmation.request([7,9],submit); confirmation.proceed(); confirmation.proceed();
    expect(submit).toHaveBeenCalledExactlyOnceWith('19'); expect(show).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(2);
  });
  it('retains distinct sequence identities above the JavaScript integer precision limit', () => {
    const diagnostics = new OrderDiagnostics({textContent:'',setAttribute:vi.fn()},vi.fn());
    const batches=[{events:[event('9007199254740992','accepted')],nextCursor:'9007199254740992',expired:false},
      {events:[event('9007199254740993','started')],nextCursor:'9007199254740993',expired:false}];
    const source={orderEventsSince:()=>batches.shift()!,simName:()=> 'Terri'};
    diagnostics.update(0,source); diagnostics.update(1,source);
    expect(diagnostics.history(7)).toContain('9007199254740992 tick');
    expect(diagnostics.history(7)).toContain('9007199254740993 tick');
  });
  it('submits conflict-free orders immediately and blocks additional requests while deciding', () => {
    const submit=vi.fn(()=>true), pause={suspend:vi.fn(),resume:vi.fn()}, view={show:vi.fn(),close:vi.fn(),returnFocus:vi.fn()};
    const immediate=new WorkOrderConfirmation({workConflictsOf:()=>({token:'1',people:[]})},pause,view);
    immediate.request([7],submit); expect(submit).toHaveBeenCalledExactlyOnceWith(); expect(pause.suspend).not.toHaveBeenCalled();
    const pending=new WorkOrderConfirmation({workConflictsOf:()=>conflict},pause,view);
    pending.request([7],submit); expect(pending.request([9],submit)).toBe(false); expect(view.show).toHaveBeenCalledTimes(1);
  });
  it('reports stale rejected approval without submitting a second order', () => {
    const rejected = vi.fn(), submit = vi.fn(() => false);
    const confirmation = new WorkOrderConfirmation({workConflictsOf:()=>conflict},{suspend:vi.fn(),resume:vi.fn()},
      {show:vi.fn(),close:vi.fn(),returnFocus:vi.fn(),rejected});
    confirmation.request([7],submit); confirmation.proceed();
    expect(rejected).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
  });
});
