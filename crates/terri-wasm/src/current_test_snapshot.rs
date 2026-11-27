//! Strict current-envelope readers and typed field views for boundary tests.
use super::*;

/// Reviewed 4x4 tail-codec and 10x10 recline fixtures record no wall cells.
/// Their historical shell consists only of the north and west boundaries.
pub(crate) fn empty_cell_fixture_shell(
    source: &terri_core::layout::SavedLayout,
    width: u32,
    height: u32,
) -> terri_core::layout::SavedLayout {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge};
    assert_eq!(
        source,
        &SavedLayout::LegacyCells { walls: vec![] },
        "empty-cell fixture contract requires its exact recorded layout variant"
    );
    let expected_count = match (width, height) {
        (4, 4) => 8,
        (10, 10) => 20,
        dimensions => panic!("unreviewed empty-cell fixture dimensions: {dimensions:?}"),
    };
    let edges: Vec<_> = (0..height)
        .map(|y| WallEdge {
            axis: EdgeAxis::Vertical,
            x: 0,
            y,
            doorway: false,
        })
        .chain((0..width).map(|x| WallEdge {
            axis: EdgeAxis::Horizontal,
            x,
            y: 0,
            doorway: false,
        }))
        .collect();
    assert_eq!(edges.len(), expected_count);
    assert!(edges.iter().all(|edge| !edge.doorway
        && match edge.axis {
            EdgeAxis::Vertical => edge.x == 0,
            EdgeAxis::Horizontal => edge.y == 0,
        }));
    SavedLayout::EdgeWallsV1 { edges }
}

/// Public adoption makes only the historical north/west shell explicit here.
/// Source fixture bytes and all original edge/window records remain controls.
pub(crate) fn assert_materialized_shell(
    actual: &terri_core::layout::SavedLayout,
    original: &terri_core::layout::SavedLayout,
    width: u32,
    height: u32,
) {
    let expected = materialized_shell(original, 0, 0, width, height);
    let mut got = actual.edges().to_vec();
    got.sort_by_key(|edge| (edge.axis, edge.x, edge.y, edge.doorway));
    assert_eq!(got, expected.edges());
    assert_eq!(actual.window_placements(), original.window_placements());
}

pub(crate) fn materialized_shell(
    original: &terri_core::layout::SavedLayout,
    ox: u32,
    oy: u32,
    width: u32,
    height: u32,
) -> terri_core::layout::SavedLayout {
    use terri_core::layout::{EdgeAxis, SavedLayout, WallEdge, WallLine};
    assert!(
        original.has_edges(),
        "this expected delta applies only to historical edge layouts"
    );
    let mut expected = original.edges().to_vec();
    for line in (oy..oy + height)
        .map(|y| WallLine {
            axis: EdgeAxis::Vertical,
            x: ox,
            y,
        })
        .chain((ox..ox + width).map(|x| WallLine {
            axis: EdgeAxis::Horizontal,
            x,
            y: oy,
        }))
    {
        if original.window_at(line).is_none()
            && !expected
                .iter()
                .any(|edge| edge.axis == line.axis && edge.x == line.x && edge.y == line.y)
        {
            expected.push(WallEdge {
                axis: line.axis,
                x: line.x,
                y: line.y,
                doorway: false,
            });
        }
    }
    expected.sort_by_key(|edge| (edge.axis, edge.x, edge.y, edge.doorway));
    let mut result = original.clone();
    match &mut result {
        SavedLayout::EdgeWallsV1 { edges }
        | SavedLayout::EdgeWallsV2 { edges, .. }
        | SavedLayout::EdgeWallsV3 { edges, .. } => *edges = expected,
        _ => unreachable!("the helper accepts edge layouts only"),
    }
    result
}

