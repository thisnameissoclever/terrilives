//! Test views retain the full current envelope for equality and restoration.
use crate::{SaveError, Sim};
use terri_core::{SaveSnapshotV10, SaveSnapshotV17, SaveSnapshotV5, SaveSnapshotV6};

macro_rules! current_view {
    ($view:ident, $payload:ty, $capture:ident, $load:ident, $($field:ident).+) => {
        #[derive(Clone, Debug, PartialEq)]
        pub(crate) struct $view(pub SaveSnapshotV17);
        impl std::ops::Deref for $view {
            type Target = $payload;
            fn deref(&self) -> &Self::Target { &self.0.$($field).+ }
        }
        impl std::ops::DerefMut for $view {
            fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0.$($field).+ }
        }
        impl Sim {
            pub(crate) fn $capture(&self) -> $view { $view(self.save_snapshot_v17()) }
            pub(crate) fn $load(&mut self, snapshot: $view) -> Result<(), SaveError> {
                self.load_snapshot_v17(snapshot.0)
            }
        }
    };
}
current_view!(
    CurrentV5View,
    SaveSnapshotV5,
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
    SaveSnapshotV6,
    current_v6_view,
    load_current_v6_view,
    legacy.legacy.legacy.legacy.legacy.legacy.legacy.legacy
);
current_view!(
    CurrentV10View,
    SaveSnapshotV10,
    current_v10_view,
    load_current_v10_view,
    legacy.legacy.legacy.legacy.legacy.legacy.legacy
);
