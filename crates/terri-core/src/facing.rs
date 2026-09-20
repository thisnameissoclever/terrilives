//! Stable quarter-turn codes and coordinate transforms.

use serde::{Deserialize, Serialize};

/// One of the four isometric facings every piece of furniture is rendered at.
///
/// **The variant order is the quarter-turn order and it is wire format.**
/// Each step is one quarter turn clockwise as the player sees the lot, so
/// [`Facing::turned`] is "the next variant". The code a save file and the
/// world hash carry is the variant's position, so inserting a variant
/// anywhere, or reordering two, changes what every saved facing means.
/// `facing_codes_are_pinned` is what makes that change loud.
///
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum Facing {
    #[default]
    SouthEast,
    SouthWest,
    NorthWest,
    NorthEast,
}

impl Facing {
    /// Every facing, in quarter-turn order, which is also code order.
    pub const ALL: [Self; 4] = [
        Self::SouthEast,
        Self::SouthWest,
        Self::NorthWest,
        Self::NorthEast,
    ];

    /// The wire code: this facing's position in [`Facing::ALL`].
    pub fn code(self) -> u8 {
        match self {
            Self::SouthEast => 0,
            Self::SouthWest => 1,
            Self::NorthWest => 2,
            Self::NorthEast => 3,
        }
    }

    /// The facing a wire code names, or `None` for a code past the last
    /// facing. A save file is hostile input, so this is a checked
    /// conversion rather than an index.
    pub fn from_code(code: u8) -> Option<Self> {
        Self::ALL.get(code as usize).copied()
    }

    /// The authored content spelling, which is also the atlas suffix of a
    /// directional sprite variant.
    pub fn suffix(self) -> &'static str {
        match self {
            Self::SouthEast => "SE",
            Self::SouthWest => "SW",
            Self::NorthWest => "NW",
            Self::NorthEast => "NE",
        }
    }

    /// The facing an authored content string names, or `None` for anything
    /// else. The compile step reports the `None` with the object named.
    pub fn from_suffix(suffix: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|facing| facing.suffix() == suffix)
    }

    /// One quarter turn clockwise as the player sees the lot.
    pub fn turned(self) -> Self {
        match self {
            Self::SouthEast => Self::SouthWest,
            Self::SouthWest => Self::NorthWest,
            Self::NorthWest => Self::NorthEast,
            Self::NorthEast => Self::SouthEast,
        }
    }

    /// Whether this facing lays an object's width along the lot's y axis.
    ///
    /// South-east and north-west keep the authored rectangle; the two
    /// facings between them exchange its sides. See `Footprint::oriented`.
    pub fn swaps_footprint_sides(self) -> bool {
        matches!(self, Self::SouthWest | Self::NorthEast)
    }

    /// Rotates an object-local offset, authored for the south-east facing,
    /// into lot axes for this facing.
    ///
    /// One quarter turn takes local `+x` to lot `+y`, so an offset `(x, y)`
    /// becomes `(-y, x)`; the other facings are that step repeated.
    pub fn rotate_offset(self, x: f32, y: f32) -> (f32, f32) {
        match self {
            Self::SouthEast => (x, y),
            Self::SouthWest => (-y, x),
            Self::NorthWest => (-x, -y),
            Self::NorthEast => (y, -x),
        }
    }

    /// [`Facing::rotate_offset`] for a whole-number axis, such as the unit
    /// direction an action socket faces.
    pub fn rotate_axis(self, x: i32, y: i32) -> (i32, i32) {
        match self {
            Self::SouthEast => (x, y),
            Self::SouthWest => (-y, x),
            Self::NorthWest => (-x, -y),
            Self::NorthEast => (y, -x),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The code is what a save file and the world hash carry, so it is
    /// pinned as a golden list rather than derived from the enum.
    #[test]
    fn facing_codes_are_pinned() {
        let codes: Vec<(Facing, u8)> = Facing::ALL.into_iter().map(|f| (f, f.code())).collect();
        assert_eq!(
            codes,
            vec![
                (Facing::SouthEast, 0),
                (Facing::SouthWest, 1),
                (Facing::NorthWest, 2),
                (Facing::NorthEast, 3),
            ]
        );
        // The bytes postcard writes for a facing are its variant index,
        // which must stay the same number as the code.
        for facing in Facing::ALL {
            assert_eq!(
                postcard::to_allocvec(&facing).expect("a facing serialises"),
                vec![facing.code()]
            );
        }
    }

    #[test]
    fn a_code_round_trips_and_a_code_past_the_last_facing_is_refused() {
        for facing in Facing::ALL {
            assert_eq!(Facing::from_code(facing.code()), Some(facing));
        }
        assert_eq!(Facing::from_code(4), None);
        assert_eq!(Facing::from_code(u8::MAX), None);
    }

    #[test]
    fn suffixes_are_the_authored_spellings_and_round_trip() {
        let spelled: Vec<&str> = Facing::ALL.into_iter().map(Facing::suffix).collect();
        assert_eq!(spelled, vec!["SE", "SW", "NW", "NE"]);
        for facing in Facing::ALL {
            assert_eq!(Facing::from_suffix(facing.suffix()), Some(facing));
        }
        assert_eq!(Facing::from_suffix("se"), None);
        assert_eq!(Facing::from_suffix(""), None);
        assert_eq!(Facing::from_suffix("S"), None);
    }

    /// Four turns visit all four facings and return to the start. Asserted
    /// as the exact sequence, because "returns after four" alone is also
    /// true of a `turned` that never moves.
    #[test]
    fn four_quarter_turns_visit_every_facing_in_order_and_return() {
        let mut facing = Facing::SouthEast;
        let mut visited = Vec::new();
        for _ in 0..5 {
            visited.push(facing);
            facing = facing.turned();
        }
        assert_eq!(
            visited,
            vec![
                Facing::SouthEast,
                Facing::SouthWest,
                Facing::NorthWest,
                Facing::NorthEast,
                Facing::SouthEast,
            ]
        );
    }

    #[test]
    fn only_the_two_side_facings_swap_a_footprint() {
        let swaps: Vec<bool> = Facing::ALL
            .into_iter()
            .map(Facing::swaps_footprint_sides)
            .collect();
        assert_eq!(swaps, vec![false, true, false, true]);
    }

    /// An asymmetric offset, so a transposition, a dropped sign and an
    /// identity each give a different wrong answer ([L34]).
    #[test]
    fn an_offset_rotates_a_quarter_turn_per_facing_step() {
        let rotated: Vec<(f32, f32)> = Facing::ALL
            .into_iter()
            .map(|facing| facing.rotate_offset(0.25, -0.5))
            .collect();
        assert_eq!(
            rotated,
            vec![(0.25, -0.5), (0.5, 0.25), (-0.25, 0.5), (-0.5, -0.25)]
        );
    }

    #[test]
    fn an_axis_rotates_exactly_as_an_offset_does() {
        for facing in Facing::ALL {
            for (x, y) in [(1, 0), (0, 1), (-1, 0), (0, -1), (2, -3)] {
                let (fx, fy) = facing.rotate_offset(x as f32, y as f32);
                assert_eq!(
                    facing.rotate_axis(x, y),
                    (fx as i32, fy as i32),
                    "{facing:?} rotates ({x}, {y}) differently as an axis and as an offset"
                );
            }
        }
        // A golden row as well, so the pair cannot be wrong together.
        assert_eq!(Facing::SouthWest.rotate_axis(1, 0), (0, 1));
        assert_eq!(Facing::NorthEast.rotate_axis(1, 0), (0, -1));
    }
}
