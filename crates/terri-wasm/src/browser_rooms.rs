//! Private room wire V1. Counts are checked before allocating hostile input.
use super::*;
use terri_core::rooms::{RoomId, RoomSelection, SavedRooms, MAX_ROOM_RECORDS};
use terri_sim::{
    build_transaction::{BuildCommitError, BuildReview, BuildToken, ValidationProblem},
    rooms::{RoomChoices, RoomMap, TopologyCell},
};

type Failure = (u8, Option<u64>);
const MALFORMED: Failure = (13, None);
const ALLOCATION: Failure = (3, None);
type Wire<T> = Result<T, Failure>;

fn error(error: BuildCommitError) -> Failure {
    use BuildCommitError::*;
    match error {
        NotActive => (1, None),
        AlreadyActive => (2, None),
        AllocationFailed => ALLOCATION,
        CounterExhausted => (4, None),
        InvalidRoom => (5, None),
        InvalidName => (6, None),
        Room(e) => {
            use terri_sim::rooms::RoomError::*;
            (
                7,
                Some(match e {
                    MissingGrid => 1,
                    MissingLayout => 2,
                    InvalidDimensions => 3,
                    InvalidArchitecture => 4,
                    AllocationFailed => 5,
                    FloodFillBound => 6,
                    InvalidRoomMap => 7,
                    InvalidRegistry => 8,
                    InvalidChoice => 9,
                    InvalidName => 10,
                    IdExhausted => 11,
                    DefaultNameExhausted => 12,
                    TooManyRecords => 13,
                }),
            )
        }
        ReplayMismatch { entry } => {
            u64::try_from(entry).map_or((4, None), |entry| (8, Some(entry)))
        }
        DraftMismatch => (9, None),
        Validation(e) => {
            use terri_sim::SaveError::*;
            (
                10,
                Some(match e {
                    IncompatibleContent => 1,
                    InvalidGrid => 2,
                    TooManyEntities => 3,
                    InvalidEntityOrder => 4,
                    InvalidEntityReference => 5,
                    InvalidContentReference => 6,
                    InvalidValue => 7,
                    DuplicateSelection => 8,
                    InvalidSimIdAllocator => 9,
                    TooManyCommands => 10,
                }),
            )
        }
        StaleToken => (11, None),
        CommandNotAllowed => (12, None),
        // Issue 298 ([WB-beds]): the bed a Confirm would leave outside, by
        // its entity index in the draft.
        BedOutside { object } => (15, Some(u64::from(object))),
    }
}

