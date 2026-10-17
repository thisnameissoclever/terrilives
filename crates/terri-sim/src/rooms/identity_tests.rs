use super::*;
use std::collections::BTreeMap;
use terri_core::rooms::{RoomId, RoomRecord, RoomSelection, SavedRooms};

fn id(value: u32) -> RoomId {
    RoomId::new(value).unwrap()
}

// Labels describe already calculated components, not walls or furniture.
fn topology(rows: &[&str]) -> RoomTopology {
    let width = rows[0].len() as u32;
    let height = rows.len() as u32;
    let mut labels = BTreeMap::<u8, u32>::new();
    let mut components = Vec::<RoomComponent>::new();
    let mut cells = Vec::new();
    for (y, row) in rows.iter().enumerate() {
        assert_eq!(row.len(), width as usize);
        for (x, label) in row.bytes().enumerate() {
            if label == b'.' {
                cells.push(TopologyCell::Outside);
            } else if label == b'#' {
                cells.push(TopologyCell::NotFloor);
            } else {
                let index = *labels.entry(label).or_insert_with(|| {
                    let index = components.len() as u32;
                    components.push(RoomComponent {
                        anchor: (x as u32, y as u32),
                        cells: vec![],
                    });
                    index
                });
                components[index as usize]
                    .cells
                    .push(y as u32 * width + x as u32);
                cells.push(TopologyCell::Enclosed(index));
            }
        }
    }
    RoomTopology {
        width,
        height,
        cells,
        components,
    }
}

fn baseline(rows: &[&str], named: &[(u32, &str)]) -> (RoomMap, SavedRooms) {
    let topology = topology(rows);
    assert_eq!(named.len(), topology.components.len());
    let records = named
        .iter()
        .zip(&topology.components)
        .map(|(&(value, name), component)| RoomRecord {
            id: id(value),
            name: name.into(),
            anchor: Some(component.anchor),
        })
        .collect();
    let saved = SavedRooms {
        outside_name: "Outside".into(),
        next_id: named.iter().map(|v| v.0).max().unwrap_or(0) + 1,
        next_default_name: 1,
        records,
    };
    (
        RoomMap {
            topology,
            component_ids: named.iter().map(|v| id(v.0)).collect(),
        },
        saved,
    )
}

fn resolve(before: &RoomMap, after: &RoomTopology, saved: &SavedRooms) -> ResolvedRooms {
    resolve_rooms(
        &match_rooms(before, after, (0, 0)),
        &RoomChoices::default(),
        saved,
    )
    .unwrap()
}

fn live(result: &ResolvedRooms) -> Vec<(u32, &str)> {
    result
        .map
        .component_ids
        .iter()
        .map(|&id| (id.get(), result.saved.record(id).unwrap().name.as_str()))
        .collect()
}

#[test]
fn rooms_exact_match_preserves_every_saved_byte_and_allocator() {
    let (before, mut saved) = baseline(&["AAA.BB"], &[(17, "Kitchen"), (3, "Office")]);
    saved.next_default_name = 92;
    let proposal = match_rooms(&before, &before.topology, (0, 0));
    assert!(proposal.overlaps.iter().all(|overlap| overlap.exact));
    let result = resolve(&before, &before.topology, &saved);
    assert_eq!(result.map, before);
    assert_eq!(result.saved, saved);
    assert_eq!(
        result.correspondence,
        BTreeMap::from([(id(3), Some(id(3))), (id(17), Some(id(17)))])
    );
    assert!(result.new_ids.is_empty());
    assert!(result.retired_ids.is_empty());
}

#[test]
fn rooms_resize_preserves_id_name_and_only_moves_anchor() {
    let (before, saved) = baseline(&[".AAA.."], &[(41, "Kitchen")]);
    let after = topology(&["AAAAA."]);
    let result = resolve(&before, &after, &saved);
    assert_eq!(live(&result), vec![(41, "Kitchen")]);
    assert_eq!(result.saved.record(id(41)).unwrap().anchor, Some((0, 0)));
    assert_eq!(result.saved.next_id, 42);
    assert_eq!(result.saved.next_default_name, 1);
}

