//! Strict current-envelope readers and typed field views for boundary tests.
use super::*;

/// Independent Data-tool measurements bind a481's 30-model catalogue and 513's
/// 33-model catalogue, with and without Patio. See the yard-integration evidence.
/// This projection can change only the global metadata field, never saved state.
pub(crate) fn project_reviewed_catalogue_fingerprint(source: u64, captured: &mut u64) {
    assert_eq!(
        source, 17481476517581295759,
        "authenticated V14/V15 catalogue"
    );
    assert_eq!(
        *captured, 5841475410324663844,
        "independently measured current catalogue"
    );
    *captured = source;
}

/// The schema-seventeen envelope of a current save. The tests that read it
/// never turn anyone's job search off, which is all schema eighteen adds;
/// the decode checks that.
pub(crate) fn decode_current(bytes: &[u8]) -> terri_core::SaveSnapshotV17 {
    assert_eq!(&bytes[..SAVE_MAGIC.len()], SAVE_MAGIC);
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &18u16.to_le_bytes()
    );
    let (snapshot, remaining) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV18>(&bytes[SAVE_HEADER_BYTES..])
            .unwrap();
    assert!(remaining.is_empty());
    assert!(snapshot.job_search_off.is_empty());
    snapshot.legacy
}
macro_rules! current_view {
    ($view:ident, $payload:ty, $capture:ident, $load:ident, $($field:ident).+) => {
        #[derive(Clone, Debug, PartialEq)]
        pub(crate) struct $view(pub terri_core::SaveSnapshotV17);
        impl std::ops::Deref for $view {
            type Target = $payload;
            fn deref(&self) -> &Self::Target { &self.0.$($field).+ }
        }
        impl std::ops::DerefMut for $view {
            fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0.$($field).+ }
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
);
current_view!(
    CurrentV6View,
    terri_core::SaveSnapshotV6,
    current_v6_view,
    load_current_v6_view,
    legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy
);
pub(crate) trait CurrentSnapshotViews {
    fn current_v5_view(&self) -> CurrentV5View;
    fn current_v6_view(&self) -> CurrentV6View;
    fn load_current_v6_view(&mut self, snapshot: CurrentV6View)
        -> Result<(), terri_sim::SaveError>;
}
impl CurrentSnapshotViews for Sim {
    fn current_v5_view(&self) -> CurrentV5View {
        CurrentV5View(self.save_snapshot_v17())
    }
    fn current_v6_view(&self) -> CurrentV6View {
        CurrentV6View(self.save_snapshot_v17())
    }
    fn load_current_v6_view(
        &mut self,
        snapshot: CurrentV6View,
    ) -> Result<(), terri_sim::SaveError> {
        self.load_snapshot_v17(snapshot.0)
    }
}
