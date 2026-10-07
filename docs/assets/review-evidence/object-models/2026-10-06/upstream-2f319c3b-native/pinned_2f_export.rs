use std::{fs, path::Path};
use terri_core::{SaveSnapshotV5, SimCommand, chores::{ChoreKey,ChoreKind}};
use terri_sim::{Sim, Content};
use terri_wasm::SimHandle;

fn state(handle: &SimHandle) -> SaveSnapshotV5 {
    postcard::from_bytes(&handle.save_bytes()[10..]).unwrap()
}
fn send(handle: &mut SimHandle, command: SimCommand) {
    assert!(handle.enqueue_command(&postcard::to_allocvec(&command).unwrap()));
}
fn object(saved: &SaveSnapshotV5, model: &str) -> u32 {
    saved.world.entities.iter().find(|e|e.smart_object.as_deref()==Some(model)).unwrap().index
}
fn people(saved: &SaveSnapshotV5) -> Vec<u32> {
    saved.world.entities.iter().filter(|e|e.agent).map(|e|e.index).collect()
}
fn capture(root: &Path, name: &str, handle: &mut SimHandle) {
    let bytes=handle.save_bytes();
    assert_eq!(&bytes[8..10], &[5,0]);
    let saved=state(handle);
    fs::write(root.join(format!("{name}.bin")),&bytes).unwrap();
    fs::write(root.join(format!("{name}.observation.txt")),format!("Genuine public-command state at tick {}.\n{saved:#?}\n",saved.world.tick)).unwrap();
    let mut restored=SimHandle::from_lot();
    let loads=restored.load_bytes(&bytes);
    let exact=loads && restored.save_bytes()==bytes;
    let hash=handle.world_hash();
    let hash_equal=loads && restored.world_hash()==hash;
    let continuation=if exact {handle.tick();restored.tick(); handle.save_bytes()==restored.save_bytes()} else {false};
    println!("capture\t{name}\t{}\t{}\t{loads}\t{exact}\t{hash_equal}\t{continuation}",saved.world.tick,bytes.len());
    assert!(loads&&exact&&hash_equal&&continuation,"published source continuation {name}");
}
fn active_object(saved: &SaveSnapshotV5, person: u32, model: &str) -> bool {
    saved.world.entities.iter().find(|e|e.index==person).unwrap().eating.as_ref().is_some_and(|e|e.object==model&&e.remaining_ticks>0)
}
fn main() {
    let base=std::env::args().nth(1).expect("output directory");
    let root=Path::new(&base);fs::create_dir_all(root).unwrap();
    let pack_sim=Sim::new_from_shipped_lot();
    fs::write(root.join("content-pack.postcard"),postcard::to_allocvec(pack_sim.world().resource::<Content>().0).unwrap()).unwrap();
    let mut baseline=SimHandle::from_lot();capture(root,"initial",&mut baseline);
    while state(&baseline).world.tick<1000 {baseline.tick();}
    capture(root,"played",&mut baseline);
    for (label,model) in [("active-handwash","sink"),("active-toilet","toilet")] {
        let mut handle=SimHandle::from_lot();let saved=state(&handle);let person=people(&saved)[1];let target=object(&saved,model);
        send(&mut handle,SimCommand::UseObjectFirst{agent:person,object:target,interaction:0});handle.flush_commands();
        let mut found=false;
        for _ in 0..pack_sim.world().resource::<Content>().0.tuning.day_ticks {handle.tick();if active_object(&state(&handle),person,model){found=true;capture(root,label,&mut handle);break;}}
        println!("observed\t{label}\t{found}");
    }
    let mut pending=SimHandle::from_lot();let saved=state(&pending);let person=people(&saved)[0];let table=object(&saved,"dining_table");let bin=object(&saved,"trashcan");let key=ChoreKey{kind:ChoreKind::Bins,target:bin};
    for command in [SimCommand::CleanDishes{agent:person,surface:table,dishes:None},SimCommand::CleanDishesFirst{agent:person,surface:table,dishes:None},SimCommand::CleanChore{agent:person,key},SimCommand::CleanChoreFirst{agent:person,key},SimCommand::SetChoreProfile{agent:person,responsibility:80,preferences:[-10,20,0,40]},SimCommand::SetChoreBoard{enabled:true}] {
        send(&mut pending,command);
    }
    capture(root,"pending-23-28",&mut pending);
}
