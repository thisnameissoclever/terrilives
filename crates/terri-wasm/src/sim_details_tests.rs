use super::*;
use terri_core::{Habituation, ObjectDefId, Personality};

#[test]
fn personal_details_wire_layout_keeps_exact_offsets_and_aligned_repetition_labels() {
    let mut handle = SimHandle::from_lot();
    let mut personality = Personality::neutral();
    personality.drain = [0.5, 0.6, 0.7, 0.8, 0.9, 1.1, 1.2];
    personality.satisfaction = [1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9];
    personality.chronotype_offset_ticks = -16_777_217;
    let cap = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .tuning
        .habituation_max;
    let mut habits = Habituation::default();
    habits.bump(ObjectDefId(2), 0, 0.625, cap);
    let entity = handle
        .sim
        .world_mut()
        .spawn((Agent, personality.clone(), habits))
        .id();
    let before = handle.sim.save_snapshot_v5();
    let values = handle.sim_details_of(f64::from(entity.index_u32()));
    assert_eq!(values.len(), 18);
    assert_eq!(values[0], -16_777_217.0);
    assert_eq!(&values[1..8], &personality.drain.map(f64::from));
    assert_eq!(&values[8..15], &personality.satisfaction.map(f64::from));
    assert_eq!(&values[15..], &[2.0, 0.0, 0.625]);
    let object = &handle.sim.world().resource::<Content>().0.objects[2];
    assert_eq!(
        handle.sim_details_labels_of(f64::from(entity.index_u32())),
        vec![object.display_name(), object.interactions[0].label.as_str()]
    );
    assert_eq!(handle.sim.save_snapshot_v5(), before);
}

#[test]
fn details_exports_reject_invalid_numbers_and_do_not_coerce_them_to_a_person() {
    let mut handle = SimHandle::from_lot();
    let impostor = handle.sim.world_mut().spawn(Personality::neutral()).id();
    let cap = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .tuning
        .habituation_max;
    let mut habits = Habituation::default();
    habits.bump(ObjectDefId(2), 0, 0.5, cap);
    let person = handle
        .sim
        .world_mut()
        .spawn((Agent, Personality::neutral(), habits))
        .id();
    assert!(!handle
        .sim_details_labels_of(f64::from(person.index_u32()))
        .is_empty());
    for index in [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        -1.0,
        0.5,
        4_294_967_296.0,
        f64::from(u32::MAX),
        f64::from(impostor.index_u32()),
        f64::from(person.index_u32()) + 0.5,
    ] {
        assert!(handle.sim_details_of(index).is_empty(), "{index}");
        assert!(handle.sim_details_labels_of(index).is_empty(), "{index}");
    }
}

/// [OD-model]: an overdone row, habituation 2.0, crosses the boundary as a
/// full repetition meter, 1.0, which is the range `web/src/bridge.ts` accepts.
#[test]
fn an_overdone_row_projects_a_full_repetition_through_the_boundary() {
    let mut handle = SimHandle::from_lot();
    let cap = handle
        .sim
        .world()
        .resource::<Content>()
        .0
        .tuning
        .habituation_max;
    assert!(cap >= 2.0, "the fixture needs room for 2.0");
    let mut habits = Habituation::default();
    habits.bump(ObjectDefId(2), 0, 2.0, cap);
    assert_eq!(habits.get(ObjectDefId(2), 0), 2.0);
    let entity = handle
        .sim
        .world_mut()
        .spawn((Agent, Personality::neutral(), habits))
        .id();
    let values = handle.sim_details_of(f64::from(entity.index_u32()));
    assert_eq!(values.len(), 18);
    assert_eq!(&values[15..], &[2.0, 0.0, 1.0]);
}
