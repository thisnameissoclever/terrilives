import {readFileSync} from 'node:fs';
import {beforeAll,expect,it,vi} from 'vitest';
import init,{SimHandle} from '../src/wasm/terri_wasm.js';
import {SimBridge} from '../src/bridge.js';
import {WorkOrderConfirmation,type WorkConflict} from '../src/ui/work-order-confirmation.js';

let memory:WebAssembly.Memory;
beforeAll(async()=>{memory=(await init({module_or_path:readFileSync('src/wasm/terri_wasm_bg.wasm')})).memory;});

it('fails an invalid future action immediately and preserves a loadable queue with exact order identities',()=>{
  const handle=SimHandle.from_lot(),bridge=new SimBridge(handle,memory);
  try {
    const actor=Array.from(bridge.ids()).find((entity,row)=>bridge.kinds()[row]===0&&bridge.simName(entity)==='Casey')!;
    const bed=Array.from(bridge.ids()).find((entity,row)=>bridge.kinds()[row]!==0&&bridge.objectModel(entity)?.id==='bed')!;
    expect(actor).toBeDefined();expect(bed).toBeDefined();
    expect(bridge.useObject(actor,bed,0)).toBe(true);bridge.flushCommands();
    const valid=bridge.actionQueueRowsOf(actor).filter(row=>row.orderId!==null);
    expect(valid).toHaveLength(1);
    const cursor=bridge.orderEventsSince('0').nextCursor;
    expect(bridge.useObject(actor,bed,999)).toBe(true);bridge.flushCommands();
    expect(bridge.actionQueueRowsOf(actor).filter(row=>row.orderId!==null)).toEqual(valid);
    const outcomes=bridge.orderEventsSince(cursor).events;
    expect(outcomes.map(event=>event.phase)).toEqual(['accepted','failed']);
    expect(outcomes[0].orderId).not.toBe(valid[0].orderId);
    expect(outcomes[1].orderId).toBe(outcomes[0].orderId);
    expect(outcomes[1].reason).toBe('Unknown object action');
    const saved=bridge.saveBytes(),hash=bridge.worldHash();
    expect(bridge.loadBytes(saved)).toBe(true);
    expect(bridge.worldHash()).toBe(hash);
    expect(bridge.actionQueueRowsOf(actor).filter(row=>row.orderId!==null)).toEqual(valid);
  } finally {handle.free();}
});

it('cancels a real multi-person work warning without mutation and accepts repeated confirmed orders in one paused batch',()=>{
  const handle=SimHandle.from_lot(),bridge=new SimBridge(handle,memory);
  try {
    const household=Array.from(bridge.ids()).filter((_,row)=>bridge.kinds()[row]===0);
    const people=['Tim','Bill'].map(name=>household.find(entity=>bridge.simName(entity)===name)!);
    expect(people).toHaveLength(2);
    expect(people.every(entity=>entity!==undefined)).toBe(true);
    const bed=Array.from(bridge.ids()).find((entity,row)=>bridge.kinds()[row]!==0&&bridge.objectModel(entity)?.id==='bed')!;
    expect(bed).toBeDefined();
    expect(bridge.setCareerAutonomy(false,false)).toBe(true);
    for(const person of people)expect(bridge.assignCareer(person,0)).toBe(true);
    bridge.flushCommands();
    expect(people.map(person=>bridge.careerOf(person))).toEqual(['Office clerk','Office clerk']);
    const start=bridge.careerScheduleOf(people[0])!.shiftStart;
    for(let tick=0;tick<start;tick++)bridge.tick();
    const show=vi.fn((_conflict:WorkConflict)=>{}),pause={suspend:vi.fn(),resume:vi.fn()};
    const confirmation=new WorkOrderConfirmation(bridge,pause,{show,close:vi.fn(),returnFocus:vi.fn()});
    bridge.setOrderGate((participants,submit)=>confirmation.request(participants,submit));
    const before=bridge.worldHash();
    expect(bridge.talkTo(people[0],people[1],0)).toBe(true);
    expect(show.mock.calls[0][0].people.map((person:{entity:number})=>person.entity)).toEqual(people);
    confirmation.cancel();bridge.flushCommands();
    expect(bridge.worldHash()).toBe(before);
    expect(bridge.actionQueueRowsOf(people[0]).filter(row=>row.orderId!==null)).toEqual([]);

    const cursor=bridge.orderEventsSince('0').nextCursor;
    expect(bridge.useObject(people[0],bed,0)).toBe(true);confirmation.proceed();
    expect(bridge.useObject(people[0],bed,0)).toBe(true);confirmation.proceed();
    bridge.flushCommands();
    const events=bridge.orderEventsSince(cursor).events;
    expect(events.filter(event=>event.phase==='rejected')).toEqual([]);
    const accepted=events.filter(event=>event.phase==='accepted'&&event.actor===people[0]);
    expect(accepted).toHaveLength(2);
    expect(new Set(accepted.map(event=>event.orderId)).size).toBe(2);
    expect(bridge.actionQueueRowsOf(people[0]).filter(row=>row.orderId!==null).map(row=>row.orderId)).toEqual(accepted.map(event=>event.orderId));
    expect(pause.suspend).toHaveBeenCalledWith('work-order');
  } finally {handle.free();}
});
