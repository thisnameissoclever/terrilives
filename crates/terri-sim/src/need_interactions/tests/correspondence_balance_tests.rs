use super::*;
use bevy_ecs::system::RunSystemOnce;

#[test]
fn conversation_balance_correspondence_provides_social_while_alone() {
    let (mut sim, person, other) = shared_fixture("desk", "desk");
    sim.world_mut()
        .entity_mut(other)
        .remove::<(Eating, Target)>();
    sim.world_mut()
        .entity_mut(other)
        .insert((terri_core::Reserved, Position { x: 14., y: 14. }));
    crate::social_company::refresh(sim.world_mut());
    let pack = sim.world().resource::<Content>().0;
    let definition = pack.find("desk").unwrap();
    let act = &pack.object(definition).interactions[0];
    let current = *sim.world().get::<Needs>(person).unwrap();
    let offered = benefits(pack, act, &current, false, 0., false);
    assert!(
        offered
            .iter()
            .any(|&(need, delta)| need as usize == NeedId::Social.index() && delta > 0.),
        "letters offer Social without another person at the desk"
    );
    let active = active_benefits(sim.world(), person);
    assert!(
        active
            .iter()
            .any(|&(need, delta)| need as usize == NeedId::Social.index() && delta > 0.),
        "critical-need reasoning recognizes actual letter writing"
    );
    let predicted = physical::object_effects(
        pack,
        act,
        &Personality::neutral(),
        physical::ObjectContext {
            social_available: false,
            shared: false,
            seat_rate: 0.,
            company: 0.,
        },
    );
    assert!(
        (predicted[NeedId::Social.index()] - 24. / 58.).abs() < 0.0001,
        "the physical forecast includes solitary correspondence"
    );
    sim.world_mut()
        .run_system_once(crate::systems::interact::tick_interactions)
        .unwrap();
    let social = sim
        .world()
        .get::<Needs>(person)
        .unwrap()
        .get(NeedId::Social);
    assert!(
        (social - current.get(NeedId::Social) - 24. / 58.).abs() < 0.0001,
        "the lone writer receives the promised reward: {social}"
    );
}

#[test]
fn conversation_balance_lonely_writer_selects_the_desk_without_company() {
    let (mut sim, person, other) = shared_fixture("desk", "desk");
    sim.world_mut()
        .entity_mut(other)
        .remove::<(Agent, Eating, Target)>();
    sim.world_mut()
        .entity_mut(other)
        .insert((terri_core::Reserved, Position { x: 14., y: 14. }));
    sim.world_mut()
        .entity_mut(person)
        .remove::<(Eating, Target)>();
    sim.world_mut()
        .get_mut::<Needs>(person)
        .unwrap()
        .set(NeedId::Social, 0.);
    let objects: Vec<_> = sim
        .world_mut()
        .query_filtered::<Entity, With<SmartObject>>()
        .iter(sim.world())
        .collect();
    for object in objects {
        sim.world_mut()
            .entity_mut(object)
            .remove::<terri_core::Reserved>();
    }
    sim.tick();
    let target = sim
        .world()
        .get::<Target>(person)
        .expect("loneliness selects letter writing");
    let object = sim
        .world()
        .get::<SmartObject>(target.object)
        .expect("the selected target is furniture");
    let pack = sim.world().resource::<Content>().0;
    assert_eq!(
        pack.object(object.0).interactions[target.interaction as usize].activity,
        Some(terri_data::CompiledActivity::Correspondence)
    );
}