#[test]
fn rooms_split_defaults_to_largest_child_but_choice_can_move_inheritance() {
    let (before, saved) = baseline(&["AAAAAA"], &[(8, "Kitchen")]);
    let after = topology(&["AA.BBB"]);
    let proposal = match_rooms(&before, &after, (0, 0));
    assert_eq!(proposal.groups[0].kind, RoomChangeKind::Split);
    let result = resolve_rooms(&proposal, &RoomChoices::default(), &saved).unwrap();
    assert_eq!(live(&result), vec![(9, "Room 1"), (8, "Kitchen")]);
    let choices = RoomChoices {
        inheritance: BTreeMap::from([((0, 0), Some(id(8)))]),
        names: BTreeMap::from([((3, 0), "New study".into())]),
        ..Default::default()
    };
    let chosen = resolve_rooms(&proposal, &choices, &saved).unwrap();
    assert_eq!(live(&chosen), vec![(8, "Kitchen"), (9, "New study")]);
    assert_eq!(saved.next_id, 9);
}

#[test]
fn rooms_merge_prefers_overlap_then_old_fraction_then_id() {
    let (before, saved) = baseline(&["AAAA.BB."], &[(9, "Kitchen"), (2, "Office")]);
    // Two cells from each predecessor; all of Office survives.
    let after = topology(&["..CCCCCC"]);
    let proposal = match_rooms(&before, &after, (0, 0));
    assert_eq!(proposal.groups[0].kind, RoomChangeKind::Merge);
    let result = resolve_rooms(&proposal, &RoomChoices::default(), &saved).unwrap();
    assert_eq!(live(&result), vec![(2, "Office")]);
    assert_eq!(result.retired_ids, vec![id(9)]);
    assert_eq!(result.saved.record(id(9)).unwrap().anchor, None);
    assert_eq!(result.correspondence[&id(9)], Some(id(2)));
    let (before, saved) = baseline(&["AA.BB"], &[(7, "One"), (3, "Two")]);
    assert_eq!(
        live(&resolve(&before, &topology(&["CCCCC"]), &saved)),
        vec![(3, "Two")]
    );
    let (before, saved) = baseline(&["AAAAAA.BB"], &[(9, "Large"), (2, "Small")]);
    assert_eq!(
        live(&resolve(&before, &topology(&["..CCCCCCC"]), &saved)),
        vec![(9, "Large")]
    );
}

#[test]
fn rooms_equal_split_ties_use_row_order_and_many_to_many_uses_one_id_once() {
    let (before, saved) = baseline(&["AAAAA"], &[(5, "One")]);
    assert_eq!(
        live(&resolve(&before, &topology(&["CC.DD"]), &saved)),
        vec![(5, "One"), (6, "Room 1")]
    );
    let (before, saved) = baseline(&["AAAAAA", "AAAAAA"], &[(5, "One")]);
    assert_eq!(
        live(&resolve(&before, &topology(&[".CCCCC", "DDDDD."]), &saved)),
        vec![(5, "One"), (6, "Room 1")]
    );
    let (before, saved) = baseline(&["AABB", "AABB"], &[(7, "One"), (3, "Two")]);
    let after = topology(&["CCCC", "DDDD"]);
    let proposal = match_rooms(&before, &after, (0, 0));
    assert_eq!(proposal.groups.len(), 1);
    assert_eq!(proposal.groups[0].kind, RoomChangeKind::Repartition);
    assert_eq!(proposal.groups[0].old_ids, vec![id(3), id(7)]);
    assert_eq!(
        live(&resolve_rooms(&proposal, &RoomChoices::default(), &saved).unwrap()),
        vec![(3, "Two"), (7, "One")]
    );
    let duplicate = RoomChoices {
        inheritance: BTreeMap::from([((0, 0), Some(id(3))), ((0, 1), Some(id(3)))]),
        ..Default::default()
    };
    assert_eq!(
        resolve_rooms(&proposal, &duplicate, &saved),
        Err(RoomError::InvalidChoice)
    );
    let swapped = RoomChoices {
        inheritance: BTreeMap::from([((0, 1), Some(id(3)))]),
        ..Default::default()
    };
    assert_eq!(
        live(&resolve_rooms(&proposal, &swapped, &saved).unwrap()),
        vec![(7, "One"), (3, "Two")]
    );
}

