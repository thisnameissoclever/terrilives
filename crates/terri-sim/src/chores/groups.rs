use super::*;
use terri_core::{Position, SmartObject};

pub(super) fn kind(world: &World, object: Entity) -> Option<ChoreKind> {
    let def = world.get::<SmartObject>(object)?;
    let pack = world.resource::<crate::Content>().0;
    if !crate::targeted_cleanup::is_surface(pack, def.0) {
        return None;
    }
    Some(
        if pack.object(def.0).roles.iter().any(|r| {
            pack.roles
                .get(*r as usize)
                .is_some_and(|role| role == "meal_table")
        }) {
            ChoreKind::TableSurfaces
        } else {
            ChoreKind::CounterSurfaces
        },
    )
}

pub(super) fn key_for(world: &World, object: Entity) -> Option<ChoreKey> {
    let kind = kind(world, object)?;
    let pos = world.get::<Position>(object)?;
    let target = crate::room_regions::RoomRegions::from_world(world)
        .at((pos.x.round() as i32, pos.y.round() as i32))?;
    Some(ChoreKey { kind, target })
}

pub(super) fn members(world: &World, key: ChoreKey) -> Vec<u32> {
    if !key.kind.grouped() {
        return vec![];
    }
    let Some(mut objects) = world.try_query::<(Entity, &SmartObject)>() else {
        return vec![];
    };
    let rooms = crate::room_regions::RoomRegions::from_world(world);
    let mut members: Vec<_> = objects
        .iter(world)
        .filter(|(e, _)| {
            kind(world, *e) == Some(key.kind)
                && world.get::<Position>(*e).is_some_and(|p| {
                    rooms.at((p.x.round() as i32, p.y.round() as i32)) == Some(key.target)
                })
        })
        .map(|(e, _)| e.index_u32())
        .collect();
    members.sort_unstable();
    members
}

pub(super) fn current_key(task: &ChoreTask) -> ChoreKey {
    if task.key.kind.grouped() {
        ChoreKey {
            kind: ChoreKind::Surfaces,
            target: task
                .cells
                .get(task.cursor as usize)
                .copied()
                .unwrap_or(u32::MAX),
        }
    } else {
        task.key
    }
}

pub(super) fn claims(task: &ChoreTask, object: u32) -> bool {
    if task.suspended {
        return false;
    }
    if task.key.kind.grouped() {
        task.endpoint.is_some() && current_key(task).target == object
    } else {
        matches!(task.key.kind, ChoreKind::Surfaces | ChoreKind::Bins) && task.key.target == object
    }
}

pub(super) fn room_label(world: &World, room: u32) -> String {
    let regions = crate::room_regions::RoomRegions::from_world(world);
    let grid = world.resource::<terri_core::TileGrid>();
    let mut names = std::collections::BTreeMap::<u32, (&str, u8)>::new();
    for y in 0..grid.height() {
        for x in 0..grid.width() {
            if let Some(id) = regions.at((x as i32, y as i32)) {
                names.entry(id).or_insert(("Room", 0));
            }
        }
    }
    if let Some(mut q) = world.try_query::<(&SmartObject, &Position)>() {
        for (object, pos) in q.iter(world) {
            let Some(id) = regions.at((pos.x.round() as i32, pos.y.round() as i32)) else {
                continue;
            };
            let object = &world.resource::<crate::Content>().0.object(object.0).id;
            let category = match object.as_str() {
                "fridge" | "stove" => ("Kitchen", 5),
                "toilet" | "shower" | "bathtub" => ("Bathroom", 4),
                "bed" | "double_bed" | "bunk_bed" => ("Bedroom", 3),
                "desk" => ("Study", 2),
                "sofa" | "television" | "armchair" => ("Living room", 1),
                _ => ("Room", 0),
            };
            if names.get(&id).is_none_or(|(_, p)| *p < category.1) {
                names.insert(id, category);
            }
        }
    }
    let Some((name, _)) = names.get(&room) else {
        return "Removed room".into();
    };
    let same: Vec<_> = names
        .iter()
        .filter(|(_, v)| v.0 == *name)
        .map(|(id, _)| *id)
        .collect();
    if same.len() == 1 && *name != "Room" {
        (*name).into()
    } else {
        format!(
            "{} {}",
            name,
            same.iter().position(|r| *r == room).unwrap() + 1
        )
    }
}

