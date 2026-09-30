use super::*;

#[test]
fn hundreds_of_waiting_orders_and_a_front_order_all_survive_save_load() {
    let mut handle = SimHandle::from_lot();
    let agent = handle
        .sim
        .save_snapshot()
        .entities
        .iter()
        .find(|e| e.agent)
        .unwrap()
        .index;
    let object = handle
        .sim
        .save_snapshot()
        .entities
        .iter()
        .find(|e| e.smart_object.as_deref() == Some("fridge"))
        .unwrap()
        .index;
    for _ in 0..513 {
        let command = postcard::to_allocvec(&SimCommand::UseObject {
            agent,
            object,
            interaction: 0,
        })
        .unwrap();
        assert!(handle.enqueue_command(&command));
        handle.flush_commands();
    }
    assert_eq!(handle.queued_orders_of(agent), 513);
    let command = postcard::to_allocvec(&SimCommand::UseObjectFirst {
        agent,
        object,
        interaction: 1,
    })
    .unwrap();
    assert!(handle.enqueue_command(&command));
    handle.flush_commands();
    assert_eq!(handle.queued_orders_of(agent), 514);
    assert_eq!(handle.take_intent_capacity_rejections(), 0);
    assert_eq!(handle.take_intent_displacements(), 0);
    let snapshot = handle.sim.save_snapshot_v5();
    let cards = handle.action_queue_of(agent);
    assert_eq!(cards.len(), 515);
    assert_eq!(cards[0], "");
    assert!(cards[1].starts_with("Cook dinner: "));
    assert!(cards[2..]
        .iter()
        .all(|label| label.starts_with("Grab a snack: ")));
    assert!(handle.action_queue_of(u32::MAX).is_empty());
    for limit in [0, 1, 4, 515, 516] {
        assert_eq!(
            handle.action_queue_window_of(agent, limit),
            cards[..(limit as usize).min(cards.len())]
        );
    }
    assert!(handle.action_queue_window_of(u32::MAX, 4).is_empty());
    assert_eq!(handle.queued_orders_of(agent), 514);
    assert_eq!(handle.sim.save_snapshot_v5(), snapshot);
    let queue = snapshot
        .world
        .entities
        .iter()
        .find(|e| e.index == agent)
        .unwrap()
        .intents
        .as_ref()
        .unwrap();
    assert_eq!(queue[0].interaction, 1);
    assert!(queue[1..].iter().all(|i| i.interaction == 0));
    let mut restored = SimHandle::from_lot();
    assert!(restored.load_bytes(&handle.save_bytes()));
    assert_eq!(restored.sim.save_snapshot_v5(), snapshot);
}
