//! Stable window models and their canonical wall spans.

use crate::layout::{EdgeAxis, WallLine};
use serde::{Deserialize, Deserializer, Serialize};

/// Variant order is the stored order; public IDs start at one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WindowModel {
    Sash,
    Cottage,
    Arched,
    Sliding,
    SteelGrid,
    TwinCasement,
    Picture,
    Craftsman,
    Clerestory,
}

impl WindowModel {
    pub const fn id(self) -> u8 {
        match self {
            Self::Sash => 1,
            Self::Cottage => 2,
            Self::Arched => 3,
            Self::Sliding => 4,
            Self::SteelGrid => 5,
            Self::TwinCasement => 6,
            Self::Picture => 7,
            Self::Craftsman => 8,
            Self::Clerestory => 9,
        }
    }

    pub const fn from_id(id: u8) -> Option<Self> {
        match id {
            1 => Some(Self::Sash),
            2 => Some(Self::Cottage),
            3 => Some(Self::Arched),
            4 => Some(Self::Sliding),
            5 => Some(Self::SteelGrid),
            6 => Some(Self::TwinCasement),
            7 => Some(Self::Picture),
            8 => Some(Self::Craftsman),
            9 => Some(Self::Clerestory),
            _ => None,
        }
    }

    pub const fn width(self) -> u32 {
        match self {
            Self::Sash | Self::Cottage | Self::Arched => 1,
            Self::Sliding | Self::SteelGrid | Self::TwinCasement => 2,
            Self::Picture | Self::Craftsman | Self::Clerestory => 3,
        }
    }
}

/// One window, starting at `line` and extending along its axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WindowPlacement {
    pub line: WallLine,
    pub model: WindowModel,
}

impl WindowPlacement {
    /// Every segment, or `None` if the last coordinate cannot be represented.
    /// Untrusted edit and load boundaries must check this before expansion.
    pub fn checked_lines(self) -> Option<Vec<WallLine>> {
        let offset = self.model.width() - 1;
        match self.line.axis {
            EdgeAxis::Vertical => {
                let end = self.line.y.checked_add(offset)?;
                Some(
                    (self.line.y..=end)
                        .map(|y| WallLine { y, ..self.line })
                        .collect(),
                )
            }
            EdgeAxis::Horizontal => {
                let end = self.line.x.checked_add(offset)?;
                Some(
                    (self.line.x..=end)
                        .map(|x| WallLine { x, ..self.line })
                        .collect(),
                )
            }
        }
    }

    /// Every segment of a representable span. Decoding enforces this invariant.
    ///
    /// # Panics
    /// Panics for an overflowing placement constructed directly in Rust.
    /// Call `checked_lines` first when coordinates have not been validated.
    pub fn lines(self) -> Vec<WallLine> {
        self.checked_lines()
            .expect("window span must be validated before expansion")
    }
}

impl<'de> Deserialize<'de> for WindowPlacement {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Record {
            line: WallLine,
            model: WindowModel,
        }
        let record = Record::deserialize(deserializer)?;
        let placement = Self {
            line: record.line,
            model: record.model,
        };
        if placement.checked_lines().is_none() {
            return Err(serde::de::Error::custom(
                "window span overflows its wall coordinate",
            ));
        }
        Ok(placement)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{EdgeAxis, WallLine};

    const MODELS: [WindowModel; 9] = [
        WindowModel::Sash,
        WindowModel::Cottage,
        WindowModel::Arched,
        WindowModel::Sliding,
        WindowModel::SteelGrid,
        WindowModel::TwinCasement,
        WindowModel::Picture,
        WindowModel::Craftsman,
        WindowModel::Clerestory,
    ];

    #[test]
    fn window_model_ids_widths_and_stored_tags_are_pinned() {
        for (index, model) in MODELS.into_iter().enumerate() {
            assert_eq!(model.id(), index as u8 + 1);
            assert_eq!(WindowModel::from_id(index as u8 + 1), Some(model));
            assert_eq!(model.width(), [1, 1, 1, 2, 2, 2, 3, 3, 3][index]);
            assert_eq!(postcard::to_allocvec(&model).unwrap(), [index as u8]);
        }
        for id in [0, 10, u8::MAX] {
            assert_eq!(WindowModel::from_id(id), None);
        }
        assert!(postcard::from_bytes::<WindowModel>(&[9]).is_err());
    }