pub(super) fn reconcile(world: &mut World, state: &mut SavedChores) {
    for task in &mut state.tasks {
        if !task.key.kind.grouped() {
            continue;
        }
        let old = current_key(task);
        let members = members(world, task.key);
        let split = (task.cursor as usize).min(task.cells.len());
        let mut cells = task.cells[..split].to_vec();
        cells.extend(
            task.cells[split..]
                .iter()
                .copied()
                .filter(|id| members.contains(id)),
        );
        for id in members {
            if !cells.contains(&id) && value(&state.surfaces, id) > 0 {
                cells.push(id);
            }
        }
        task.cells = cells;
        if current_key(task) != old {
            task.endpoint = None;
            task.remaining = 0;
            if !task.suspended {
                if let Some(person) = crate::dining::entity(world, task.person) {
                    if super::work::may_release_path(world, person) {
                        world.entity_mut(person).remove::<terri_core::Path>();
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inaccessible_group_is_unavailable_at_midnight() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let key = ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        };
        let object = members(sim.world(), key)[0];
        let entity = crate::dining::entity(sim.world(), object).unwrap();
        let pos = *sim.world().get::<Position>(entity).unwrap();
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        super::super::board::reconcile(sim.world(), &mut state);
        let owner = state
            .assignments
            .iter()
            .find(|a| a.key == key)
            .unwrap()
            .owner;
        let person = sim
            .world_mut()
            .query::<(Entity, &terri_core::SimId)>()
            .iter(sim.world())
            .find(|(_, id)| id.0 == owner)
            .unwrap()
            .0;
        add(&mut state.surfaces, object, 850);
        let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
        episode.needed = true;
        episode.decision = Some(true);
        episode.outcome = DutyOutcome::WillDo;
        let started = super::super::work::start(sim.world_mut(), &mut state, person, key, false);
        state
            .episodes
            .iter_mut()
            .find(|e| e.key == key)
            .unwrap()
            .unavailable = !started;
        assert!(started);
        let xy = (pos.x as i32, pos.y as i32);
        for delta in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
            let to = (xy.0 + delta.0, xy.1 + delta.1);
            if to.0 >= 0 && to.1 >= 0 {
                sim.world_mut()
                    .resource_mut::<terri_core::TileGrid>()
                    .set_edge_blocked(xy, to, true);
            }
        }
        super::super::work::advance(sim.world_mut(), &mut state);
        assert!(state.tasks.is_empty());
        assert!(
            state
                .episodes
                .iter()
                .find(|e| e.key == key)
                .unwrap()
                .unavailable
        );
        let day_ticks = sim.world().resource::<crate::Content>().0.tuning.day_ticks;
        sim.world_mut().resource_mut::<terri_core::SimClock>().tick = u64::from(day_ticks);
        super::super::board::tick(sim.world_mut(), &mut state);
        assert_eq!(
            state
                .episodes
                .iter()
                .find(|e| e.key == key && e.day == 0)
                .unwrap()
                .outcome,
            DutyOutcome::Unavailable
        );
    }

    #[test]
    fn retained_surface_contact_rejects_a_new_wall() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        let key = ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        };
        let object = members(sim.world(), key)[0];
        let entity = crate::dining::entity(sim.world(), object).unwrap();
        let pos = *sim.world().get::<Position>(entity).unwrap();
        let grid = sim.world().resource::<terri_core::TileGrid>();
        let xy = (pos.x as i32, pos.y as i32);
        let contact = (xy.0, xy.1 + 1);
        let cell = contact.1 as u32 * grid.width() as u32 + contact.0 as u32;
        let single = ChoreKey {
            kind: ChoreKind::Surfaces,
            target: object,
        };
        assert!(super::super::work::contact_valid(sim.world(), single, cell));
        sim.world_mut()
            .resource_mut::<terri_core::TileGrid>()
            .set_edge_blocked(xy, contact, true);
        assert!(!super::super::work::contact_valid(
            sim.world(),
            single,
            cell
        ));
    }

    #[test]
    fn board_groups_each_existing_surface_type_once_per_room() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let keys = super::super::keys(sim.world());
        assert_eq!(
            keys.iter()
                .filter(|k| k.kind == ChoreKind::CounterSurfaces)
                .count(),
            1
        );
        assert_eq!(
            keys.iter()
                .filter(|k| k.kind == ChoreKind::TableSurfaces)
                .count(),
            1
        );
        assert!(!keys.iter().any(|k| k.kind == ChoreKind::Surfaces));
        let key = *keys
            .iter()
            .find(|k| k.kind == ChoreKind::CounterSurfaces)
            .unwrap();
        assert_eq!(members(sim.world(), key).len(), 3);
        assert!(members(sim.world(), ChoreKey { target: 120, ..key }).is_empty());
    }

    #[test]
    fn selling_last_surface_removes_its_duty_and_buying_first_surface_adds_one() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let key = ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        };
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        super::super::board::reconcile(sim.world(), &mut state);
        let unaffected: Vec<_> = state
            .assignments
            .iter()
            .filter(|a| a.key != key)
            .cloned()
            .collect();
        sim.world_mut().insert_resource(state);
        for object in members(sim.world(), key) {
            sim.world_mut()
                .resource_mut::<terri_core::CommandQueue>()
                .push(terri_core::SimCommand::SellObject { object });
            sim.flush_commands();
        }
        assert!(!super::super::keys(sim.world()).contains(&key));
        assert!(sim
            .world()
            .resource::<SavedChores>()
            .episodes
            .iter()
            .filter(|e| e.key == key)
            .all(|e| e.outcome == DutyOutcome::Unavailable));
        for prior in &unaffected {
            assert!(sim
                .world()
                .resource::<SavedChores>()
                .assignments
                .contains(prior));
        }
        let definition = sim
            .world()
            .resource::<crate::Content>()
            .0
            .find("counter")
            .unwrap()
            .0;
        sim.world_mut().insert_resource(terri_core::Funds(10000));
        let destination = (1..5)
            .flat_map(|y| (9..15).map(move |x| (x, y)))
            .find(|(x, y)| {
                crate::placement::purchase::validate_purchase(
                    sim.world(),
                    crate::placement::purchase::Purchase {
                        definition,
                        x: *x,
                        y: *y,
                        facing: terri_core::Facing::SouthWest,
                    },
                )
                .is_ok()
            })
            .unwrap();
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::BuyObject {
                definition,
                x: destination.0,
                y: destination.1,
                facing: terri_core::Facing::SouthWest,
            });
        sim.flush_commands();
        let new_key = ChoreKey { target: 8, ..key };
        assert_eq!(members(sim.world(), new_key).len(), 1);
        assert!(sim
            .world()
            .resource::<SavedChores>()
            .assignments
            .iter()
            .any(|a| a.key == new_key));
        for prior in &unaffected {
            assert!(sim
                .world()
                .resource::<SavedChores>()
                .assignments
                .contains(prior));
        }
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(loaded.world_hash(), sim.world_hash());
    }

    #[test]
    fn partitioning_a_room_moves_surface_members_to_the_new_duty() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let old = ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        };
        let ids = members(sim.world(), old);
        assert_eq!(ids.len(), 3);
        for y in 0..6 {
            sim.world_mut()
                .resource_mut::<terri_core::CommandQueue>()
                .push(terri_core::SimCommand::SetWallEdge {
                    axis: terri_core::layout::EdgeAxis::Vertical,
                    x: 4,
                    y,
                    state: if y == 2 {
                        terri_core::layout::WallState::Doorway
                    } else {
                        terri_core::layout::WallState::Wall
                    },
                });
        }
        sim.flush_commands();
        let groups: Vec<_> = super::super::keys(sim.world())
            .into_iter()
            .filter(|k| k.kind == ChoreKind::CounterSurfaces)
            .collect();
        assert_eq!(groups.len(), 2);
        assert_eq!(members(sim.world(), old).len(), 2);
        assert_eq!(
            groups
                .iter()
                .map(|key| members(sim.world(), *key).len())
                .sum::<usize>(),
            3
        );
        let mut loaded = crate::Sim::new_from_shipped_lot();
        loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
        assert_eq!(loaded.world_hash(), sim.world_hash());
    }

    #[test]
    fn removing_the_only_dirty_member_does_not_leave_a_neglected_duty() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let key = ChoreKey {
            kind: ChoreKind::CounterSurfaces,
            target: 0,
        };
        let object = members(sim.world(), key)[0];
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        add(&mut state.surfaces, object, 850);
        super::super::board::reconcile(sim.world(), &mut state);
        let episode = state.episodes.iter_mut().find(|e| e.key == key).unwrap();
        episode.needed = true;
        episode.decision = Some(false);
        episode.outcome = DutyOutcome::Skipped;
        sim.world_mut().insert_resource(state);
        sim.world_mut()
            .resource_mut::<terri_core::CommandQueue>()
            .push(terri_core::SimCommand::SellObject { object });
        sim.flush_commands();
        let state = sim.world().resource::<SavedChores>();
        let episode = state.episodes.iter().find(|e| e.key == key).unwrap();
        assert!(!episode.needed);
        assert_eq!(episode.outcome, DutyOutcome::NoWork);
        assert_eq!(episode.decision, Some(false));
        assert_eq!(members(sim.world(), key).len(), 2);
    }

    #[test]
    fn group_visits_every_counter_and_reloads_between_each_stage() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let key = *super::super::keys(sim.world())
            .iter()
            .find(|k| k.kind == ChoreKind::CounterSurfaces)
            .unwrap();
        let ids = members(sim.world(), key);
        let people: Vec<_> = sim
            .world_mut()
            .query::<(Entity, &terri_core::Agent)>()
            .iter(sim.world())
            .map(|(e, _)| e)
            .collect();
        let person = people[0];
        for other in people.iter().skip(1) {
            sim.world_mut()
                .entity_mut(*other)
                .insert(terri_core::AtWork {
                    remaining_ticks: 10000,
                });
        }
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        state.board_enabled = false;
        for id in &ids {
            add(&mut state.surfaces, *id, 850);
        }
        assert!(super::super::work::start(
            sim.world_mut(),
            &mut state,
            person,
            key,
            true
        ));
        sim.world_mut().insert_resource(state);
        let mut complete = false;
        for _ in 0..1600 {
            sim.tick();
            let saved = sim.save_snapshot_v5();
            let mut loaded = crate::Sim::new_from_shipped_lot();
            loaded
                .load_snapshot_v5(saved)
                .expect("group work saves between surfaces");
            assert_eq!(loaded.world_hash(), sim.world_hash());
            if sim.world().resource::<SavedChores>().tasks.is_empty() {
                complete = true;
                break;
            }
        }
        assert!(complete);
        for id in ids {
            assert!(value(&sim.world().resource::<SavedChores>().surfaces, id) < 20);
        }
    }

    #[test]
    fn moving_all_counters_removes_old_group_adds_new_group_and_releases_suspended_work() {
        let mut sim = crate::Sim::new_from_shipped_lot();
        super::super::ensure(sim.world_mut());
        let key = *super::super::keys(sim.world())
            .iter()
            .find(|k| k.kind == ChoreKind::CounterSurfaces)
            .unwrap();
        let ids = members(sim.world(), key);
        let person = sim
            .world_mut()
            .query::<(Entity, &terri_core::Agent)>()
            .iter(sim.world())
            .next()
            .unwrap()
            .0;
        let mut state = sim.world_mut().remove_resource::<SavedChores>().unwrap();
        state.board_enabled = false;
        for id in &ids {
            add(&mut state.surfaces, *id, 850);
        }
        assert!(super::super::work::start(
            sim.world_mut(),
            &mut state,
            person,
            key,
            true
        ));
        sim.world_mut()
            .entity_mut(person)
            .insert(terri_core::AtWork {
                remaining_ticks: 10000,
            });
        super::super::work::advance(sim.world_mut(), &mut state);
        sim.world_mut().insert_resource(state);
        for id in ids {
            let destination = (1..5)
                .flat_map(|y| (9..15).map(move |x| (x, y)))
                .find(|xy| {
                    crate::placement::validate_placement(
                        sim.world(),
                        id,
                        *xy,
                        terri_core::Facing::SouthWest,
                    )
                    .is_ok()
                })
                .unwrap();
            sim.world_mut()
                .resource_mut::<terri_core::CommandQueue>()
                .push(terri_core::SimCommand::PlaceObject {
                    object: id,
                    x: destination.0,
                    y: destination.1,
                    facing: terri_core::Facing::SouthWest,
                });
            sim.flush_commands();
            let mut loaded = crate::Sim::new_from_shipped_lot();
            loaded.load_snapshot_v5(sim.save_snapshot_v5()).unwrap();
            assert_eq!(loaded.world_hash(), sim.world_hash());
        }
        assert!(!super::super::keys(sim.world()).contains(&key));
        assert_eq!(members(sim.world(), ChoreKey { target: 8, ..key }).len(), 3);
        assert!(sim.world().resource::<SavedChores>().tasks.is_empty());
        assert!(sim.world().get::<ChoreWork>(person).is_none());
    }
}
