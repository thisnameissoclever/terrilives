from pathlib import Path
import subprocess,hashlib,json
scratch=Path('.superpowers/sdd/chores-and-weekly-board')
cases=[
 ('cancelled-dish-start','crates/terri-sim/src/chores/work.rs','state.dish_started.retain(|r| r.0 != person.index_u32());','','cancelled_or_dead_dish_actors'),
 ('dead-dish-start','crates/terri-sim/src/chores/mod.rs','state.dish_started.retain(|(person, _)| {','state.dish_started.retain(|(person, _)| { return true;','cancelled_or_dead_dish_actors'),
 ('room-plan','crates/terri-sim/src/chores/work.rs','task.cells.iter().all(|cell| {','task.cells.iter().all(|cell| { return true;','suspended_floor_plan'),
 ('object-contact','crates/terri-sim/src/chores/work.rs','pub(super) fn contact(world: &World, task: &ChoreTask) -> Option<u32> {','pub(super) fn contact(world: &World, task: &ChoreTask) -> Option<u32> { return task.endpoint;','resumed_surface_work'),
 ('bin-conservation','crates/terri-sim/src/chores/mod.rs','state.unbinned = state.unbinned.saturating_add(u32::from(r.1));','','suspended_bin_sale'),
 ('saved-task-kind','crates/terri-sim/src/chores/save.rs','if task.key.kind == ChoreKind::Dishes\n            || !key_valid(world, task.key)','if !key_valid(world, task.key)','unsupported_dish_task'),
 ('saved-task-contact','crates/terri-sim/src/chores/save.rs','.is_none_or(|cell| !work::contact_valid(world, task.key, cell))','.is_none()','unsupported_dish_task'),
 ('midnight-dishes','crates/terri-sim/src/chores/board.rs','|| (key.kind == ChoreKind::Dishes','|| (false && key.kind == ChoreKind::Dishes','real_dish_washing_crosses_midnight'),
 ('chore-hash','crates/terri-sim/src/lib.rs','state.hash_into(&mut hasher);','','chore_hash_observes'),
 ('chore-persistence','crates/terri-sim/src/lib.rs','chores: chores::snapshot(&self.world),','chores: None,','mixed_dish_chore_and_ordinary_orders'),
]
results=[]
for name,file,old,new,test in cases:
 p=Path(file);original=p.read_bytes();source=original.decode('utf-8').replace('\r\n','\n')
 count=source.count(old)
 assert count>=1,(name,count)
 try:
  p.write_bytes(source.replace(old,new,1).encode('utf-8'))
  log=scratch/(name+'-mutation.log')
  with log.open('w',encoding='utf-8') as out:
   result=subprocess.run(['cargo','test','-p','terri-sim',test,'--','--test-threads=1'],stdout=out,stderr=subprocess.STDOUT)
  output=log.read_text(encoding='utf-8');killed=result.returncode!=0 and 'test result: FAILED.' in output
 finally:p.write_bytes(original)
 row=dict(name=name,killed=killed,exit=result.returncode,restored=p.read_bytes()==original,sha256=hashlib.sha256(original).hexdigest())
 results.append(row);print(json.dumps(row),flush=True)
 (scratch/'mutations.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
 assert row['killed'] and row['restored'],name
