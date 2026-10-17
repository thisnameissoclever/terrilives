//! Pure baseline-to-final identity proposals. Previewing never allocates live IDs.
use super::{RoomComponent, RoomError, RoomTopology, TopologyCell};
use bevy_ecs::prelude::Resource;
use std::collections::{BTreeMap, BTreeSet};
use terri_core::rooms::{
    validate_room_name, RoomId, RoomRecord, RoomSelection, SavedRooms, MAX_ROOM_RECORDS,
};

#[derive(Clone, Debug, PartialEq, Eq, Resource)]
pub struct RoomMap {
    pub topology: RoomTopology,
    pub component_ids: Vec<RoomId>,
}

impl RoomMap {
    /// Moves confirmed membership with a land purchase. New land is Outside;
    /// draft wall edits are deliberately not recomputed until confirmation.
    pub fn translated(
        &self,
        width: u32,
        height: u32,
        (dx, dy): (u32, u32),
    ) -> Result<Self, RoomError> {
        validate_map(self)?;
        if self
            .topology
            .width
            .checked_add(dx)
            .is_none_or(|right| right > width)
            || self
                .topology
                .height
                .checked_add(dy)
                .is_none_or(|bottom| bottom > height)
        {
            return Err(RoomError::InvalidDimensions);
        }
        let count = width
            .checked_mul(height)
            .ok_or(RoomError::InvalidDimensions)? as usize;
        let mut cells = Vec::new();
        cells
            .try_reserve_exact(count)
            .map_err(|_| RoomError::AllocationFailed)?;
        cells.resize(count, TopologyCell::Outside);
        let translate_cell =
            |cell: u32| (cell / self.topology.width + dy) * width + cell % self.topology.width + dx;
        for (old, &cell) in self.topology.cells.iter().enumerate() {
            cells[translate_cell(old as u32) as usize] = cell;
        }
        let components = self
            .topology
            .components
            .iter()
            .map(|component| RoomComponent {
                anchor: (component.anchor.0 + dx, component.anchor.1 + dy),
                cells: component
                    .cells
                    .iter()
                    .map(|&cell| translate_cell(cell))
                    .collect(),
            })
            .collect();
        Ok(Self {
            topology: RoomTopology {
                width,
                height,
                cells,
                components,
            },
            component_ids: self.component_ids.clone(),
        })
    }

    /// Strict current-registry adoption, without historical migration or repair.
    pub fn from_saved(topology: RoomTopology, saved: &SavedRooms) -> Result<Self, RoomError> {
        validate_topology(&topology)?;
        saved.validate().map_err(|_| RoomError::InvalidRegistry)?;
        let live: BTreeMap<_, _> = saved
            .records
            .iter()
            .filter_map(|record| record.anchor.map(|anchor| (anchor, record.id)))
            .collect();
        if live.len() != topology.components.len() {
            return Err(RoomError::InvalidRegistry);
        }
        let component_ids = topology
            .components
            .iter()
            .map(|component| {
                live.get(&component.anchor)
                    .copied()
                    .ok_or(RoomError::InvalidRegistry)
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            topology,
            component_ids,
        })
    }