#[test]
fn rooms_lost_enclosure_retires_without_resurrection_and_new_rooms_allocate_monotonically() {
    let (before, saved) = baseline(&["AAA..."], &[(6, "Old room")]);
    let opened = topology(&["......"]);
    let proposal = match_rooms(&before, &opened, (0, 0));
    assert_eq!(proposal.groups[0].kind, RoomChangeKind::LostEnclosure);
    let retired = resolve_rooms(&proposal, &RoomChoices::default(), &saved).unwrap();
    assert_eq!(retired.correspondence[&id(6)], None);
    assert_eq!(retired.saved.record(id(6)).unwrap().anchor, None);
    let rebuilt = resolve(&retired.map, &before.topology, &retired.saved);
    assert_eq!(live(&rebuilt), vec![(7, "Room 1")]);
    assert_eq!(rebuilt.saved.next_default_name, 2);
}

#[test]
fn rooms_outside_is_one_editable_selection_even_when_no_cleanable_area_exists() {
    let (before, saved) = baseline(&[".#..#.."], &[]);
    for x in [0, 2, 3, 5, 6] {
        assert_eq!(before.selection_at((x, 0)), Some(RoomSelection::Outside));
    }
    assert_eq!(RoomSelection::Outside.key(), 0);
    assert_eq!(RoomSelection::from_key(0), RoomSelection::Outside);
    assert!(RoomId::new(0).is_none());
    assert_eq!(before.selection_at((1, 0)), None);
    let choices = RoomChoices {
        outside_name: Some("  Garden & <yard>  ".into()),
        ..Default::default()
    };
    let result = resolve_rooms(
        &match_rooms(&before, &before.topology, (0, 0)),
        &choices,
        &saved,
    )
    .unwrap();
    assert_eq!(result.saved.outside_name, "Garden & <yard>");
    assert_eq!(result.saved.records.len(), 0);
    assert_eq!(result.saved.next_id, 1);
}

#[test]
fn rooms_names_validate_unicode_controls_and_preserve_plain_text_duplicates() {
    use terri_core::rooms::validate_room_name;
    for name in ["", " \t ", "a\nb", "a\rb", "a\0b", "a\u{7f}b", "a\u{85}b"] {
        assert!(validate_room_name(name).is_err(), "{name:?}");
    }
    assert_eq!(validate_room_name("  A & <b>  ").unwrap(), "A & <b>");
    assert_eq!(
        validate_room_name(&"🦀".repeat(48)).unwrap(),
        "🦀".repeat(48)
    );
    assert!(validate_room_name(&"🦀".repeat(49)).is_err());
    let (before, saved) = baseline(&["AA.BB"], &[(8, "First"), (9, "Second")]);
    let choices = RoomChoices {
        names: BTreeMap::from([((0, 0), "Same".into()), ((3, 0), "Same".into())]),
        ..Default::default()
    };
    let result = resolve_rooms(
        &match_rooms(&before, &before.topology, (0, 0)),
        &choices,
        &saved,
    )
    .unwrap();
    assert_eq!(live(&result), vec![(8, "Same"), (9, "Same")]);
}

#[test]
fn rooms_generated_names_skip_custom_collisions_including_later_components() {
    let (before, saved) = baseline(&["......BB"], &[(5, "Room 1")]);
    let after = topology(&["AA.CC.BB"]);
    let choices = RoomChoices {
        names: BTreeMap::from([((3, 0), "Room 2".into())]),
        ..Default::default()
    };
    let result = resolve_rooms(&match_rooms(&before, &after, (0, 0)), &choices, &saved).unwrap();
    assert_eq!(
        live(&result),
        vec![(6, "Room 3"), (7, "Room 2"), (5, "Room 1")]
    );
    assert_eq!(result.saved.next_default_name, 4);
}

