//! Test views retain the full current envelope, schema twenty-two, for
//! equality and restoration.
use crate::{SaveError, Sim};
use terri_core::{
    SaveSnapshotV10, SaveSnapshotV17, SaveSnapshotV19, SaveSnapshotV22, SaveSnapshotV5,
    SaveSnapshotV6,
};

macro_rules! current_view {
    ($view:ident, $payload:ty, $capture:ident, $load:ident, $($field:ident).+) => {
        #[derive(Clone, Debug, PartialEq)]
        pub(crate) struct $view(pub SaveSnapshotV22);
        impl std::ops::Deref for $view {
            type Target = $payload;
            fn deref(&self) -> &Self::Target { &self.0.legacy.legacy.legacy.legacy.legacy.$($field).+ }
        }
        impl std::ops::DerefMut for $view {
            fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0.legacy.legacy.legacy.legacy.legacy.$($field).+ }
        }
        impl Sim {
            pub(crate) fn $capture(&self) -> $view { $view(self.save_snapshot_v22()) }
            pub(crate) fn $load(&mut self, snapshot: $view) -> Result<(), SaveError> {
                self.load_snapshot_v22(snapshot.0)
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

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CurrentV17View(pub SaveSnapshotV22);
impl std::ops::Deref for CurrentV17View {
    type Target = SaveSnapshotV17;
    fn deref(&self) -> &Self::Target {
        &self.0.legacy.legacy.legacy.legacy.legacy
    }
}
impl std::ops::DerefMut for CurrentV17View {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0.legacy.legacy.legacy.legacy.legacy
    }
}
impl Sim {
    pub(crate) fn current_v17_view(&self) -> CurrentV17View {
        CurrentV17View(self.save_snapshot_v22())
    }
    pub(crate) fn load_current_v17_view(
        &mut self,
        snapshot: CurrentV17View,
    ) -> Result<(), SaveError> {
        self.load_snapshot_v22(snapshot.0)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CurrentV19View(pub SaveSnapshotV22);
impl std::ops::Deref for CurrentV19View {
    type Target = SaveSnapshotV19;
    fn deref(&self) -> &Self::Target {
        &self.0.legacy.legacy.legacy
    }
}
impl std::ops::DerefMut for CurrentV19View {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0.legacy.legacy.legacy
    }
}
impl Sim {
    pub(crate) fn current_v19_view(&self) -> CurrentV19View {
        CurrentV19View(self.save_snapshot_v22())
    }
    pub(crate) fn load_current_v19_view(
        &mut self,
        snapshot: CurrentV19View,
    ) -> Result<(), SaveError> {
        self.load_snapshot_v22(snapshot.0)
    }
}