/// Apply the independently specified shell delta to a published V14 projection.
/// The frame records bought-land offsets; these fixtures all retain the 16x12 house.
pub(crate) fn materialized_v14(
    mut source: terri_core::SaveSnapshotV14,
) -> terri_core::SaveSnapshotV14 {
    let frame = source
        .legacy
        .lot_frame
        .expect("authentic house fixture has its saved frame");
    let layout = &mut source.legacy.legacy.legacy.legacy.legacy.legacy.layout;
    *layout = materialized_shell(layout, frame.origin_x, frame.origin_y, 16, 12);
    source
}

/// Fingerprint for the catalogue with the 3-by-4 and 5-by-7 pools.
pub(crate) const CURRENT_CATALOGUE_FINGERPRINT: u64 = 0x45cd_e098_33f3_fc3a;

/// This projection can change only the global metadata field, never saved state.
pub(crate) fn project_reviewed_catalogue_fingerprint(source: u64, captured: &mut u64) {
    assert_eq!(
        source, 17481476517581295759,
        "authenticated V14/V15 catalogue"
    );
    assert_eq!(
        *captured, CURRENT_CATALOGUE_FINGERPRINT,
        "current catalogue"
    );
    *captured = source;
}

/// Decode the complete current envelope without projecting away saved state.
pub(crate) fn decode_current(bytes: &[u8]) -> terri_core::SaveSnapshotV34 {
    assert_eq!(&bytes[..SAVE_MAGIC.len()], SAVE_MAGIC);
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &terri_core::SAVE_SCHEMA_VERSION.to_le_bytes()
    );
    let (snapshot, remaining) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV34>(&bytes[SAVE_HEADER_BYTES..])
            .unwrap();
    assert!(remaining.is_empty());
    snapshot
}
macro_rules! current_view {
    ($view:ident, $payload:ty, $capture:ident, $load:ident, $($field:ident).+) => {
        #[derive(Clone, Debug, PartialEq)]
        pub(crate) struct $view(pub terri_core::SaveSnapshotV34);
        impl std::ops::Deref for $view {
            type Target = $payload;
            fn deref(&self) -> &Self::Target { &self.0.gameplay_v20().legacy.$($field).+ }
        }
        impl std::ops::DerefMut for $view {
            fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0.gameplay_v20_mut().legacy.$($field).+ }
        }
    };
}
current_view!(
    CurrentV5View,
    terri_core::SaveSnapshotV5,
    current_v5_view,
    load_current_v5_view,
    legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
);
current_view!(
    CurrentV6View,
    terri_core::SaveSnapshotV6,
    current_v6_view,
    load_current_v6_view,
    legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
        .legacy
);
current_view!(
    CurrentV17View,
    terri_core::SaveSnapshotV17,
    current_v17_view,
    load_current_v17_view,
    legacy.legacy
);
pub(crate) trait CurrentSnapshotViews {
    fn current_v17_view(&self) -> CurrentV17View;
    fn load_current_v17_view(
        &mut self,
        snapshot: CurrentV17View,
    ) -> Result<(), terri_sim::SaveError>;
    fn current_v5_view(&self) -> CurrentV5View;
    fn current_v6_view(&self) -> CurrentV6View;
    fn load_current_v6_view(&mut self, snapshot: CurrentV6View)
        -> Result<(), terri_sim::SaveError>;
}
impl CurrentSnapshotViews for Sim {
    fn current_v17_view(&self) -> CurrentV17View {
        CurrentV17View(self.save_snapshot_v34())
    }
    fn load_current_v17_view(
        &mut self,
        snapshot: CurrentV17View,
    ) -> Result<(), terri_sim::SaveError> {
        self.load_snapshot_v34(snapshot.0)
    }
    fn current_v5_view(&self) -> CurrentV5View {
        CurrentV5View(self.save_snapshot_v34())
    }
    fn current_v6_view(&self) -> CurrentV6View {
        CurrentV6View(self.save_snapshot_v34())
    }
    fn load_current_v6_view(
        &mut self,
        snapshot: CurrentV6View,
    ) -> Result<(), terri_sim::SaveError> {
        self.load_snapshot_v34(snapshot.0)
    }
}