#[test]
fn rooms_translation_preserves_ids_names_and_counters() {
    let (before, saved) = baseline(&["AA.B", "AA.B"], &[(91, "Kitchen"), (4, "Office")]);
    let after = topology(&["......", "......", ".AA.B.", ".AA.B."]);
    let result = resolve_rooms(
        &match_rooms(&before, &after, (1, 2)),
        &RoomChoices::default(),
        &saved,
    )
    .unwrap();
    assert_eq!(live(&result), vec![(91, "Kitchen"), (4, "Office")]);
    assert_eq!(result.saved.next_id, saved.next_id);
    assert_eq!(result.saved.next_default_name, saved.next_default_name);
    assert_eq!(result.saved.record(id(91)).unwrap().anchor, Some((1, 2)));
    assert_eq!(result.saved.record(id(4)).unwrap().anchor, Some((4, 2)));
    assert!(result.new_ids.is_empty());
    assert!(result.retired_ids.is_empty());
}

#[test]
fn rooms_invalid_choices_registry_and_allocator_overflow_fail_without_mutation() {
    let (before, saved) = baseline(&["AAA..."], &[(3, "Room")]);
    let after = topology(&["AAA.BB"]);
    let proposal = match_rooms(&before, &after, (0, 0));
    let invalid = RoomChoices {
        inheritance: BTreeMap::from([((4, 0), Some(id(3)))]),
        ..Default::default()
    };
    assert_eq!(
        resolve_rooms(&proposal, &invalid, &saved),
        Err(RoomError::InvalidChoice)
    );
    let stale = RoomChoices {
        names: BTreeMap::from([((99, 99), "Stale".into())]),
        ..Default::default()
    };
    assert_eq!(
        resolve_rooms(&proposal, &stale, &saved),
        Err(RoomError::InvalidChoice)
    );
    let mut exhausted = saved.clone();
    exhausted.next_id = u32::MAX;
    assert_eq!(
        resolve_rooms(&proposal, &RoomChoices::default(), &exhausted),
        Err(RoomError::IdExhausted)
    );
    exhausted = saved.clone();
    exhausted.next_default_name = u32::MAX;
    assert_eq!(
        resolve_rooms(&proposal, &RoomChoices::default(), &exhausted),
        Err(RoomError::DefaultNameExhausted)
    );
    exhausted = saved.clone();
    exhausted.records.push(exhausted.records[0].clone());
    assert_eq!(
        resolve_rooms(&proposal, &RoomChoices::default(), &exhausted),
        Err(RoomError::InvalidRegistry)
    );
    assert_eq!(saved.record(id(3)).unwrap().name, "Room");
    assert_eq!(saved.next_id, 4);
}

