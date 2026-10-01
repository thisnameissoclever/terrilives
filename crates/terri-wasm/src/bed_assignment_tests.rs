use super::*;

fn fixture() -> (SimHandle, u32, u32) {
    let handle = SimHandle::from_lot();
    let snapshot = handle.sim.save_snapshot_v5();
    let agent = snapshot
        .world
        .entities
        .iter()
        .find(|row| row.agent)
        .unwrap()
        .index;
    let bed = snapshot
        .world
        .entities
        .iter()
        .find(|row| row.smart_object.as_deref() == Some("double_bed"))
        .unwrap()
        .index;
    (handle, agent, bed)
}

#[test]
fn assignment_boundary_validates_numbers_and_reports_only_after_the_drain() {
    let (mut handle, agent, bed) = fixture();
    let agent = f64::from(agent);
    let bed = f64::from(bed);
    let before = handle.save_bytes();
    for bad in [f64::NAN, f64::INFINITY, -1.0, 0.5, 4_294_967_296.0] {
        assert!(!handle.set_bed_assignment(bad, Some(bed), 0.0));
        assert!(!handle.set_bed_assignment(agent, Some(bad), 0.0));
        assert!(!handle.set_bed_assignment(agent, Some(bed), bad));
        assert_eq!(handle.bed_places_of(bad), vec![0.0]);
    }
    assert!(!handle.set_bed_assignment(agent, Some(bed), 256.0));
    assert!(!handle.set_bed_assignment(agent, None, 1.0));
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.bed_assignment_sequence(), 0);
    assert!(handle.last_bed_assignment_result().is_empty());
    assert!(handle.set_bed_assignment(agent, Some(bed), 1.0));
    assert!(handle.last_bed_assignment_result().is_empty());
    assert_eq!(handle.bed_assignment_sequence(), 0);
    handle.sim.flush_commands();
    assert_eq!(handle.bed_assignment_sequence(), 1);
    assert_eq!(
        handle.last_bed_assignment_result(),
        vec![agent as u32, 1, bed as u32, 1, 0]
    );
    assert!(handle.set_bed_assignment(agent, None, 0.0));
    handle.sim.flush_commands();
    assert_eq!(
        handle.last_bed_assignment_result(),
        vec![agent as u32, 0, 0, 0, 0]
    );
    assert!(handle.set_bed_assignment(agent, Some(f64::from(u32::MAX)), 0.0));
    handle.sim.flush_commands();
    assert_eq!(
        handle.last_bed_assignment_result(),
        vec![agent as u32, 1, u32::MAX, 0, 2]
    );
    handle
        .sim
        .world_mut()
        .resource_mut::<terri_sim::beds::AssignmentFeedback>()
        .sequence = 9_007_199_254_740_993;
    assert_eq!(handle.bed_assignment_sequence(), 9_007_199_254_740_993);
}

#[test]
fn bed_projection_is_read_only_sorted_and_distinguishes_absence_from_no_beds() {
    let (mut handle, agent, bed) = fixture();
    assert!(handle.set_bed_assignment(f64::from(agent), Some(f64::from(bed)), 1.0));
    handle.sim.flush_commands();
    let before = handle.save_bytes();
    let rows = handle.bed_places_of(f64::from(agent));
    assert_eq!(rows[0], 1.0);
    let places: Vec<_> = rows[1..].chunks_exact(6).collect();
    assert!(places
        .windows(2)
        .all(|pair| (pair[0][0], pair[0][1]) < (pair[1][0], pair[1][1])));
    assert_eq!(
        places.iter().filter(|row| row[0] == f64::from(bed)).count(),
        2
    );
    let assigned = places
        .iter()
        .find(|row| row[0] == f64::from(bed) && row[1] == 1.0)
        .unwrap();
    assert_eq!(assigned[4], f64::from(agent));
    assert_eq!(assigned[5], -1.0);
    assert_eq!(handle.save_bytes(), before);
    assert_eq!(handle.bed_places_of(f64::from(bed)), vec![0.0]);
    let mut empty = SimHandle::new(8, 8);
    let person = empty
        .sim
        .world_mut()
        .spawn((Agent, terri_core::SimId(12)))
        .id();
    assert_eq!(
        empty.bed_places_of(f64::from(person.index_u32())),
        vec![1.0]
    );
}
