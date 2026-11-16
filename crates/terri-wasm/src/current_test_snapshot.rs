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

/// Decode the complete current envelope without projecting away saved state.
pub(crate) fn decode_current(bytes: &[u8]) -> terri_core::SaveSnapshotV22 {
    assert_eq!(&bytes[..SAVE_MAGIC.len()], SAVE_MAGIC);
    assert_eq!(
        &bytes[SAVE_MAGIC.len()..SAVE_HEADER_BYTES],
        &22u16.to_le_bytes()
    );
    let (snapshot, remaining) =
        postcard::take_from_bytes::<terri_core::SaveSnapshotV22>(&bytes[SAVE_HEADER_BYTES..])
            .unwrap();
    assert!(remaining.is_empty());
    snapshot
}
/// The current envelope around a schema-twenty one, as a schema-twenty
/// load leaves it: every shift standard, the shift stream undrawn (issue
/// 296, [WS-save]) and the bills pristine (issue 298, [WB-save]).
pub(crate) fn current_from_v20(legacy: terri_core::SaveSnapshotV20) -> terri_core::SaveSnapshotV22 {
    current_from_v21(terri_core::SaveSnapshotV21 {
        legacy,
        shifts: terri_core::save_v21::SavedShifts {
            rng: terri_core::SimRng::from_seed(terri_sim::shifts::SHIFTS_SEED),
            draws: 0,
            held: Vec::new(),
            changed_today: Vec::new(),
        },
        queued_shift_commands: Vec::new(),
    })
}
/// The current envelope around a schema-twenty-one one, as a schema-twenty-
/// one load leaves it: the bills pristine (issue 298, [WB-save]).
pub(crate) fn current_from_v21(legacy: terri_core::SaveSnapshotV21) -> terri_core::SaveSnapshotV22 {
    terri_core::SaveSnapshotV22 {
        legacy,
        bills: Default::default(),
    }
}
macro_rules! current_view {
    ($view:ident, $payload:ty, $capture:ident, $load:ident, $($field:ident).+) => {
        #[derive(Clone, Debug, PartialEq)]
        pub(crate) struct $view(pub terri_core::SaveSnapshotV22);
        impl std::ops::Deref for $view {
            type Target = $payload;
            fn deref(&self) -> &Self::Target { &self.0.legacy.legacy.legacy.$($field).+ }
        }
        impl std::ops::DerefMut for $view {
            fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0.legacy.legacy.legacy.$($field).+ }
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
        CurrentV17View(self.save_snapshot_v22())
    }
    fn load_current_v17_view(
        &mut self,
        snapshot: CurrentV17View,
    ) -> Result<(), terri_sim::SaveError> {
        self.load_snapshot_v22(snapshot.0)
    }
    fn current_v5_view(&self) -> CurrentV5View {
        CurrentV5View(self.save_snapshot_v22())
    }
    fn current_v6_view(&self) -> CurrentV6View {
        CurrentV6View(self.save_snapshot_v22())
    }
    fn load_current_v6_view(
        &mut self,
        snapshot: CurrentV6View,
    ) -> Result<(), terri_sim::SaveError> {
        self.load_snapshot_v22(snapshot.0)
    }
}
