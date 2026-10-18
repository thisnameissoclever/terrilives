import {describe,expect,it,vi} from 'vitest';
import {SimBridge} from '../src/bridge.js';

function fixture() {
  const handle={action_queue_rows_of:vi.fn((..._args:unknown[])=>['9007199254740993','Chat','waiting','incoming','7','Busy']),
    order_events_since:vi.fn((..._args:unknown[])=>['9007199254740993','1','9007199254740993','20','7','9','18446744073709551615','Chat','failed','Target removed','']),
    work_conflicts_of:vi.fn((..._args:unknown[])=>['17','7','Terri','3','90','480']),career_attendance_of:vi.fn((..._args:unknown[])=>new Float32Array([480,300,180,72,10,62,10625,1])),
    enqueue_confirmed_order:vi.fn((..._args:unknown[])=>true),confirm_last_order:vi.fn((..._args:unknown[])=>true),readBook:vi.fn((..._args:unknown[])=>true),clean_chore:vi.fn((..._args:unknown[])=>true),clean_dishes:vi.fn((..._args:unknown[])=>true)};
  const bridge=new SimBridge(handle as unknown as ConstructorParameters<typeof SimBridge>[0],new WebAssembly.Memory({initial:1}));
  return {handle,bridge};
}
describe('player-order bridge codecs',()=>{
  it('preserves full-width simulation time rather than crashing diagnostic reads',()=>{
    const {bridge,handle}=fixture();
    handle.order_events_since.mockReturnValue(['1','0','1','18446744073709551614','7','','2','Chat','accepted','','']);
    expect(bridge.orderEventsSince('0').events[0].tick).toBe('18446744073709551614');
  });
  it('decodes queue and event identities without rounding and retains empty optional fields',()=>{
    const {bridge,handle}=fixture();
    expect(bridge.actionQueueRowsOf(7,4)).toEqual([{orderId:'9007199254740993',label:'Chat',phase:'waiting',role:'incoming',counterpart:7,reason:'Busy'}]);
    expect(bridge.orderEventsSince('0')).toEqual({nextCursor:'9007199254740993',expired:true,events:[{sequence:'9007199254740993',tick:'20',actor:7,counterpart:9,orderId:'18446744073709551615',action:'Chat',phase:'failed',reason:'Target removed',blockingState:null}]});
    expect(bridge.workConflictsOf([7])).toEqual({token:'17',people:[{entity:7,name:'Terri',phase:'working',remainingMinutes:90,totalMinutes:480}]});
    expect(bridge.careerAttendanceOf(7)).toEqual([480,300,180,72,10,62,10625,1]);
    handle.action_queue_rows_of.mockReturnValue(['','','running','initiator','','']);
    expect(bridge.actionQueueRowsOf(7)).toEqual([{orderId:null,label:'',phase:'running',role:'initiator',counterpart:null,reason:null}]);
  });
  it('rejects malformed rows and invalid boundary arguments before calling native methods',()=>{
    const {bridge,handle}=fixture();
    expect(bridge.actionQueueRowsOf(-1)).toEqual([]);
    expect(()=>bridge.orderEventsSince('1.5')).toThrow();
    expect(()=>bridge.workConflictsOf([NaN])).toThrow();
    expect(handle.order_events_since).not.toHaveBeenCalled(); expect(handle.work_conflicts_of).not.toHaveBeenCalled();
    handle.action_queue_rows_of.mockReturnValue(['1']);expect(()=>bridge.actionQueueRowsOf(7)).toThrow();
    handle.order_events_since.mockReturnValue(['not-a-cursor','0']);expect(()=>bridge.orderEventsSince('0')).toThrow();
    handle.work_conflicts_of.mockReturnValue(['17','7','Terri','9','1','2']);expect(()=>bridge.workConflictsOf([7])).toThrow();
  });
});
describe('player-order bridge gate',()=>{
  it('holds all eight action paths until approval and includes both social participants',()=>{
    const {bridge,handle}=fixture();
    const pending:Array<{people:number[];submit:(token?:string)=>boolean}>=[];
    bridge.setOrderGate((people,submit)=>{pending.push({people:[...people],submit});return true;});
    const attempts=[()=>bridge.useObject(7,8,0),()=>bridge.useObjectFirst(7,8,1),()=>bridge.talkTo(7,9,2),()=>bridge.talkToFirst(7,9,3),
      ()=>bridge.readBook(7,8,'Read','a-title',true),()=>bridge.cleanChore(7,1,8,true),()=>bridge.cleanDishes(7,8,[3,4]),()=>bridge.cleanDishesFirst(7,8,null)];
    attempts.forEach(attempt=>expect(attempt()).toBe(true));
    expect(handle.enqueue_confirmed_order).not.toHaveBeenCalled(); expect(handle.readBook).not.toHaveBeenCalled(); expect(handle.clean_chore).not.toHaveBeenCalled(); expect(handle.clean_dishes).not.toHaveBeenCalled();
    expect(pending.map(entry=>entry.people)).toEqual([[7],[7],[7,9],[7,9],[7],[7],[7],[7]]);
    pending.forEach(entry=>expect(entry.submit('19')).toBe(true));
    expect(handle.enqueue_confirmed_order.mock.calls.map(call=>Array.from(call[0] as Uint8Array)[0])).toEqual([1,5,4,6]);
    expect(handle.confirm_last_order).toHaveBeenCalledTimes(4);
    expect(handle.confirm_last_order).toHaveBeenLastCalledWith('19');
    expect(pending[0].submit('19')).toBe(false); expect(handle.enqueue_confirmed_order).toHaveBeenCalledTimes(4);
  });
  it('captures cleanup targets before a delayed decision and snapshots a token for immediate orders',()=>{
    const {bridge,handle}=fixture(); let submit:((token?:string)=>boolean)|null=null;
    bridge.setOrderGate((_people,send)=>{submit=send;return true;});
    const dishes=[3,4];bridge.cleanDishes(7,8,dishes);dishes[0]=999;
    expect(submit!()).toBe(true);
    expect(Array.from(handle.clean_dishes.mock.calls[0][2] as Float64Array)).toEqual([3,4]);
    expect(handle.confirm_last_order).toHaveBeenCalledWith('17');
    bridge.setOrderGate(null);expect(bridge.useObject(7,8,0)).toBe(true);
    expect(handle.enqueue_confirmed_order).toHaveBeenCalledWith(new Uint8Array([1,7,8,0]),'17');
  });
});