#[test]
fn rooms_north_west_land_translation_preserves_stable_references_and_object_namespaces() {
    use terri_core::{
        chores::{ChoreAssignment, ChoreKey, ChoreKind, ChoreTask, SavedChores},
        save::{SavedCleanupOpportunity, SavedDining, SavedDomestic, SavedRoomVisit},
    };
    for side in [crate::land::Side::Rear, crate::land::Side::Right] {
        let mut sim = crate::Sim::new_from_shipped_lot();
        sim.world_mut()
            .insert_resource(terri_core::Funds::from_dollars(1_000_000));
        let actual = RoomTopology::from_world(sim.world()).unwrap();
        let empty = RoomMap {
            topology: topology(&["."]),
            component_ids: vec![],
        };
        let seed = SavedRooms {
            next_id: 9001,
            next_default_name: 72,
            ..Default::default()
        };
        let registered = resolve(&empty, &actual, &seed);
        let key = ChoreKey {
            kind: ChoreKind::Floors,
            target: registered.map.component_ids[0].get(),
        };
        let object_key = ChoreKey {
            kind: ChoreKind::Surfaces,
            target: 7,
        };
        sim.world_mut().insert_resource(registered.map.clone());
        sim.world_mut().insert_resource(registered.saved.clone());
        let chores = SavedChores {
            floors: vec![(22, 123)],
            surfaces: vec![(7, 456)],
            bins: vec![(9, 789)],
            traffic: vec![(32, 22)],
            assignments: vec![
                ChoreAssignment {
                    key,
                    owner: 32,
                    week: 3,
                },
                ChoreAssignment {
                    key: object_key,
                    owner: 32,
                    week: 3,
                },
            ],
            tasks: vec![
                ChoreTask {
                    person: 32,
                    key,
                    cells: vec![22],
                    cursor: 0,
                    endpoint: Some(22),
                    remaining: 18,
                    directed: true,
                    suspended: false,
                    started_day: 7,
                    completed_units: 2,
                },
                ChoreTask {
                    person: 32,
                    key: object_key,
                    cells: vec![7],
                    cursor: 0,
                    endpoint: Some(22),
                    remaining: 18,
                    directed: true,
                    suspended: false,
                    started_day: 7,
                    completed_units: 2,
                },
            ],
            ..Default::default()
        };
        sim.world_mut().insert_resource(chores.clone());
        let domestic = SavedDomestic {
            visits: vec![SavedRoomVisit {
                person: 32,
                room: key.target,
                seen: vec![71],
            }],
            ..Default::default()
        };
        let dining = SavedDining {
            opportunities: vec![SavedCleanupOpportunity {
                person: 32,
                room: key.target,
                known: vec![71],
                pending: true,
            }],
            ..Default::default()
        };
        sim.world_mut().insert_resource(domestic.clone());
        sim.world_mut().insert_resource(dining.clone());
        crate::land::buy(sim.world_mut(), side).unwrap();
        let (dx, dy, width) = match side {
            crate::land::Side::Rear => (10, 0, 30),
            _ => (0, 10, 20),
        };
        let moved_cell = (22 / 20 + dy) * width + (22 % 20 + dx);
        let moved = sim.world().resource::<SavedChores>();
        assert_eq!(moved.assignments, chores.assignments);
        assert_eq!(moved.tasks[0].key, key);
        assert_eq!(moved.tasks[0].cells, vec![moved_cell]);
        assert_eq!(moved.tasks[1].key, object_key);
        assert_eq!(moved.tasks[1].cells, vec![7]);
        assert_eq!(moved.tasks[1].endpoint, Some(moved_cell));
        assert_eq!(moved.floors, vec![(moved_cell, 123)]);
        assert_eq!(moved.traffic, vec![(32, moved_cell)]);
        assert_eq!(moved.surfaces, chores.surfaces);
        assert_eq!(moved.bins, chores.bins);
        assert_eq!(sim.world().resource::<SavedDomestic>(), &domestic);
        assert_eq!(sim.world().resource::<SavedDining>(), &dining);
        let saved = sim.world().resource::<SavedRooms>();
        assert_eq!(saved.next_id, registered.saved.next_id);
        assert_eq!(saved.next_default_name, registered.saved.next_default_name);
        for (record, old) in saved.records.iter().zip(&registered.saved.records) {
            assert_eq!(record.id, old.id);
            assert_eq!(record.name, old.name);
            assert_eq!(record.anchor, old.anchor.map(|(x, y)| (x + dx, y + dy)));
        }
        let map = sim.world().resource::<RoomMap>();
        assert_eq!(map.component_ids, registered.map.component_ids);
        assert_eq!(
            RoomMap::from_saved(RoomTopology::from_world(sim.world()).unwrap(), saved).unwrap(),
            *map
        );
    }
}

#[test]
fn rooms_current_adoption_is_strict_and_history_pruning_never_reuses_an_id() {
    let (before, mut saved) = baseline(&["AAA.BB"], &[(8, "One"), (3, "Two")]);
    assert_eq!(
        RoomMap::from_saved(before.topology.clone(), &saved).unwrap(),
        before
    );
    saved.records[0].anchor = Some((1, 0));
    assert_eq!(
        RoomMap::from_saved(before.topology.clone(), &saved),
        Err(RoomError::InvalidRegistry)
    );
    saved.records[0].anchor = Some((0, 0));
    saved.records.push(RoomRecord {
        id: id(5),
        name: "Old".into(),
        anchor: None,
    });
    saved.records.push(RoomRecord {
        id: id(6),
        name: "Older".into(),
        anchor: None,
    });
    saved.retain_history(&std::collections::BTreeSet::from([id(5)]));
    assert!(saved.record(id(5)).is_some());
    assert!(saved.record(id(6)).is_none());
    assert_eq!(saved.next_id, 9);
    assert_eq!(
        RoomMap::from_saved(before.topology.clone(), &saved).unwrap(),
        before
    );
}