struct Writer(Vec<u8>);
impl Writer {
    fn raw(&mut self, bytes: &[u8]) -> Wire<()> {
        self.0.try_reserve(bytes.len()).map_err(|_| ALLOCATION)?;
        self.0.extend_from_slice(bytes);
        Ok(())
    }
    fn byte(&mut self, value: u8) -> Wire<()> {
        self.raw(&[value])
    }
    fn uint(&mut self, mut value: u64) -> Wire<()> {
        let mut bytes = [0; 10];
        let mut n = 0;
        loop {
            bytes[n] = (value & 127) as u8;
            value >>= 7;
            if value != 0 {
                bytes[n] |= 128;
            }
            n += 1;
            if value == 0 {
                break;
            }
        }
        self.raw(&bytes[..n])
    }
    fn count(&mut self, value: usize) -> Wire<()> {
        self.uint(u32::try_from(value).map_err(|_| ALLOCATION)? as u64)
    }
    fn text(&mut self, value: &str) -> Wire<()> {
        self.count(value.len())?;
        self.raw(value.as_bytes())
    }
    fn option<T>(
        &mut self,
        value: Option<T>,
        write: impl FnOnce(&mut Self, T) -> Wire<()>,
    ) -> Wire<()> {
        self.byte(u8::from(value.is_some()))?;
        if let Some(value) = value {
            write(self, value)?;
        }
        Ok(())
    }
    fn point(&mut self, (x, y): (u32, u32)) -> Wire<()> {
        self.uint(x as u64)?;
        self.uint(y as u64)
    }
    fn token(&mut self, t: BuildToken) -> Wire<()> {
        self.uint(t.session)?;
        self.uint(t.revision)?;
        self.uint(t.preparation)
    }
    fn failure(&mut self, (code, detail): Failure) -> Wire<()> {
        self.byte(code)?;
        self.option(detail, Self::uint)
    }
}
fn response(write: impl FnOnce(&mut Writer) -> Wire<()>) -> Vec<u8> {
    let mut out = Writer(Vec::new());
    let result = out.raw(&[1, 0]).and_then(|()| write(&mut out));
    if let Err(failure) = result {
        out.0.clear();
        if out
            .raw(&[1, 1])
            .and_then(|()| out.failure(failure))
            .is_err()
        {
            return vec![1, 1, 3, 0];
        }
    }
    out.0
}
fn unit(result: Result<(), BuildCommitError>) -> Vec<u8> {
    response(|_| result.map_err(error))
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Wire<Self> {
        if bytes.len() > MAX_SAVE_BYTES {
            return Err((14, None));
        }
        let mut r = Self { bytes, at: 0 };
        if r.byte()? != 1 {
            return Err(MALFORMED);
        }
        Ok(r)
    }
    fn byte(&mut self) -> Wire<u8> {
        let value = *self.bytes.get(self.at).ok_or(MALFORMED)?;
        self.at += 1;
        Ok(value)
    }
    fn uint(&mut self, bits: u32) -> Wire<u64> {
        let mut value = 0u64;
        for n in 0..bits.div_ceil(7) {
            let byte = self.byte()?;
            let payload = byte & 127;
            let left = bits - n * 7;
            if left < 7 && u32::from(payload) >= (1 << left) {
                return Err(MALFORMED);
            }
            value |= u64::from(payload) << (n * 7);
            if byte < 128 {
                if n > 0 && payload == 0 {
                    return Err(MALFORMED);
                }
                return Ok(value);
            }
        }
        Err(MALFORMED)
    }
    fn word(&mut self) -> Wire<u32> {
        Ok(self.uint(32)? as u32)
    }
    fn option<T>(&mut self, read: impl FnOnce(&mut Self) -> Wire<T>) -> Wire<Option<T>> {
        match self.byte()? {
            0 => Ok(None),
            1 => Ok(Some(read(self)?)),
            _ => Err(MALFORMED),
        }
    }
    fn count(&mut self, max: usize, min: usize) -> Wire<usize> {
        let n = self.word()? as usize;
        if n > max || n > (self.bytes.len() - self.at) / min {
            return Err(MALFORMED);
        }
        Ok(n)
    }
    fn text(&mut self) -> Wire<String> {
        let len = self.count(MAX_SAVE_BYTES, 1)?;
        let end = self.at.checked_add(len).ok_or(MALFORMED)?;
        let value = std::str::from_utf8(self.bytes.get(self.at..end).ok_or(MALFORMED)?)
            .map_err(|_| MALFORMED)?;
        self.at = end;
        let mut out = String::new();
        out.try_reserve_exact(len).map_err(|_| ALLOCATION)?;
        out.push_str(value);
        Ok(out)
    }
    fn point(&mut self) -> Wire<(u32, u32)> {
        Ok((self.word()?, self.word()?))
    }
    fn token(&mut self) -> Wire<BuildToken> {
        Ok(BuildToken {
            session: self.uint(64)?,
            revision: self.uint(64)?,
            preparation: self.uint(64)?,
        })
    }
    fn done(self) -> Wire<()> {
        if self.at == self.bytes.len() {
            Ok(())
        } else {
            Err(MALFORMED)
        }
    }
}
fn choices(bytes: &[u8], sim: &Sim) -> Wire<(Option<BuildToken>, RoomChoices)> {
    let mut r = Reader::new(bytes)?;
    let token = r.option(Reader::token)?;
    let grid = sim.world().resource::<TileGrid>();
    let bound = grid
        .width()
        .checked_mul(grid.height())
        .ok_or(MALFORMED)?
        .min(MAX_ROOM_RECORDS);
    let mut choices = RoomChoices::default();
    for _ in 0..r.count(bound, 3)? {
        let anchor = r.point()?;
        let id = r.option(|r| RoomId::new(r.word()?).ok_or(MALFORMED))?;
        if choices.inheritance.insert(anchor, id).is_some() {
            return Err(MALFORMED);
        }
    }
    for _ in 0..r.count(bound, 3)? {
        let anchor = r.point()?;
        let name = r.text()?;
        if choices.names.insert(anchor, name).is_some() {
            return Err(MALFORMED);
        }
    }
    choices.outside_name = r.option(Reader::text)?;
    r.done()?;
    if token.is_none()
        && (!choices.inheritance.is_empty()
            || !choices.names.is_empty()
            || choices.outside_name.is_some())
    {
        return Err(MALFORMED);
    }
    Ok((token, choices))
}
fn key(w: &mut Writer, key: terri_core::chores::ChoreKey) -> Wire<()> {
    use terri_core::chores::ChoreKind::*;
    w.byte(match key.kind {
        Dishes => 0,
        Floors => 1,
        Surfaces => 2,
        Bins => 3,
        CounterSurfaces => 4,
        TableSurfaces => 5,
    })?;
    w.uint(key.target as u64)
}
fn write_review(w: &mut Writer, review: &BuildReview) -> Wire<()> {
    w.token(review.token)?;
    w.count(review.groups.len())?;
    for group in &review.groups {
        use terri_sim::rooms::RoomChangeKind::*;
        w.byte(match group.change.kind {
            Split => 0,
            Merge => 1,
            Repartition => 2,
            LostEnclosure => 3,
        })?;
        w.count(group.change.old_ids.len())?;
        for id in &group.change.old_ids {
            w.uint(id.get() as u64)?;
        }
        w.count(group.change.final_anchors.len())?;
        for anchor in &group.change.final_anchors {
            w.point(*anchor)?;
        }
        w.count(group.former_tiles.len())?;
        for tile in &group.former_tiles {
            w.point(*tile)?;
        }
        w.count(group.openings.len())?;
        for line in &group.openings {
            w.byte(line.axis.code())?;
            w.point((line.x, line.y))?;
        }
    }
    w.count(review.rooms.len())?;
    for room in &review.rooms {
        w.uint(room.selection.key() as u64)?;
        w.option(room.anchor, Writer::point)?;
        w.text(&room.name)?;
        w.option(room.previous_name.as_deref(), |w, name| w.text(name))?;
        w.uint(room.previous_area as u64)?;
        w.uint(room.area as u64)?;
    }
    w.count(review.retired_names.len())?;
    for (id, name) in &review.retired_names {
        w.uint(id.get() as u64)?;
        w.text(name)?;
    }
    w.count(review.duties.duties.len())?;
    for duty in &review.duties.duties {
        key(w, duty.key)?;
        w.option(duty.previous, key)?;
        w.option(duty.owner, |w, id| w.uint(id as u64))?;
        use terri_sim::chores::DutyChangeKind::*;
        w.byte(match duty.kind {
            Unchanged => 0,
            Reassigned => 1,
            Automatic => 2,
            Unassigned => 3,
            Retired => 4,
        })?;
    }
    for people in [
        &review.duties.replanned_people,
        &review.duties.unavailable_people,
    ] {
        w.count(people.len())?;
        for person in people {
            w.uint(*person as u64)?;
        }
    }
    Ok(())
}
fn encode_review(review: &BuildReview) -> Result<Vec<u8>, BuildCommitError> {
    let mut writer = Writer(Vec::new());
    writer
        .raw(&[1, 0])
        .and_then(|()| write_review(&mut writer, review))
        .map_err(|_| BuildCommitError::AllocationFailed)?;
    Ok(writer.0)
}
#[cfg(test)]
pub(super) fn review_response(review: Result<BuildReview, BuildCommitError>) -> Vec<u8> {
    response(|writer| write_review(writer, &review.map_err(error)?))
}
fn token(session: u64, revision: u64, preparation: u64) -> BuildToken {
    BuildToken {
        session,
        revision,
        preparation,
    }
}
fn failure_report(problem: Option<ValidationProblem>) -> String {
    let rule = match problem {
        None => return r#"{"rule":null}"#.to_owned(),
        Some(ValidationProblem::LotUsability(refusal)) => {
            return format!(r#"{{"rule":"lot_usability","refusal":{}}}"#, refusal as u32)
        }
        Some(ValidationProblem::EdgeWorld) => "edge_world",
        Some(ValidationProblem::PortalReturn) => "portal_return",
        Some(ValidationProblem::Seating) => "seating",
        Some(ValidationProblem::Reading) => "reading",
    };
    format!(r#"{{"rule":"{rule}"}}"#)
}
fn anchor(x: f64, y: f64) -> Wire<(u32, u32)> {
    placement_u32(x).zip(placement_u32(y)).ok_or(MALFORMED)
}

#[wasm_bindgen]
impl SimHandle {
    pub fn build_active(&self) -> bool {
        self.sim.build_active()
    }
    pub fn rooms_revision(&self) -> u64 {
        self.sim.rooms_revision()
    }
    pub fn begin_build(&mut self) -> Vec<u8> {
        unit(self.sim.begin_build())
    }
    pub fn cancel_build(&mut self) -> Vec<u8> {
        unit(self.sim.cancel_build())
    }
    pub fn end_build(&mut self) -> Vec<u8> {
        unit(self.sim.end_build())
    }
    pub fn discard_build_review(&mut self) -> Vec<u8> {
        unit(self.sim.discard_build_review())
    }
    /// The rule behind the latest refused Build entry or preparation, as JSON
    /// for the console and the status line: `{"rule":null}` when it is not
    /// one the simulation can name, else the rule and, for lot usability,
    /// the refusal's stable code.
    pub fn build_failure_report(&self) -> String {
        failure_report(self.sim.build_diagnosis())
    }
    pub fn take_build_error(&mut self) -> Vec<u8> {
        let failure = self.sim.take_build_error().map(error);
        response(|w| w.option(failure, Writer::failure))
    }
    pub fn stage_room_name(&mut self, bytes: &[u8]) -> Vec<u8> {
        response(|_| {
            let mut r = Reader::new(bytes)?;
            let selection = RoomSelection::from_key(r.word()?);
            let name = r.text()?;
            r.done()?;
            self.sim.stage_room_name(selection, name).map_err(error)
        })
    }
    pub fn prepare_build_commit(&mut self, bytes: &[u8]) -> Vec<u8> {
        let parsed = choices(bytes, &self.sim);
        match parsed {
            Err(e) => response(|_| Err(e)),
            Ok((expected, choices)) => {
                if let Some(expected) = expected {
                    if let Err(e) = self.sim.validate_build_token(expected) {
                        return unit(Err(e));
                    }
                }
                match self
                    .sim
                    .prepare_build_commit_projected(choices, encode_review)
                {
                    Ok(bytes) => bytes,
                    Err(error) => unit(Err(error)),
                }
            }
        }
    }
    pub fn commit_build(&mut self, session: u64, revision: u64, preparation: u64) -> Vec<u8> {
        unit(self.sim.commit_build(token(session, revision, preparation)))
    }
    pub fn room_summaries(&self) -> Vec<u8> {
        response(|w| {
            let map = self
                .sim
                .world()
                .get_resource::<RoomMap>()
                .ok_or((7, Some(7)))?;
            w.uint(map.topology.width as u64)?;
            w.uint(map.topology.height as u64)?;
            if self.sim.build_active() {
                let rows = self.sim.build_rooms().map_err(error)?;
                w.count(rows.len())?;
                for row in rows {
                    w.uint(row.selection.key() as u64)?;
                    w.option(row.anchor, Writer::point)?;
                    w.text(&row.name)?;
                    w.uint(row.area as u64)?;
                }
            } else {
                let saved = self
                    .sim
                    .world()
                    .get_resource::<SavedRooms>()
                    .ok_or((7, Some(8)))?;
                w.count(map.component_ids.len() + 1)?;
                w.uint(0)?;
                w.byte(0)?;
                w.text(&saved.outside_name)?;
                w.count(
                    map.topology
                        .cells
                        .iter()
                        .filter(|cell| **cell == TopologyCell::Outside)
                        .count(),
                )?;
                for (id, component) in map.component_ids.iter().zip(&map.topology.components) {
                    w.uint(id.get() as u64)?;
                    w.option(Some(component.anchor), Writer::point)?;
                    w.text(&saved.record(*id).ok_or((7, Some(8)))?.name)?;
                    w.count(component.cells.len())?;
                }
            }
            Ok(())
        })
    }
    pub fn room_tiles(&self, id: f64) -> Vec<u8> {
        response(|w| {
            let id = placement_u32(id).ok_or(MALFORMED)?;
            let map = self
                .sim
                .world()
                .get_resource::<RoomMap>()
                .ok_or((7, Some(7)))?;
            let cell = if id == 0 {
                TopologyCell::Outside
            } else {
                let index = map
                    .component_ids
                    .iter()
                    .position(|old| old.get() == id)
                    .ok_or((5, None))?;
                TopologyCell::Enclosed(index as u32)
            };
            w.count(
                map.topology
                    .cells
                    .iter()
                    .filter(|value| **value == cell)
                    .count(),
            )?;
            for (index, value) in map.topology.cells.iter().enumerate() {
                if *value == cell {
                    w.point((
                        (index as u32) % map.topology.width,
                        (index as u32) / map.topology.width,
                    ))?;
                }
            }
            Ok(())
        })
    }
    pub fn build_component_tiles(
        &self,
        session: u64,
        revision: u64,
        preparation: u64,
        x: f64,
        y: f64,
    ) -> Vec<u8> {
        response(|w| {
            let anchor = anchor(x, y)?;
            let tiles = self
                .sim
                .build_component_tiles(token(session, revision, preparation), anchor)
                .map_err(error)?;
            w.count(tiles.len())?;
            for tile in tiles {
                w.point(tile)?;
            }
            Ok(())
        })
    }
    pub fn build_component_predecessors(
        &self,
        session: u64,
        revision: u64,
        preparation: u64,
        x: f64,
        y: f64,
    ) -> Vec<u8> {
        response(|w| {
            let anchor = anchor(x, y)?;
            let ids = self
                .sim
                .build_component_predecessors(token(session, revision, preparation), anchor)
                .map_err(error)?;
            w.count(ids.len())?;
            for id in ids {
                w.uint(id.get() as u64)?;
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use terri_sim::placement::PlacementRefusal;
    #[test]
    fn build_failure_report_names_each_rule_as_the_page_reads_it() {
        assert_eq!(
            SimHandle::from_lot().build_failure_report(),
            r#"{"rule":null}"#
        );
        assert_eq!(
            failure_report(Some(ValidationProblem::LotUsability(
                PlacementRefusal::InaccessibleInteraction
            ))),
            r#"{"rule":"lot_usability","refusal":11}"#
        );
        for (problem, rule) in [
            (ValidationProblem::EdgeWorld, "edge_world"),
            (ValidationProblem::PortalReturn, "portal_return"),
            (ValidationProblem::Seating, "seating"),
            (ValidationProblem::Reading, "reading"),
        ] {
            assert_eq!(
                failure_report(Some(problem)),
                format!(r#"{{"rule":"{rule}"}}"#)
            );
        }
    }
    #[test]
    fn room_transport_chore_tags_are_not_preference_indices() {
        let mut writer = Writer(Vec::new());
        for kind in terri_core::chores::ChoreKind::ALL {
            key(
                &mut writer,
                terri_core::chores::ChoreKey { kind, target: 0 },
            )
            .unwrap();
        }
        assert_eq!(writer.0, [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0]);
    }
    #[test]
    fn room_transport_group_and_duty_tags_are_explicit() {
        use terri_sim::{
            build_transaction::BuildGroupReview,
            chores::{DutyChange, DutyChangeKind::*},
            rooms::{RoomChangeGroup, RoomChangeKind::*},
        };
        let mut review = BuildReview {
            token: BuildToken {
                session: 1,
                revision: 2,
                preparation: 3,
            },
            groups: vec![],
            rooms: vec![],
            retired_names: vec![],
            duties: Default::default(),
        };
        for kind in [Split, Merge, Repartition, LostEnclosure] {
            review.groups.push(BuildGroupReview {
                change: RoomChangeGroup {
                    kind,
                    old_ids: vec![],
                    final_anchors: vec![],
                },
                former_tiles: vec![],
                openings: vec![],
            });
        }
        for kind in [Unchanged, Reassigned, Automatic, Unassigned, Retired] {
            review.duties.duties.push(DutyChange {
                key: terri_core::chores::ChoreKey {
                    kind: terri_core::chores::ChoreKind::Dishes,
                    target: 0,
                },
                previous: None,
                owner: Some(0),
                kind,
            });
        }
        assert_eq!(
            review_response(Ok(review)),
            [
                1, 0, 1, 2, 3, 4, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0,
                5, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 0, 1, 0, 3, 0, 0, 0,
                1, 0, 4, 0, 0,
            ]
        );
    }
}
