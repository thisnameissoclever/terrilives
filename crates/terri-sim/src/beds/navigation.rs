use super::Admission;
use terri_core::{Footprint, TileDistanceField, TileGrid};
use terri_data::{CompiledObject, Facing};

#[derive(Debug, Clone, Copy)]
pub(crate) enum Route {
    Perimeter {
        origin: (i32, i32),
        footprint: Footprint,
    },
    Exact((i32, i32)),
}

impl Route {
    pub(crate) fn path(self, grid: &TileGrid, from: (i32, i32)) -> Option<Vec<(i32, i32)>> {
        match self {
            Self::Perimeter { origin, footprint } => {
                grid.find_path_adjacent(from, origin, footprint)
            }
            Self::Exact(tile) => grid.find_path(from, tile),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct Reachable {
    pub route: Route,
    pub distance: u32,
}

/// Reachability is independent of ownership: an occupied reachable place can be waited for.
pub(crate) struct Access {
    perimeter: Option<Reachable>,
    places: Vec<Option<Reachable>>,
    seats: Vec<Option<Reachable>>,
}

impl Access {
    pub(crate) fn new(
        object: &CompiledObject,
        sleep_tag: &str,
        facing: Facing,
        origin: (i32, i32),
        field: &TileDistanceField,
    ) -> Self {
        let footprint = object.footprint_at(facing);
        let perimeter = field
            .distance_to_adjacent(origin, footprint)
            .map(|distance| Reachable {
                route: Route::Perimeter { origin, footprint },
                distance,
            });
        let capacity = object.sleep_capacity(sleep_tag);
        let places = (0..capacity)
            .map(|ordinal| {
                let Some(approaches) = object.sleep_approaches_at(ordinal, facing) else {
                    return (capacity == 1 && object.sleep_places.is_empty())
                        .then_some(perimeter)
                        .flatten();
                };
                approaches
                    .into_iter()
                    .filter_map(|(x, y)| {
                        let approach = (origin.0 + x, origin.1 + y);
                        let contact = (
                            origin.0 + x.clamp(0, footprint.width as i32 - 1),
                            origin.1 + y.clamp(0, footprint.depth as i32 - 1),
                        );
                        field
                            .distance_to_contact(approach, contact)
                            .map(|distance| (distance, approach))
                    })
                    .min()
                    .map(|(distance, tile)| Reachable {
                        route: Route::Exact(tile),
                        distance,
                    })
            })
            .collect();
        let seats = (0..object.seats.len())
            .map(|ordinal| {
                object
                    .seat_approaches_at(ordinal, facing)?
                    .into_iter()
                    .filter_map(|(x, y)| {
                        let approach = (origin.0 + x, origin.1 + y);
                        let contact = (
                            origin.0 + x.clamp(0, footprint.width as i32 - 1),
                            origin.1 + y.clamp(0, footprint.depth as i32 - 1),
                        );
                        field
                            .distance_to_contact(approach, contact)
                            .map(|distance| (distance, approach))
                    })
                    .min()
                    .map(|(distance, tile)| Reachable {
                        route: Route::Exact(tile),
                        distance,
                    })
            })
            .collect();
        Self {
            perimeter,
            places,
            seats,
        }
    }

    pub(crate) fn for_admission(&self, admission: Admission) -> Option<Reachable> {
        match admission {
            Admission::Exclusive => self.perimeter,
            Admission::Seat { all: true, .. } => self.perimeter,
            Admission::Seat {
                ordinal,
                all: false,
            } => self.seats.get(ordinal as usize).copied().flatten(),
            Admission::Sleep { ordinal, .. } => {
                self.places.get(ordinal as usize).copied().flatten()
            }
        }
    }

    pub(crate) fn nearest(&self, sleep: bool) -> Option<Reachable> {
        if sleep {
            self.places
                .iter()
                .flatten()
                .copied()
                .min_by_key(|access| access.distance)
        } else {
            self.perimeter
        }
    }
}