    pub fn selection_at(&self, cell: (u32, u32)) -> Option<RoomSelection> {
        match self.topology.at(cell)? {
            TopologyCell::Outside => Some(RoomSelection::Outside),
            TopologyCell::Enclosed(index) => self
                .component_ids
                .get(index as usize)
                .copied()
                .map(RoomSelection::Room),
            TopologyCell::NotFloor => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct RoomChoices {
    /// Omitted anchors use the proposal. Explicit None requests a fresh ID.
    pub inheritance: BTreeMap<(u32, u32), Option<RoomId>>,
    pub names: BTreeMap<(u32, u32), String>,
    pub outside_name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RoomChangeKind {
    Split,
    Merge,
    Repartition,
    LostEnclosure,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomChangeGroup {
    pub kind: RoomChangeKind,
    pub old_ids: Vec<RoomId>,
    pub final_anchors: Vec<(u32, u32)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomMatchProposal {
    pub groups: Vec<RoomChangeGroup>,
    pub overlaps: Vec<RoomOverlap>,
    pub default_inheritance: BTreeMap<(u32, u32), RoomId>,
    /// Invalid input is carried to the fallible resolver, never partially applied.
    pub error: Option<RoomError>,
    before: RoomMap,
    after: RoomTopology,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomOverlap {
    pub old_id: RoomId,
    pub final_anchor: (u32, u32),
    pub shared_tiles: u32,
    pub old_tiles: u32,
    pub final_tiles: u32,
    pub exact: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRooms {
    pub map: RoomMap,
    pub saved: SavedRooms,
    pub correspondence: BTreeMap<RoomId, Option<RoomId>>,
    pub new_ids: Vec<RoomId>,
    pub retired_ids: Vec<RoomId>,
}

pub fn match_rooms(
    before: &RoomMap,
    after: &RoomTopology,
    translation: (i32, i32),
) -> RoomMatchProposal {
    let mut proposal = RoomMatchProposal {
        groups: vec![],
        overlaps: vec![],
        default_inheritance: BTreeMap::new(),
        error: None,
        before: before.clone(),
        after: after.clone(),
    };
    if let Err(error) = validate_map(before).and_then(|_| validate_topology(after)) {
        proposal.error = Some(error);
        return proposal;
    }
    // One pass over old membership builds only pairs that actually share tiles.
    // A large lot with unrelated rooms never allocates a room-by-room matrix.
    let mut counts = BTreeMap::<(usize, usize), u32>::new();
    for (old_index, component) in before.topology.components.iter().enumerate() {
        for &cell in &component.cells {
            let x = i64::from(cell % before.topology.width) + i64::from(translation.0);
            let y = i64::from(cell / before.topology.width) + i64::from(translation.1);
            if x < 0 || y < 0 || x >= i64::from(after.width) || y >= i64::from(after.height) {
                continue;
            }
            if let Some(TopologyCell::Enclosed(index)) = after.at((x as u32, y as u32)) {
                *counts.entry((old_index, index as usize)).or_default() += 1;
            }
        }
    }
    for ((old_index, final_index), shared_tiles) in counts {
        let old_tiles = before.topology.components[old_index].cells.len() as u32;
        let final_component = &after.components[final_index];
        let final_tiles = final_component.cells.len() as u32;
        proposal.overlaps.push(RoomOverlap {
            old_id: before.component_ids[old_index],
            final_anchor: final_component.anchor,
            shared_tiles,
            old_tiles,
            final_tiles,
            exact: shared_tiles == old_tiles && shared_tiles == final_tiles,
        });
    }
    proposal.overlaps.sort_by(overlap_order);
    let mut used = BTreeSet::new();
    for overlap in &proposal.overlaps {
        if !used.contains(&overlap.old_id)
            && !proposal
                .default_inheritance
                .contains_key(&overlap.final_anchor)
        {
            used.insert(overlap.old_id);
            proposal
                .default_inheritance
                .insert(overlap.final_anchor, overlap.old_id);
        }
    }
    proposal.groups = change_groups(before, &proposal.overlaps);
    proposal
}

pub fn resolve_rooms(
    proposal: &RoomMatchProposal,
    choices: &RoomChoices,
    saved: &SavedRooms,
) -> Result<ResolvedRooms, RoomError> {
    if let Some(error) = proposal.error {
        return Err(error);
    }
    if RoomMap::from_saved(proposal.before.topology.clone(), saved)? != proposal.before {
        return Err(RoomError::InvalidRegistry);
    }
    let anchors: BTreeSet<_> = proposal
        .after
        .components
        .iter()
        .map(|component| component.anchor)
        .collect();
    if choices
        .inheritance
        .keys()
        .chain(choices.names.keys())
        .any(|anchor| !anchors.contains(anchor))
    {
        return Err(RoomError::InvalidChoice);
    }
    let mut inheritance = BTreeMap::new();
    let mut used = BTreeSet::new();
    // Explicit choices reserve their predecessor first. A default on another
    // child cannot consume the same identity before the player's choice.
    for (&anchor, &old_id) in &choices.inheritance {
        if let Some(id) = old_id {
            if !proposal
                .overlaps
                .iter()
                .any(|overlap| overlap.old_id == id && overlap.final_anchor == anchor)
                || !used.insert(id)
            {
                return Err(RoomError::InvalidChoice);
            }
            inheritance.insert(anchor, id);
        }
    }
    for overlap in &proposal.overlaps {
        let (anchor, id) = (overlap.final_anchor, overlap.old_id);
        if !choices.inheritance.contains_key(&anchor)
            && !inheritance.contains_key(&anchor)
            && used.insert(id)
        {
            inheritance.insert(anchor, id);
        }
    }
    let names = choices
        .names
        .iter()
        .map(|(&anchor, name)| {
            validate_room_name(name)
                .map(|name| (anchor, name))
                .map_err(|_| RoomError::InvalidName)
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let mut updated = saved.clone();
    if let Some(name) = &choices.outside_name {
        updated.outside_name = validate_room_name(name).map_err(|_| RoomError::InvalidName)?;
    }
    let old_names: BTreeMap<_, _> = saved
        .records
        .iter()
        .map(|record| (record.id, record.name.clone()))
        .collect();
    // Reserve all final explicit and inherited names before allocating defaults,
    // including names on components that occur later in row order.
    let mut reserved_names: BTreeSet<_> = names.values().cloned().collect();
    reserved_names.insert(updated.outside_name.clone());
    for (&anchor, &id) in &inheritance {
        if !names.contains_key(&anchor) {
            reserved_names.insert(old_names[&id].clone());
        }
    }
    for record in &mut updated.records {
        record.anchor = None;
    }
    let record_indices: BTreeMap<_, _> = updated
        .records
        .iter()
        .enumerate()
        .map(|(index, record)| (record.id, index))
        .collect();
    let mut component_ids = Vec::new();
    let mut new_ids = Vec::new();
    for component in &proposal.after.components {
        if let Some(&id) = inheritance.get(&component.anchor) {
            let record = &mut updated.records[record_indices[&id]];
            record.anchor = Some(component.anchor);
            if let Some(name) = names.get(&component.anchor) {
                record.name.clone_from(name);
            }
            component_ids.push(id);
        } else {
            if updated.records.len() >= MAX_ROOM_RECORDS {
                return Err(RoomError::TooManyRecords);
            }
            let id = RoomId::new(updated.next_id).ok_or(RoomError::IdExhausted)?;
            updated.next_id = updated
                .next_id
                .checked_add(1)
                .ok_or(RoomError::IdExhausted)?;
            let name = match names.get(&component.anchor) {
                Some(name) => name.clone(),
                None => next_name(&mut updated, &mut reserved_names)?,
            };
            updated.records.push(RoomRecord {
                id,
                name,
                anchor: Some(component.anchor),
            });
            component_ids.push(id);
            new_ids.push(id);
        }
    }
    let live_ids: BTreeSet<_> = component_ids.iter().copied().collect();
    let mut retired_ids: Vec<_> = proposal
        .before
        .component_ids
        .iter()
        .filter(|id| !live_ids.contains(id))
        .copied()
        .collect();
    retired_ids.sort_unstable();
    let final_ids: BTreeMap<_, _> = proposal
        .after
        .components
        .iter()
        .map(|component| component.anchor)
        .zip(component_ids.iter().copied())
        .collect();
    let correspondence = proposal
        .before
        .component_ids
        .iter()
        .map(|&old_id| {
            let target = if live_ids.contains(&old_id) {
                Some(old_id)
            } else {
                proposal
                    .overlaps
                    .iter()
                    .find(|overlap| overlap.old_id == old_id)
                    .map(|overlap| final_ids[&overlap.final_anchor])
            };
            (old_id, target)
        })
        .collect();
    let map = RoomMap {
        topology: proposal.after.clone(),
        component_ids,
    };
    // Do not let matching weaken the same strict adoption contract used on load.
    if RoomMap::from_saved(map.topology.clone(), &updated)? != map {
        return Err(RoomError::InvalidRegistry);
    }
    Ok(ResolvedRooms {
        map,
        saved: updated,
        correspondence,
        new_ids,
        retired_ids,
    })
}

fn next_name(saved: &mut SavedRooms, reserved: &mut BTreeSet<String>) -> Result<String, RoomError> {
    loop {
        let number = saved.next_default_name;
        saved.next_default_name = number
            .checked_add(1)
            .ok_or(RoomError::DefaultNameExhausted)?;
        let name = format!("Room {number}");
        if reserved.insert(name.clone()) {
            return Ok(name);
        }
    }
}

fn row_order((x, y): (u32, u32)) -> (u32, u32) {
    (y, x)
}

fn overlap_order(a: &RoomOverlap, b: &RoomOverlap) -> std::cmp::Ordering {
    b.exact
        .cmp(&a.exact)
        .then_with(|| b.shared_tiles.cmp(&a.shared_tiles))
        .then_with(|| {
            (u64::from(b.shared_tiles) * u64::from(a.old_tiles))
                .cmp(&(u64::from(a.shared_tiles) * u64::from(b.old_tiles)))
        })
        .then_with(|| a.old_id.cmp(&b.old_id))
        .then_with(|| row_order(a.final_anchor).cmp(&row_order(b.final_anchor)))
}

fn validate_map(map: &RoomMap) -> Result<(), RoomError> {
    validate_topology(&map.topology)?;
    let unique: BTreeSet<_> = map.component_ids.iter().collect();
    if map.component_ids.len() != map.topology.components.len()
        || unique.len() != map.component_ids.len()
    {
        return Err(RoomError::InvalidRoomMap);
    }
    Ok(())
}

fn validate_topology(topology: &RoomTopology) -> Result<(), RoomError> {
    let count = topology
        .width
        .checked_mul(topology.height)
        .filter(|_| topology.width > 0 && topology.height > 0)
        .ok_or(RoomError::InvalidRoomMap)?;
    if topology.cells.len() != count as usize {
        return Err(RoomError::InvalidRoomMap);
    }
    let mut previous = None;
    for (index, component) in topology.components.iter().enumerate() {
        let first = component
            .cells
            .first()
            .copied()
            .ok_or(RoomError::InvalidRoomMap)?;
        if component.anchor != (first % topology.width, first / topology.width)
            || previous.is_some_and(|old| old >= first)
            || component.cells.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err(RoomError::InvalidRoomMap);
        }
        previous = Some(first);
        for &cell in &component.cells {
            if topology.cells.get(cell as usize) != Some(&TopologyCell::Enclosed(index as u32)) {
                return Err(RoomError::InvalidRoomMap);
            }
        }
    }
    let enclosed_count = topology
        .cells
        .iter()
        .filter(|cell| matches!(cell, TopologyCell::Enclosed(_)))
        .count();
    if topology
        .components
        .iter()
        .map(|component| component.cells.len())
        .sum::<usize>()
        != enclosed_count
    {
        return Err(RoomError::InvalidRoomMap);
    }
    Ok(())
}

fn change_groups(before: &RoomMap, overlaps: &[RoomOverlap]) -> Vec<RoomChangeGroup> {
    let mut old_to_final = BTreeMap::<RoomId, BTreeSet<(u32, u32)>>::new();
    let mut final_to_old = BTreeMap::<(u32, u32), BTreeSet<RoomId>>::new();
    for overlap in overlaps {
        old_to_final
            .entry(overlap.old_id)
            .or_default()
            .insert(overlap.final_anchor);
        final_to_old
            .entry(overlap.final_anchor)
            .or_default()
            .insert(overlap.old_id);
    }
    let mut visited = BTreeSet::new();
    let mut groups = Vec::new();
    let old_ids: BTreeSet<_> = before.component_ids.iter().copied().collect();
    for old_id in old_ids {
        if !visited.insert(old_id) {
            continue;
        }
        let mut ids = BTreeSet::from([old_id]);
        let mut anchors = BTreeSet::new();
        let mut queue = vec![old_id];
        let mut cursor = 0;
        while cursor < queue.len() {
            let current = queue[cursor];
            cursor += 1;
            for &anchor in old_to_final.get(&current).into_iter().flatten() {
                if anchors.insert(anchor) {
                    for &other in &final_to_old[&anchor] {
                        if visited.insert(other) {
                            ids.insert(other);
                            queue.push(other);
                        }
                    }
                }
            }
        }
        let kind = match (ids.len(), anchors.len()) {
            (_, 0) => Some(RoomChangeKind::LostEnclosure),
            (1, 1) => None,
            (1, _) => Some(RoomChangeKind::Split),
            (_, 1) => Some(RoomChangeKind::Merge),
            _ => Some(RoomChangeKind::Repartition),
        };
        if let Some(kind) = kind {
            let mut final_anchors: Vec<_> = anchors.into_iter().collect();
            final_anchors.sort_by_key(|&anchor| row_order(anchor));
            groups.push(RoomChangeGroup {
                kind,
                old_ids: ids.into_iter().collect(),
                final_anchors,
            });
        }
    }
    // New unrelated rooms need no review; only baseline-connected groups appear.
    groups
}