    #[test]
    fn every_model_expands_along_its_axis_with_one_owner() {
        for model in MODELS {
            for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
                let placed = WindowPlacement {
                    line: WallLine { axis, x: 4, y: 3 },
                    model,
                };
                let expected: Vec<_> = (0..model.width())
                    .map(|offset| WallLine {
                        axis,
                        x: 4 + if axis == EdgeAxis::Horizontal {
                            offset
                        } else {
                            0
                        },
                        y: 3 + if axis == EdgeAxis::Vertical {
                            offset
                        } else {
                            0
                        },
                    })
                    .collect();
                assert_eq!(placed.lines(), expected);
                assert_eq!(placed.checked_lines(), Some(expected.clone()));
                let layout =
                    crate::layout::SavedLayout::from_window_placements(Vec::new(), vec![placed]);
                assert_eq!(layout.window_placements(), [placed]);
                assert_eq!(layout.window_lines(), expected);
                assert!(layout.windows().is_empty(), "V3 does not expose V2 records");
                assert!(layout.has_edges());
                for line in expected {
                    assert_eq!(layout.window_at(line), Some(placed));
                    assert_eq!(layout.state_of(line), crate::layout::WallState::Window);
                }
                assert_eq!(layout.window_at(WallLine { axis, x: 20, y: 20 }), None);
                let other_axis = if axis == EdgeAxis::Vertical {
                    EdgeAxis::Horizontal
                } else {
                    EdgeAxis::Vertical
                };
                assert_eq!(
                    layout.window_at(WallLine {
                        axis: other_axis,
                        ..placed.line
                    }),
                    None
                );
            }
        }
    }

    #[test]
    fn checked_span_rejects_overflow_and_deserialization_never_panics() {
        for model in MODELS {
            for axis in [EdgeAxis::Vertical, EdgeAxis::Horizontal] {
                let start = u32::MAX - (model.width() - 1);
                let valid = WindowPlacement {
                    line: WallLine {
                        axis,
                        x: start,
                        y: start,
                    },
                    model,
                };
                let lines = valid
                    .checked_lines()
                    .expect("the last segment is representable");
                assert_eq!(lines.len(), model.width() as usize);
                let last = lines.last().unwrap();
                assert_eq!(
                    if axis == EdgeAxis::Vertical {
                        last.y
                    } else {
                        last.x
                    },
                    u32::MAX
                );
                let bytes = postcard::to_allocvec(&valid).unwrap();
                assert_eq!(
                    postcard::from_bytes::<WindowPlacement>(&bytes).unwrap(),
                    valid
                );
                if model.width() > 1 {
                    let invalid = WindowPlacement {
                        line: WallLine {
                            axis,
                            x: start + 1,
                            y: start + 1,
                        },
                        model,
                    };
                    assert_eq!(invalid.checked_lines(), None);
                    let bytes = postcard::to_allocvec(&invalid).unwrap();
                    let result = std::panic::catch_unwind(|| {
                        postcard::from_bytes::<WindowPlacement>(&bytes)
                    });
                    assert!(result
                        .expect("malformed saved span must not panic")
                        .is_err());
                }
            }
        }
    }

    #[test]
    fn placement_requires_every_field_and_known_model() {
        let placed = WindowPlacement {
            line: WallLine {
                axis: EdgeAxis::Horizontal,
                x: 4,
                y: 3,
            },
            model: WindowModel::Picture,
        };
        let bytes = postcard::to_allocvec(&placed).unwrap();
        assert_eq!(bytes, [1, 4, 3, 6]);
        for end in 0..bytes.len() {
            assert!(postcard::from_bytes::<WindowPlacement>(&bytes[..end]).is_err());
        }
        assert!(postcard::from_bytes::<WindowPlacement>(&[1, 4, 3, 9]).is_err());
    }
}
