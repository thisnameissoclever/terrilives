use super::*;
use crate::placement::{self, LotEditState};
use terri_core::{command::BookCommand, CommandQueue, SimCommand};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BuildReceipt {
    Move(placement::PlacementResult),
    Wall(placement::walls::WallEditResult),
    Window(placement::windows::WindowEditResult),
    Floor(placement::floors::FloorEditResult),
    Purchase(placement::purchase::PurchaseResult),
    Sale(placement::sale::SaleResult),
    Colourway(placement::colourway::ColourwayResult),
    Room(placement::rooms::RoomEditResult),
    Land(crate::land::LandResult),
    Book {
        copy: Option<u32>,
        order: Option<u64>,
        refusal: Option<&'static str>,
    },
}
impl BuildReceipt {
    pub(super) fn accepted(&self) -> bool {
        match self {
            Self::Move(r) => r.reason.is_none(),
            Self::Wall(r) => r.reason.is_none(),
            Self::Window(r) => r.reason.is_none(),
            Self::Floor(r) => r.reason.is_none(),
            Self::Purchase(r) => r.reason.is_none(),
            Self::Sale(r) => r.reason.is_none(),
            Self::Colourway(r) => r.reason.is_none(),
            Self::Room(r) => r.reason.is_none(),
            Self::Land(r) => r.reason.is_none(),
            Self::Book { refusal, .. } => refusal.is_none(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BuildJournalEntry {
    pub command: SimCommand,
    pub expected: BuildReceipt,
    /// Inventory settles after the last accepted action of the original drain.
    pub settle_inventory: bool,
}

/// Pure refusals need no household reconstruction. Admitted actions still use
/// the complete private transaction, including active reading previews.
pub(super) fn certainly_refused(world: &World, command: &SimCommand) -> bool {
    match command {
        SimCommand::PlaceObject {
            object,
            x,
            y,
            facing,
        } => {
            if crate::dining::entity(world, *object)
                .is_some_and(|entity| crate::reading::placement::affects(world, entity))
            {
                return false;
            }
            placement::validate_placement(world, *object, (*x, *y), *facing).is_err()
        }
        SimCommand::SetWallEdge { axis, x, y, state } => placement::walls::validate_wall_edit(
            world,
            placement::walls::WallEdit {
                axis: *axis,
                x: *x,
                y: *y,
                state: *state,
            },
        )
        .is_err(),
        SimCommand::FitWindow { axis, x, y, model } => placement::windows::validate_window_edit(
            world,
            placement::windows::WindowEdit::Fit(terri_core::windows::WindowPlacement {
                line: WallLine {
                    axis: *axis,
                    x: *x,
                    y: *y,
                },
                model: *model,
            }),
        )
        .is_err(),
        SimCommand::RemoveWindow { axis, x, y } => placement::windows::validate_window_edit(
            world,
            placement::windows::WindowEdit::Remove(WallLine {
                axis: *axis,
                x: *x,
                y: *y,
            }),
        )
        .is_err(),
        SimCommand::SetFloor { x, y, covering } => placement::floors::validate_floor_edit(
            world,
            placement::floors::FloorEdit {
                x: *x,
                y: *y,
                covering: *covering,
            },
        )
        .is_err(),
        SimCommand::BuyObject {
            definition,
            x,
            y,
            facing,
        }
        | SimCommand::BuyObjectInColourway {
            definition,
            x,
            y,
            facing,
            ..
        } => {
            placement::purchase::validate_purchase(
                world,
                placement::purchase::Purchase {
                    definition: *definition,
                    x: *x,
                    y: *y,
                    facing: *facing,
                },
            )
            .is_err()
                || matches!(command,SimCommand::BuyObjectInColourway { colourway,.. } if *colourway as usize>=world.resource::<Content>().0.colourways.len())
        }
        SimCommand::SellObject { object } => {
            placement::sale::validate_sale(world, *object).is_err()
        }
        SimCommand::SetColourway { object, colourway } => {
            placement::colourway::validate_colourway(world, *object, *colourway).is_err()
        }
        SimCommand::BuildRoom {
            x0,
            y0,
            x1,
            y1,
            doorway,
        } => placement::rooms::validate_room(
            world,
            placement::rooms::RoomEdit {
                x0: *x0,
                y0: *y0,
                x1: *x1,
                y1: *y1,
                doorway: *doorway,
            },
        )
        .is_err(),
        SimCommand::BuyLand { side } => crate::land::Side::from_index(*side)
            .is_none_or(|side| crate::land::validate(world, side).is_err()),
        _ => false,
    }
}

pub(super) fn apply(world: &mut World, command: &SimCommand) -> Option<BuildReceipt> {
    let receipt = match command {
        SimCommand::PlaceObject {
            object,
            x,
            y,
            facing,
        } => {
            placement::commit(world, *object, (*x, *y), *facing);
            BuildReceipt::Move(world.resource::<LotEditState>().last_result.unwrap())
        }
        SimCommand::SetWallEdge { axis, x, y, state } => {
            placement::walls::commit(
                world,
                placement::walls::WallEdit {
                    axis: *axis,
                    x: *x,
                    y: *y,
                    state: *state,
                },
            );
            BuildReceipt::Wall(world.resource::<LotEditState>().last_wall_result.unwrap())
        }
        SimCommand::FitWindow { axis, x, y, model } => {
            BuildReceipt::Window(placement::windows::apply_window_edit(
                world,
                placement::windows::WindowEdit::Fit(terri_core::windows::WindowPlacement {
                    line: WallLine {
                        axis: *axis,
                        x: *x,
                        y: *y,
                    },
                    model: *model,
                }),
            ))
        }
        SimCommand::RemoveWindow { axis, x, y } => {
            BuildReceipt::Window(placement::windows::apply_window_edit(
                world,
                placement::windows::WindowEdit::Remove(WallLine {
                    axis: *axis,
                    x: *x,
                    y: *y,
                }),
            ))
        }
        SimCommand::SetFloor { x, y, covering } => {
            placement::floors::commit(
                world,
                placement::floors::FloorEdit {
                    x: *x,
                    y: *y,
                    covering: *covering,
                },
            );
            BuildReceipt::Floor(world.resource::<LotEditState>().last_floor_result.unwrap())
        }
        SimCommand::BuyObject {
            definition,
            x,
            y,
            facing,
        }
        | SimCommand::BuyObjectInColourway {
            definition,
            x,
            y,
            facing,
            ..
        } => {
            let purchase = placement::purchase::Purchase {
                definition: *definition,
                x: *x,
                y: *y,
                facing: *facing,
            };
            if let SimCommand::BuyObjectInColourway { colourway, .. } = command {
                placement::purchase::commit_in_colourway(world, purchase, *colourway);
            } else {
                placement::purchase::commit(world, purchase);
            }
            BuildReceipt::Purchase(
                world
                    .resource::<LotEditState>()
                    .last_purchase_result
                    .unwrap(),
            )
        }
        SimCommand::SellObject { object } => {
            placement::sale::commit(world, *object);
            BuildReceipt::Sale(world.resource::<LotEditState>().last_sale_result.unwrap())
        }
        SimCommand::SetColourway { object, colourway } => {
            placement::colourway::commit(world, *object, *colourway);
            BuildReceipt::Colourway(
                world
                    .resource::<LotEditState>()
                    .last_colourway_result
                    .unwrap(),
            )
        }
        SimCommand::BuildRoom {
            x0,
            y0,
            x1,
            y1,
            doorway,
        } => {
            placement::rooms::commit(
                world,
                placement::rooms::RoomEdit {
                    x0: *x0,
                    y0: *y0,
                    x1: *x1,
                    y1: *y1,
                    doorway: *doorway,
                },
            );
            BuildReceipt::Room(world.resource::<LotEditState>().last_room_result.unwrap())
        }
        SimCommand::BuyLand { side } => {
            crate::land::commit(world, *side);
            BuildReceipt::Land(world.resource::<LotEditState>().last_land_result.unwrap())
        }
        SimCommand::Book(book) if !matches!(book, BookCommand::Read { .. }) => {
            crate::books::commit(world, book.clone());
            let result = world
                .resource::<crate::books::BookFeedback>()
                .results
                .last()
                .unwrap();
            // Sequence is a transient feedback counter, never persisted or replayed.
            BuildReceipt::Book {
                copy: result.copy,
                order: result.order,
                refusal: result.refusal,
            }
        }
        _ => return None,
    };
    Some(receipt)
}

pub(crate) fn drain(world: &mut World) {
    drain_reserving(world, |journal| {
        journal
            .try_reserve(1)
            .map_err(|_| BuildCommitError::AllocationFailed)
    });
}

pub(super) fn drain_reserving(
    world: &mut World,
    mut reserve: impl FnMut(&mut Vec<BuildJournalEntry>) -> Result<(), BuildCommitError>,
) {
    let issued: Vec<_> = world.resource_mut::<CommandQueue>().drain().collect();
    let mut last_accepted = None;
    for command in issued {
        let next = match next_epoch(world) {
            Ok(next) => next,
            Err(_) => {
                settlement_failed(world, BuildCommitError::CounterExhausted);
                continue;
            }
        };
        let reservation = {
            let mut build = world.resource_mut::<BuildTransaction>();
            if build.revision == u64::MAX {
                Err(BuildCommitError::CounterExhausted)
            } else {
                reserve(&mut build.journal)
            }
        };
        if let Err(error) = reservation {
            settlement_failed(world, error);
            continue;
        }
        match apply(world, &command) {
            Some(expected) if expected.accepted() => {
                let mut build = world.resource_mut::<BuildTransaction>();
                build
                    .invalidate()
                    .expect("revision capacity reserved before edit");
                last_accepted = Some(build.journal.len());
                build.journal.push(BuildJournalEntry {
                    command,
                    expected,
                    settle_inventory: false,
                });
                world.insert_resource(BuildEpoch(next));
            }
            Some(_) => {}
            None => {
                let mut build = world.resource_mut::<BuildTransaction>();
                if build.last_error.is_none() {
                    build.last_error = Some(BuildCommitError::CommandNotAllowed);
                }
            }
        }
    }
    if let Some(index) = last_accepted {
        crate::books::shelve_arrivals(world);
        world.resource_mut::<BuildTransaction>().journal[index].settle_inventory = true;
    }
}

fn settlement_failed(world: &mut World, error: BuildCommitError) {
    let mut build = world.resource_mut::<BuildTransaction>();
    build.prepared = None;
    build.last_error = Some(error);
}
