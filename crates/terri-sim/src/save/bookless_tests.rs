use crate::{Content, Sim};
use terri_core::{books::TitleMemory, command::BookCommand, CommandQueue, SimCommand, SimId};

fn bookless() -> Sim {
    Sim::new_with_lot_and_content(4, 4, Content(crate::test_content::pack(vec![])))
}

#[test]
fn bookless_current_library_restores_empty_state_and_exact_metadata() {
    let mut sim = bookless();
    crate::test_content::assert_current_admission(&sim);
    let mut saved = sim.current_v6_view();
    saved.books.next_copy_id = 17;
    saved.books.taste_seed = 901;
    saved.books.migration_granted = true;
    sim.load_current_v6_view(saved.clone()).unwrap();
    assert_eq!(sim.current_v6_view(), saved);
    crate::test_content::assert_current_admission(&sim);
}

#[test]
fn bookless_current_library_refuses_owned_data_operations_and_inconsistent_catalogue() {
    let mut live = bookless();
    crate::test_content::assert_current_admission(&live);
    let before = live.save_snapshot_v15();
    let hash = live.world_hash();
    let normal = Sim::new_from_shipped_lot().current_v6_view();
    let mut copy = live.current_v6_view();
    copy.books.next_copy_id = 17;
    copy.books.copies.push(normal.books.copies[0].clone());
    let mut memory = live.current_v6_view();
    memory.books.memories.push(TitleMemory {
        sim_id: SimId(0),
        title_id: normal.books.copies[0].title_id.clone(),
        progress_ticks: 0,
        progress_fraction: 0.,
        pass_novelty: None,
        familiarity: 0.,
        last_read_tick: 0,
        completed_passes: 0,
    });
    for invalid in [copy, memory] {
        assert!(live.load_current_v6_view(invalid).is_err());
        assert_eq!(live.save_snapshot_v15(), before);
        assert_eq!(live.world_hash(), hash);
    }
    let mut source = bookless();
    source
        .world_mut()
        .resource_mut::<CommandQueue>()
        .push(SimCommand::Book(BookCommand::Purchase {
            title: "missing".into(),
            shelf: None,
        }));
    assert!(live.load_snapshot_v15(source.save_snapshot_v15()).is_err());
    assert_eq!(live.save_snapshot_v15(), before);
    assert_eq!(live.world_hash(), hash);
    let mut pack = live.world().resource::<Content>().0.clone();
    pack.books.push(terri_data::pack().books[0].clone());
    let mut inconsistent = Sim::new_with_lot_and_content(4, 4, Content(Box::leak(Box::new(pack))));
    assert!(inconsistent
        .load_snapshot_v15(inconsistent.save_snapshot_v15())
        .is_err());
}
