use super::*;
use crate::{test_content, Sim};
use terri_core::{Intent, IntentQueue, NeedId, Reserved, TileGrid};

fn arrival(edge_mode: bool) -> (Sim, Entity, Entity) {
    let content = test_content::pack_with_voice(
        Vec::new(),
        vec![test_content::interaction(
            "chat",
            &[(NeedId::Social, 30.0)],
            40,
        )],
        test_content::tuning(),
        &[31, 43],
    );
    let mut sim = test_content::sim_with(8, 6, content);
    if edge_mode {
        // A solid edge elsewhere selects edge-world behavior while leaving
        // the participants' own boundary open until a test closes it.
        sim.world_mut()
            .resource_mut::<TileGrid>()
            .set_edge_blocked((5, 4), (6, 4), true);
    }
    let partner = sim
        .world_mut()
        .spawn((Agent, Position { x: 3.0, y: 2.0 }, Reserved))
        .id();
    let queue = IntentQueue::from_intents(vec![Intent {
        object: partner,
        interaction: 0,
    }]);
    let initiator = sim
        .world_mut()
        .spawn((
            Agent,
            Position { x: 2.0, y: 2.0 },
            Path {
                steps: vec![],
                cursor: 0,
            },
            Target {
                object: partner,
                interaction: 0,
            },
            queue,
        ))
        .id();
    (sim, initiator, partner)
}

fn run_arrival(sim: &mut Sim) {
    let mut schedule = Schedule::default();
    schedule.add_systems(follow_path);
    schedule.run(sim.world_mut());
}

fn assert_cancelled_without_draws(mut sim: Sim, initiator: Entity, partner: Entity) {
    let rng = sim.world().resource::<SimRng>().clone();
    let queue = sim.world().get::<IntentQueue>(initiator).unwrap().clone();
    let position = *sim.world().get::<Position>(initiator).unwrap();
    run_arrival(&mut sim);
    assert!(sim.world().get::<Socialising>(initiator).is_none());
    assert!(sim.world().get::<ConversationVoice>(initiator).is_none());
    assert!(sim.world().get::<Path>(initiator).is_none());
    assert!(sim.world().get::<Target>(initiator).is_none());
    assert!(sim.world().get::<Reserved>(partner).is_none());
    assert_eq!(sim.world().resource::<SimRng>(), &rng);
    assert_eq!(sim.world().get::<IntentQueue>(initiator), Some(&queue));
    let after = sim.world().get::<Position>(initiator).unwrap();
    assert_eq!((after.x, after.y), (position.x, position.y));
}

#[test]
fn edge_social_arrival_cancels_contact_through_a_solid_boundary_before_rng_draws() {
    let (mut sim, initiator, partner) = arrival(true);
    sim.world_mut()
        .resource_mut::<TileGrid>()
        .set_edge_blocked((2, 2), (3, 2), true);
    assert_cancelled_without_draws(sim, initiator, partner);
}

#[test]
fn edge_social_arrival_cancels_when_partner_moved_away_from_the_old_route_end() {
    let (mut sim, initiator, partner) = arrival(true);
    sim.world_mut()
        .entity_mut(partner)
        .insert(Position { x: 6.0, y: 2.0 });
    assert_cancelled_without_draws(sim, initiator, partner);
}

#[test]
fn edge_social_arrival_requires_the_partners_reservation() {
    let (mut sim, initiator, partner) = arrival(true);
    sim.world_mut().entity_mut(partner).remove::<Reserved>();
    assert_cancelled_without_draws(sim, initiator, partner);
}

#[test]
fn edge_social_arrival_cancels_when_partner_has_been_redirected_to_another_target() {
    let (mut sim, initiator, partner) = arrival(true);
    sim.world_mut().entity_mut(partner).insert(Target {
        object: initiator,
        interaction: 0,
    });
    assert_cancelled_without_draws(sim, initiator, partner);
}

#[test]
fn edge_social_arrival_cancels_when_partner_is_still_walking() {
    let (mut sim, initiator, partner) = arrival(true);
    sim.world_mut().entity_mut(partner).insert(Path {
        steps: vec![(4, 2)],
        cursor: 0,
    });
    assert_cancelled_without_draws(sim, initiator, partner);
}

#[test]
fn edge_social_arrival_accepts_open_door_contact_using_rounded_positions() {
    let (mut sim, initiator, partner) = arrival(true);
    sim.world_mut()
        .entity_mut(initiator)
        .insert(Position { x: 2.2, y: 2.1 });
    sim.world_mut()
        .entity_mut(partner)
        .insert(Position { x: 2.8, y: 2.2 });
    let queue = sim.world().get::<IntentQueue>(initiator).unwrap().clone();
    let rng = sim.world().resource::<SimRng>().clone();
    run_arrival(&mut sim);
    let social = sim.world().get::<Socialising>(initiator).unwrap();
    assert_eq!(social.partner, partner);
    assert_eq!(social.remaining_ticks, 74);
    assert!(sim.world().get::<ConversationVoice>(initiator).is_some());
    assert!(sim.world().get::<Path>(initiator).is_none());
    assert!(sim.world().get::<Reserved>(partner).is_some());
    assert_eq!(sim.world().get::<IntentQueue>(initiator), Some(&queue));
    assert_ne!(sim.world().resource::<SimRng>(), &rng);
}

#[test]
fn legacy_social_arrival_without_solid_edges_keeps_its_previous_draws_and_behavior() {
    let (mut sim, initiator, partner) = arrival(false);
    sim.world_mut()
        .entity_mut(partner)
        .remove::<Reserved>()
        .insert(Position { x: 6.0, y: 2.0 });
    let mut expected_rng = sim.world().resource::<SimRng>().clone();
    let expected_voice = draw_voice_pair(2, &mut expected_rng).unwrap();
    run_arrival(&mut sim);
    assert_eq!(sim.world().resource::<SimRng>(), &expected_rng);
    assert_eq!(
        sim.world().get::<ConversationVoice>(initiator),
        Some(&expected_voice)
    );
    let social = sim.world().get::<Socialising>(initiator).unwrap();
    assert_eq!(social.partner, partner);
    assert_eq!(social.remaining_ticks, 74);
    assert!(sim.world().get::<Path>(initiator).is_none());
    assert!(sim.world().get::<Target>(initiator).is_some());
}
